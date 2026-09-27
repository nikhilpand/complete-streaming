import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: false },
  devIndicators: false,
};

export default nextConfig;
