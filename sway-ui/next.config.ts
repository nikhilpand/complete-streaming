import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: false },
  transpilePackages: ['@levelup/lyrics-engine'],
};

export default nextConfig;
