import * as path from 'node:path'
import * as cdk from 'aws-cdk-lib'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as ecs from 'aws-cdk-lib/aws-ecs'
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns'
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2'
import * as events from 'aws-cdk-lib/aws-events'
import * as targets from 'aws-cdk-lib/aws-events-targets'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as route53 from 'aws-cdk-lib/aws-route53'
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'
import type { CronJob } from './vercelCrons'

export interface WebStackProps extends cdk.StackProps {
  repository: ecr.IRepository
  envSecret: secretsmanager.ISecret
  imageTag: string
  commitSha: string
  /** Keys of envSecret to inject; see runtimeSecretKeys(). */
  secretKeys: string[]
  /** Reported to Sentry as the environment, so AWS events stay separate from Vercel's. */
  deployEnvironment: string
  /** Both set → HTTPS on a Route 53 name; both empty → plain HTTP on the ALB's own hostname. */
  domain?: { domainName: string; hostedZoneName: string }
  /** Scheduled only when set; see bin/app.ts for why this defaults off. */
  crons?: CronJob[]
}

// The longest route handler declares maxDuration = 300. The ALB must not cut
// a request off before the app does.
const REQUEST_TIMEOUT = cdk.Duration.seconds(330)

export class WebStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props)

    // Tasks sit in private subnets behind one NAT gateway. A second NAT
    // removes the single-AZ egress dependency for roughly $32/month more.
    const vpc = new ec2.Vpc(this, 'Vpc', { maxAzs: 2, natGateways: 1 })

    const cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: 'soteria',
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    })

    const logGroup = new logs.LogGroup(this, 'WebLogs', {
      logGroupName: '/soteria/web',
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    const secrets = Object.fromEntries(
      props.secretKeys.map(key => [key, ecs.Secret.fromSecretsManager(props.envSecret, key)]),
    )

    const domainZone = props.domain
      ? route53.HostedZone.fromLookup(this, 'Zone', { domainName: props.domain.hostedZoneName })
      : undefined
    const certificate = props.domain && domainZone
      ? new acm.Certificate(this, 'Certificate', {
          domainName: props.domain.domainName,
          validation: acm.CertificateValidation.fromDns(domainZone),
        })
      : undefined

    const web = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Web', {
      cluster,
      serviceName: 'soteria-web',
      cpu: 1024,
      memoryLimitMiB: 2048,
      desiredCount: 2,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: cdk.Duration.seconds(90),
      publicLoadBalancer: true,
      idleTimeout: REQUEST_TIMEOUT,
      ...(props.domain && certificate
        ? {
            protocol: elbv2.ApplicationProtocol.HTTPS,
            domainName: props.domain.domainName,
            domainZone,
            certificate,
            redirectHTTP: true,
          }
        : { protocol: elbv2.ApplicationProtocol.HTTP }),
      taskImageOptions: {
        image: ecs.ContainerImage.fromEcrRepository(props.repository, props.imageTag),
        containerName: 'web',
        containerPort: 3000,
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'web', logGroup }),
        secrets,
        environment: {
          // Node's default 5 s keep-alive is shorter than the ALB's idle
          // timeout; the ALB would then reuse sockets Node already closed and
          // answer with sporadic 502s. Next's standalone server reads this.
          KEEP_ALIVE_TIMEOUT: String(REQUEST_TIMEOUT.toMilliseconds() + 10_000),
          // The Sentry server/edge configs read Vercel's variable names for
          // environment and release; supplying them keeps app code host-agnostic.
          VERCEL_ENV: props.deployEnvironment,
          VERCEL_GIT_COMMIT_SHA: props.commitSha,
        },
      },
    })

    web.targetGroup.configureHealthCheck({
      path: '/api/health',
      healthyHttpCodes: '200',
      interval: cdk.Duration.seconds(15),
      healthyThresholdCount: 2,
    })
    // Old tasks keep serving in-flight requests (up to the 300 s route limit)
    // before ECS stops them. Deploys take longer; nothing is cut off mid-run.
    web.targetGroup.setAttribute('deregistration_delay.timeout_seconds', String(REQUEST_TIMEOUT.toSeconds()))

    web.service
      .autoScaleTaskCount({ minCapacity: 2, maxCapacity: 6 })
      .scaleOnCpuUtilization('Cpu', { targetUtilizationPercent: 60 })

    if (props.crons?.length) {
      if (!props.domain) throw new Error('Crons send a credential, so they require HTTPS: set domainName and hostedZoneName')
      this.scheduleCrons(props.crons, `https://${props.domain.domainName}`, props.envSecret)
    }

    new cdk.CfnOutput(this, 'Url', {
      value: props.domain ? `https://${props.domain.domainName}` : `http://${web.loadBalancer.loadBalancerDnsName}`,
    })
  }

  // EventBridge rules invoke one small Lambda that calls the cron route over
  // HTTPS. A Lambda rather than an EventBridge API destination because API
  // destinations give up after 5 seconds, and these routes run for minutes.
  private scheduleCrons(crons: CronJob[], appBaseUrl: string, envSecret: secretsmanager.ISecret) {
    const invoker = new lambda.Function(this, 'CronInvoker', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/cron-invoker')),
      timeout: REQUEST_TIMEOUT.plus(cdk.Duration.seconds(30)),
      memorySize: 256,
      // A failed run waits for its next schedule, as on Vercel. Automatic
      // retries would re-send reminder emails for runs that half-succeeded.
      retryAttempts: 0,
      environment: {
        APP_BASE_URL: appBaseUrl,
        ENV_SECRET_ARN: envSecret.secretArn,
        REQUEST_TIMEOUT_MS: String(REQUEST_TIMEOUT.toMilliseconds()),
      },
      logGroup: new logs.LogGroup(this, 'CronInvokerLogs', { retention: logs.RetentionDays.ONE_MONTH }),
    })
    // Secrets Manager cannot grant a single JSON key; the invoker reads only
    // INTERNAL_PUSH_SECRET from what it fetches.
    envSecret.grantRead(invoker)

    for (const cron of crons) {
      const slug = cron.path.replace('/api/cron/', '')
      new events.Rule(this, `Cron-${slug}`, {
        description: `${cron.path} (from apps/web/vercel.json)`,
        schedule: events.Schedule.expression(cron.schedule),
        targets: [new targets.LambdaFunction(invoker, {
          event: events.RuleTargetInput.fromObject({ path: cron.path }),
          retryAttempts: 0,
        })],
      })
    }
  }
}
