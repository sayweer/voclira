/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable instrumentation.ts (env fail-fast guard at server boot). Default in Next 15.
  experimental: {
    instrumentationHook: true,
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      'pino-pretty': false,
    }
    return config
  },
};

export default nextConfig;
