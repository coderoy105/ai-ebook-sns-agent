"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ProductMark } from "@/components/product-mark";
import { clearOpenRouterHandshake, getOpenRouterReturnPath, getOpenRouterVerifier, markFreeAiJustConnected, setFreeAiKey } from "@/lib/ai/openrouter-browser";

export default function OpenRouterCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("무료 AI 연결을 확인하고 있습니다.");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    const verifier = getOpenRouterVerifier();
    const returnTo = getOpenRouterReturnPath();
    if (!code || !verifier) {
      const timer = setTimeout(() => {
        setFailed(true);
        setMessage("연결 정보가 만료되었습니다. 책 만들기 화면에서 다시 연결해 주세요.");
      }, 0);
      return () => clearTimeout(timer);
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
        markFreeAiJustConnected();
        clearOpenRouterHandshake();
        setMessage("연결되었습니다. 저장된 작업으로 돌아갑니다.");
        router.replace(returnTo.startsWith("/") ? returnTo : "/books/new");
      } catch (error) {
        setFailed(true);
        setMessage(error instanceof Error ? error.message : "무료 AI 연결에 실패했습니다.");
      }
    })();
  }, [router]);

  return (
    <main className="connection-stage">
      <ProductMark />
      <section className={`connection-state ${failed ? "connection-error" : ""}`} aria-live="polite">
        <span>{failed ? "Connection interrupted" : "OpenRouter OAuth"}</span>
        <h1>{failed ? "연결을 완료하지 못했습니다." : "AI 연결을 마무리하는 중입니다."}</h1>
        <p>{message}</p>
        {!failed ? <div className="connection-loader" aria-hidden="true"><i /><i /><i /></div> : <a className="button button-primary" href="/books/new">책 만들기로 돌아가기</a>}
      </section>
    </main>
  );
}
