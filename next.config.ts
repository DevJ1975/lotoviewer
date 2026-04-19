import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',

  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'zwtnpyjifbdytlektxlc.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;