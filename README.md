# AI Book Studio

Production-oriented end-to-end AI publishing system. A user can sign in, create a book from one sentence, generate a structured blueprint, generate chapter/section prose through durable background workflows, reopen the project later, edit with autosave and AI commands, and export PDF/EPUB/DOCX/Markdown/TXT.

## Core architecture

- **Next.js 16 / React 19 / TypeScript** — App Router UI, authenticated API routes and editor.
- **Supabase Auth + Postgres + pgvector** — users, books, outlines, revisions, jobs, sources, memories, usage and RLS.
- **Vercel Workflow SDK** — durable hierarchical generation. Each section is a retryable step; completed steps are journaled and not repeated after a restart.
- **OpenAI Responses API** — planner, writer, reviewer and research roles. Book planning and prose metadata use strict JSON Schema structured outputs.
- **Retrieval memory** — summaries/facts/terminology are embedded and retrieved by semantic similarity from pgvector instead of sending the entire manuscript every time.
- **Persistent rate limiting** — Postgres-backed atomic buckets for AI-heavy endpoints.
- **Content-aware page composer** — stores Cover/TOC/ChapterOpening and semantic body page layouts from Design DNA.
- **Export** — paginated A5 PDF through `@react-pdf/renderer`, standards-oriented EPUB, DOCX, Markdown and TXT.

## Product flow

1. Magic-link authentication.
2. Quick Create or Wizard.
3. Reader Profile + Writing Style are derived.
4. Planner generates title candidates and a `BookBlueprint`.
5. Blueprint is persisted as Part → Chapter → Section records.
6. Generate Book starts a Vercel Workflow.
7. Each section does contextual retrieval → optional web research → write → repetition check/rewrite → memory update.
8. User can pause/resume/cancel cooperatively through persistent book state.
9. Final global quality review stores 10 category scores.
10. Editor autosaves and stores revisions before manual or AI edits.
11. Export to PDF/EPUB/DOCX/MD/TXT.

## Setup

### Requirements

- Node.js 22+
- A Supabase project with Auth enabled
- OpenAI API key
- Vercel project for durable workflows in production

### Environment

Copy `.env.example` to `.env.local` and fill:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only)
- `OPENAI_API_KEY`
- optional per-role model variables

Never expose the service role key or OpenAI key to the browser.

### Database

Apply `supabase/migrations/001_initial.sql` to an empty Supabase project. The migration:

- creates book/editor/job/export tables;
- enables `vector`;
- creates a semantic memory search RPC;
- adds Row Level Security policies based on `auth.uid()`;
- seeds three original Design DNA templates.

### Development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

### Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

GitHub Actions runs all four on pushes and pull requests.

## AI provider behavior

`lib/ai/openai.ts` talks directly to the current OpenAI Responses API. The architecture deliberately keeps the rest of the product behind a provider interface so another LLM provider can be added without rewriting the planner, memory, editor or workflow layers.

Planner and writer outputs are validated twice:

1. the API is asked for `json_schema` structured output with strict schema adherence;
2. application code validates the returned object with Zod.

Research steps can enable the Responses API web-search tool and store only URLs the model reports as used. High-stakes production deployments should add a second source-validation pass before automatically publishing factual claims.

## Long-form generation

The app does not request an entire 300-page manuscript in one prompt. It persists a hierarchical outline and generates individual sections. Before a section is written the workflow retrieves relevant memories, the previous local summary, reader profile, writing style, Story Bible or Knowledge Map and optional research notes.

Repetition prevention uses pgvector similarity against previous section summaries. A high similarity score triggers a targeted rewrite from a new angle rather than blindly accepting repetitive prose.

## Durable jobs and recovery

`lib/jobs/book-workflow.ts` is a Vercel workflow. Every section is a durable `"use step"` operation. Job and step states are also stored in Postgres for a user-facing progress screen. A redeploy or transient function failure therefore does not require regenerating completed sections.

Pause/resume/cancel are cooperative: the workflow checks persistent book state between durable steps. Paused workflows sleep and re-check; cancellation ends at the next safe boundary.

## Security

- Supabase Row Level Security protects book data per user.
- API routes resolve the authenticated user server-side.
- Service role and OpenAI keys remain server-only.
- Zod validates user input.
- Revision history is created before content replacement.
- Research sources and token/cost usage are persisted for auditability.

Before a public launch, add a WAF or Vercel Firewall rate rule to generation endpoints and configure abuse limits per subscription entitlement.

## Export notes

PDF uses a public Noto Sans KR WOFF by default so Korean manuscripts render without committing font binaries to the repository. Set `PDF_FONT_REGULAR_URL` and `PDF_FONT_BOLD_URL` to controlled assets in production if you want to eliminate third-party runtime font fetching.

## Deployment

1. Create an empty Supabase project in a region near primary users.
2. Apply the SQL migration.
3. Configure Auth redirect URLs for `/auth/callback`.
4. Import this repository into Vercel.
5. Add environment variables to Vercel.
6. Deploy. Vercel's Workflow SDK integration is enabled by `withWorkflow()` in `next.config.ts`.
7. Create a user, generate a small test book, reload, resume generation and export PDF before opening access.

## Current implementation boundary

The repository implements the production architecture and the complete primary flow, but a live deployment still requires account-owned infrastructure values (Supabase project and OpenAI secret). Those secrets are intentionally not embedded in source control.
