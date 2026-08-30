import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import { execSync } from 'node:child_process';
import pkg from './package.json';
import { getAdminRedirects } from './lib/adminCatalog';

// Iteration number = total git commits on the current branch. Bumps
// automatically with every build, so the footer reflects exactly which
// build the user is on without anyone editing a counter by hand. Falls
// back to "0" when git isn't available (shallow CI checkout, tarball).
function buildIteration(): string {
  try {
    return execSync('git rev-list --count HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '0';
  }
}


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

// Origin of a configured URL, or null when it's unset/unparseable at build
// time. Same tolerance as supabaseImageHost() — a local `next build` without
// .env.local should still succeed.
function originOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

// Directives that say nothing about scripts, so they cannot break a page that
// renders today. frame-ancestors backs up X-Frame-Options (which is ignored by
// some browsers when a CSP is present), base-uri blocks <base> injection, and
// form-action blocks form-based exfiltration — both relevant given session
// tokens live in localStorage and are readable by any injected script.
const ENFORCED_CSP = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
].join('; ')

// The policy we intend to enforce, shipped Report-Only first so violations can
// be collected before anything is blocked.
//
// script-src keeps 'unsafe-inline' deliberately: Next injects inline bootstrap
// scripts and app/layout.tsx renders NO_FLASH_SCRIPT via
// dangerouslySetInnerHTML, so a nonce would mean reading headers() in the root
// layout and making every page dynamic. Even with it, this still blocks the
// main token-theft vector — pulling in an attacker-controlled external script.
function reportOnlyCsp(): string {
  const supabase = originOf(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const sentry   = originOf(process.env.NEXT_PUBLIC_SENTRY_DSN)

  // Realtime rides a websocket on the Supabase origin.
  const connect = ["'self'", supabase, supabase?.replace(/^https:/, 'wss:'), sentry]
    .filter(Boolean)
    .join(' ')

  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabase ?? ''}`.trim(),
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "worker-src 'self' blob:",
    ENFORCED_CSP,
  ].join('; ')
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BUILD_ITERATION: buildIteration(),
  },
  // The /superadmin/migrations page lists migration .sql files via
  // `fs.readdir(path.resolve(process.cwd(), …))` at request time.
  // Turbopack's NFT can't statically bound the dynamic `process.cwd()`
  // arg and emits a "whole project was traced" warning on every build,
  // attributed to next.config.ts (the entry point of the trace). The
  // page is force-dynamic, server-only, and gated behind superadmin,
  // so the over-tracing is harmless. Scope the suppression to that
  // specific issue title so unrelated config issues still surface.
  turbopack: {
    ignoreIssue: [
      {
        path: '**/next.config.ts',
        title: /Encountered unexpected file in NFT list/,
      },
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: supabaseImageHost(),
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  // Phase B URL reshape: /admin/* routes were flat (one segment) and
  // are now section-nested (/admin/<section>/<slug>). One 301 per
  // renamed tile keeps every old bookmark, email link, and audit-trail
  // URL working forever. The map is derived from lib/adminCatalog.ts
  // so the redirects table cannot drift from the catalog.
  async redirects() {
    return getAdminRedirects();
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
      {
        source: '/:path*',
        headers: [
          // No `preload`. Preloading is a one-way door — it breaks any
          // non-HTTPS subdomain and removal takes months to propagate.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // no-referrer rather than strict-origin-when-cross-origin: the
          // latter still sends the full URL, query string included, on
          // same-origin requests — and the raw invite token rides in
          // /accept-invite?token=…, which would put it in our own access logs
          // via Referer. Nothing here depends on outbound referrals.
          { key: 'Referrer-Policy', value: 'no-referrer' },
          // camera and geolocation stay 'self': the QR scanner and photo
          // capture need the camera, the weather card and incident reporter
          // need location. Locking those to () would break shipped features.
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), geolocation=(self), microphone=(), payment=(), usb=()',
          },
          { key: 'Content-Security-Policy', value: ENFORCED_CSP },
          { key: 'Content-Security-Policy-Report-Only', value: reportOnlyCsp() },
        ],
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
