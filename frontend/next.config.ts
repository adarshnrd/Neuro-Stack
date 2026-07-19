import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Standalone output for Docker/serverless deployments
  output: 'standalone',

  // Proxy API requests through Next.js in development to avoid CORS
  async rewrites() {
    return process.env.NODE_ENV === 'development'
      ? [
          {
            source: '/api/v1/:path*',
            destination: `${process.env.NEXT_PUBLIC_API_URL}/:path*`,
          },
        ]
      : []
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'dev.azure.com',
      },
    ],
  },
}

export default nextConfig
