import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./editor-extras.css";
import "./product-v2.css";
import "./product-v2-fixes.css";
import "./product-v2-progress.css";

export const metadata: Metadata = {
  title: {
    default: "AI Book Studio",
    template: "%s · AI Book Studio"
  },
  description: "아이디어부터 Book Blueprint, 장문 집필, 수정, 버전 관리와 출판 파일까지 이어지는 AI 책 제작 작업실.",
  applicationName: "AI Book Studio"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f5f2",
  colorScheme: "light"
};

const pollingGuardScript = `
(() => {
  if (typeof window === "undefined" || window.__AI_BOOK_FETCH_GUARD__) return;
  window.__AI_BOOK_FETCH_GUARD__ = true;
  const nativeFetch = window.fetch.bind(window);
  const inFlight = new Map();
  const recent = new Map();
  const QUIET_MS = 1500;

  function requestInfo(input, init) {
    try {
      const requestMethod = init && init.method ? init.method : (input instanceof Request ? input.method : "GET");
      const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(raw, window.location.origin);
      const isBookStatus = /^\\/api\\/books\\/[^/]+\\/status$/.test(url.pathname);
      const isAiConnection = url.pathname === "/api/auth/openrouter/connection";
      return { method: String(requestMethod || "GET").toUpperCase(), url, guarded: isBookStatus || isAiConnection };
    } catch {
      return { method: "GET", url: null, guarded: false };
    }
  }

  window.fetch = function guardedFetch(input, init) {
    const info = requestInfo(input, init);
    if (!info.guarded || info.method !== "GET" || !info.url) return nativeFetch(input, init);

    if (document.visibilityState === "hidden") {
      return Promise.resolve(new Response(JSON.stringify({ error: "TAB_HIDDEN" }), {
        status: 503,
        headers: { "content-type": "application/json", "cache-control": "no-store" }
      }));
    }

    const key = info.url.pathname + info.url.search;
    const cached = recent.get(key);
    if (cached && Date.now() - cached.at < QUIET_MS) return Promise.resolve(cached.response.clone());
    const existing = inFlight.get(key);
    if (existing) return existing.then((response) => response.clone());

    const pending = nativeFetch(input, init)
      .then((response) => {
        recent.set(key, { at: Date.now(), response });
        setTimeout(() => {
          const current = recent.get(key);
          if (current && current.response === response) recent.delete(key);
        }, QUIET_MS + 100);
        return response;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending.then((response) => response.clone());
  };
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        <script dangerouslySetInnerHTML={{ __html: pollingGuardScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
