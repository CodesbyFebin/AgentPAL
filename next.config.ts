import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ["@paypal/agent-toolkit", "@paypal/paypal-server-sdk", "braintree"],
};

export default nextConfig;
