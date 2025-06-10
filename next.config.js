/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  webpack: (config) => {
    config.resolve.fallback = {
      fs: false,
      path: false,
      os: false,
    }
    return config
  },
  // Ensure proper hydration for wallet components
  experimental: {
    esmExternals: 'loose'
  }
}

module.exports = nextConfig 