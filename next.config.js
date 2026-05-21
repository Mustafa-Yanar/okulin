/** @type {import('next').NextConfig} */
const nextConfig = {
  // /solve → kök api/solve.py (Vercel Python function). /solve Next route alanında
  // olmadığı için app/api/* route'larının hiçbiriyle çakışmaz.
  async rewrites() {
    return [{ source: '/solve', destination: '/api/solve' }];
  },
};
module.exports = nextConfig;
