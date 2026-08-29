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
  async rewrites() {
    return [
      { source: "/api/books/:id/control", destination: "/api/editor/book/:id/control" },
      { source: "/api/books/:id/outline", destination: "/api/editor/book/:id/outline" },
      { source: "/api/books/:id/status", destination: "/api/editor/book/:id/status" },
      { source: "/api/outline/:kind/:id", destination: "/api/editor/outline/:kind/:id" },
      { source: "/api/sections/:id/revisions", destination: "/api/editor/section/:id/revisions" },
      { source: "/api/sections/:id/rewrite", destination: "/api/editor/section/:id/rewrite" },
      { source: "/api/sections/:id", destination: "/api/editor/section/:id" },
      { source: "/api/revisions/:id/restore", destination: "/api/editor/revision/:id/restore" }
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb"
    }
  }
};

export default withWorkflow(nextConfig);
