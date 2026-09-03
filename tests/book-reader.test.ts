import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("../app/api/books/[id]/reader/route.ts", import.meta.url), "utf8");
const readerSource = readFileSync(new URL("../app/read/page.tsx", import.meta.url), "utf8");
const readerCss = readFileSync(new URL("../app/read/read.module.css", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../app/books/[id]/book-editor-shell.tsx", import.meta.url), "utf8");
const nextConfig = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

test("final-book reader only exposes a user's owned book and canonical composed pages", () => {
  assert.match(routeSource, /requireUser/);
  assert.match(routeSource, /\.eq\("user_id", user\.id\)/);
  assert.match(routeSource, /from\("pages"\)/);
  assert.match(routeSource, /order\("page_number", \{ ascending: true \}\)/);
});

test("completed books are recomposed before reading so latest saved edits match export page semantics", () => {
  assert.ok(routeSource.includes('if (book.status === "COMPLETED")'));
  assert.ok(routeSource.includes("await composeBookPages(id);"));
  assert.ok(routeSource.includes('final: book.status === "COMPLETED"'));
});

test("web reader renders the full book as a vertically scrollable page stream", () => {
  assert.match(readerSource, /data-reader-page/);
  assert.match(readerSource, /data\.pages\.map/);
  assert.match(readerSource, /IntersectionObserver/);
  assert.match(readerSource, /BookCoverArt/);
  assert.match(readerSource, /TableOfContents/);
  assert.match(readerCss, /\.stream/);
  assert.match(readerCss, /\.sheet/);
});

test("editor exposes a final-book reader launcher only after completion and uses a pretty book URL", () => {
  assert.match(shellSource, /initialBook\.status===\"COMPLETED\" \? <BookReaderLauncher/);
  assert.match(shellSource, /completed \/>/);
  assert.ok(nextConfig.includes('{ source: "/books/:id/read", destination: "/read?bookId=:id" }'));
});
