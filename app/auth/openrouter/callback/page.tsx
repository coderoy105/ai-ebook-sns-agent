"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { clearOpenRouterHandshake, getOpenRouterReturnPath, getOpenRouterVerifier, setFreeAiKey } from "@/lib/ai/openrouter-browser";

export default function OpenRouterCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("무료 AI를 연결하는 중입니다…");

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    const verifier = getOpenRouterVerifier();
    const returnTo = getOpenRouterReturnPath();
    if (!code || !verifier) {
      setMessage("무료 AI 연결 정보가 만료되었습니다. 책 화면에서 다시 연결해주세요.");
      return;
    }

    void (async () => {
      try {
        const response = await fetch("/api/auth/openrouter/exchange", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code, verifier })
        });
        const payload = await response.json();
        if (!response.ok || !payload.key) throw new Error(payload.error ?? "연결 실패");
        setFreeAiKey(payload.key);
        clearOpenRouterHandshake();
        setMessage("무료 AI 연결 완료. 책 작업으로 돌아갑니다…");
        router.replace(returnTo.startsWith("/") ? returnTo : "/books/new");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "무료 AI 연결에 실패했습니다.");
      }
    })();
  }, [router]);

  return <main className="login"><section className="panel login-card"><div className="eyebrow">FREE AI</div><h1>OpenRouter 연결</h1><p className="muted">{message}</p></section></main>;
}
