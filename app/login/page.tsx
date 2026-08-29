"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setMessage("");
    try {
      if (mode === "register") {
        const registration = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, password })
        });
        const payload = await registration.json();
        if (!registration.ok) throw new Error(payload.error ?? "회원가입에 실패했습니다.");
      }

      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-stage">
      <section className="login-story">
        <div className="login-wordmark"><span>AI BOOK</span><strong>STUDIO</strong></div>
        <div className="login-statement">
          <h1>한 권의 책이 끝날 때까지,<br />작업 흐름을 놓치지 않습니다.</h1>
          <p>아이디어를 구조로 만들고, Section별로 쓰고, 저장하고, 고치고, 최종 파일로 내보내는 출판 작업실입니다.</p>
        </div>
        <div className="production-sequence" aria-label="책 제작 과정">
          <div><span>Plan</span><strong>독자와 목차 설계</strong></div>
          <div><span>Write</span><strong>Section 단위 장문 집필</strong></div>
          <div><span>Edit</span><strong>수정과 버전 관리</strong></div>
          <div><span>Publish</span><strong>PDF · EPUB · DOCX</strong></div>
        </div>
      </section>

      <section className="login-form-shell">
        <div className="login-mode" role="tablist" aria-label="계정 모드">
          <button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>로그인</button>
          <button role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>회원가입</button>
        </div>

        <div className="login-form-copy">
          <h2>{mode === "login" ? "작업실로 돌아가기" : "새 작업실 만들기"}</h2>
          <p>{mode === "login" ? "저장된 책과 생성 상태를 이어서 작업합니다." : "계정을 만들면 프로젝트와 원고가 계속 저장됩니다."}</p>
        </div>

        <div className="field">
          <label htmlFor="login-email">이메일</label>
          <input id="login-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="login-password">비밀번호</label>
          <input id="login-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8자 이상" autoComplete={mode === "register" ? "new-password" : "current-password"} />
        </div>

        <button className="button button-primary login-submit" disabled={!email || password.length < 8 || loading} onClick={submit}>
          {loading ? "처리 중…" : mode === "register" ? "계정 만들고 시작" : "로그인"}
        </button>
        {message && <p className="notice" role="alert">{message}</p>}
      </section>
    </main>
  );
}
