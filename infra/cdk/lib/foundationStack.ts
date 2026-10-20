import * as cdk from 'aws-cdk-lib'
import * as ecr from 'aws-cdk-lib/aws-ecr'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import type { Construct } from 'constructs'

export interface FoundationStackProps extends cdk.StackProps {
  /** `owner/name`, exactly as GitHub capitalises it; the OIDC subject match is case-sensitive. */
  githubRepo: string
  /** An AWS account holds one GitHub OIDC provider; reuse it if it already exists. */
  existingGithubOidcProviderArn?: string
}

// Everything that must exist before the first image can be built: the image
// registry, the runtime secret, and the role GitHub Actions deploys with.
// Deployed by a human (`cdk deploy SoteriaFoundation`), never by CI, so the
// pipeline cannot widen its own permissions.
export class FoundationStack extends cdk.Stack {
  readonly repository: ecr.Repository
  readonly envSecret: secretsmanager.Secret

  constructor(scope: Construct, id: string, props: FoundationStackProps) {
    super(scope, id, props)

    this.repository = new ecr.Repository(this, 'WebRepository', {
      repositoryName: 'soteria/web',
      imageScanOnPush: true,
      // Every deploy pushes a fresh tag, so a tag always means one image.
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      lifecycleRules: [{ maxImageCount: 30, description: 'Keep enough images to roll back' }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    // Starts empty and is filled by `npm run sync-env`. CloudFormation only
    // rewrites a secret's value when this template value changes, so later
    // deploys never clobber what the sync script wrote.
    this.envSecret = new secretsmanager.Secret(this, 'EnvSecret', {
      secretName: 'soteria/web/env',
      description: 'Runtime and build configuration for apps/web, as one JSON object',
      secretStringValue: cdk.SecretValue.unsafePlainText('{}'),
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    const oidcProvider = props.existingGithubOidcProviderArn
      ? iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(this, 'GithubOidc', props.existingGithubOidcProviderArn)
      : new iam.OpenIdConnectProvider(this, 'GithubOidc', {
          url: 'https://token.actions.githubusercontent.com',
          clientIds: ['sts.amazonaws.com'],
        })

    // Short-lived credentials via OIDC instead of long-lived access keys in
    // GitHub secrets. Only workflows running on main may assume the role.
    const deployRole = new iam.Role(this, 'GithubDeployRole', {
      roleName: 'soteria-github-deploy',
      maxSessionDuration: cdk.Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(oidcProvider.openIdConnectProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `repo:${props.githubRepo}:ref:refs/heads/main`,
        },
      }),
    })
    this.repository.grantPullPush(deployRole)
    // The build reads NEXT_PUBLIC_* and Sentry values from the same secret.
    this.envSecret.grantRead(deployRole)
    // `cdk deploy` runs through the roles `cdk bootstrap` created; this role
    // only needs to step into them.
    deployRole.addToPolicy(new iam.PolicyStatement({
      actions: ['sts:AssumeRole'],
      resources: [`arn:aws:iam::${this.account}:role/cdk-*`],
    }))

    new cdk.CfnOutput(this, 'DeployRoleArn', {
      value: deployRole.roleArn,
      description: 'Set as the AWS_DEPLOY_ROLE_ARN repository variable in GitHub',
    })
    new cdk.CfnOutput(this, 'RepositoryUri', { value: this.repository.repositoryUri })
    new cdk.CfnOutput(this, 'EnvSecretName', { value: this.envSecret.secretName })
  }
}
