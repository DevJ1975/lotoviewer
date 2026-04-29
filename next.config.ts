import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'zwtnpyjifbdytlektxlc.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

// withSentryConfig wraps the Next config to enable source-map uploads
// and bundler tweaks so client-side stack traces in Sentry show your
// real source instead of minified output. No-ops at build time when
// SENTRY_AUTH_TOKEN isn't set, so local builds and not-yet-configured
// deploys still succeed.
export default withSentryConfig(nextConfig, {
  // Sentry org + project slugs. Kept as env vars so the same code
  // base can target different Sentry projects per environment.
  org:        process.env.SENTRY_ORG,
  project:    process.env.SENTRY_PROJECT,
  authToken:  process.env.SENTRY_AUTH_TOKEN,
  // Suppress the "Sentry CLI not authenticated" warning during local
  // builds where the auth token is intentionally absent.
  silent:     !process.env.CI,
  sourcemaps: {
    // Delete client-side source maps from the bundle after upload so
    // they're only available inside Sentry, not served publicly.
    deleteSourcemapsAfterUpload: true,
  },
});
