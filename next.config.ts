import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@react-pdf/renderer", "@openai/codex"],
  async rewrites() {
    return [
      { source: "/books/:id/read", destination: "/read?bookId=:id" },
      { source: "/books/:id", destination: "/book?bookId=:id" },
      { source: "/api/auth/openrouter/connection", destination: "/api/core/auth/ai-connection" },
      { source: "/api/auth/openrouter/exchange", destination: "/api/core/auth/openrouter-exchange" },
      { source: "/api/auth/register", destination: "/api/core/auth/register" },
      { source: "/api/books", destination: "/api/core/books" },
      { source: "/api/books/:id/generate", destination: "/api/core/books/:id/generate" },
      { source: "/api/books/:id/generate-free", destination: "/api/core/books/:id/generate" },
      { source: "/api/books/:id/plan", destination: "/api/core/books/:id/plan" },
      { source: "/api/health/service-bridge", destination: "/api/core/health/service-bridge" },
      { source: "/api/books/:id/control", destination: "/api/core/editor/book/:id/control" },
      { source: "/api/books/:id/outline", destination: "/api/core/editor/book/:id/outline" },
      { source: "/api/books/:id/status", destination: "/api/book-status/:id" },
      { source: "/api/outline/:kind/:id", destination: "/api/core/editor/outline/:kind/:id" },
      { source: "/api/sections/:id/revisions", destination: "/api/core/editor/section/:id/revisions" },
      { source: "/api/sections/:id/rewrite", destination: "/api/core/editor/section/:id/rewrite" },
      { source: "/api/sections/:id", destination: "/api/core/editor/section/:id" },
      { source: "/api/revisions/:id/restore", destination: "/api/core/editor/revision/:id/restore" },
      { source: "/api/editor/:path*", destination: "/api/core/editor/:path*" }
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb"
    }
  }
};

export default withWorkflow(nextConfig);
