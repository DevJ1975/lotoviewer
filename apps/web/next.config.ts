import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

// Derive the Supabase storage hostname from NEXT_PUBLIC_SUPABASE_URL so
// a different Supabase project can be deployed without a code edit.
// Falls back to a permissive `**.supabase.co` match if the env var is
// missing at build time (e.g. local `next build` without .env.local) —
// next/image will still validate at request time, just less strictly.
function supabaseImageHost(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return '**.supabase.co'
  try {
    return new URL(url).hostname
  } catch {
    return '**.supabase.co'
  }
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: supabaseImageHost(),
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  // Apple's Universal-Links validator demands `application/json` for the
  // extensionless `apple-app-site-association` file. Without this rewrite
  // the server defaults to `application/octet-stream` and iOS silently
  // refuses to install the entitlement on first launch.
  async headers() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        headers: [{ key: 'content-type', value: 'application/json' }],
      },
      {
        source: '/.well-known/assetlinks.json',
        headers: [{ key: 'content-type', value: 'application/json' }],
      },
    ]
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
