/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({ pdfkit: 'commonjs pdfkit' });
    }
    return config;
  },
};

module.exports = nextConfig;