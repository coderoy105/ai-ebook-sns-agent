import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer", "@openai/codex-sdk", "@openai/codex"],
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@openai/codex/**/*",
      "./node_modules/@openai/codex-*/**/*"
    ]
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb"
    }
  }
};

export default withWorkflow(nextConfig);
