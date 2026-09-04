/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Позволяет Next.js резолвить локальные workspace-пакеты packages/* напрямую из исходников.
    externalDir: true,
  },
};

module.exports = nextConfig;
