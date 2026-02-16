/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  transpilePackages: ['lucide-react'],
  experimental: {
    optimizePackageImports: ['recharts'],
  },
};

module.exports = nextConfig;
