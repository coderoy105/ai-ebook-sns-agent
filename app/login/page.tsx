"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
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
      window.location.href = "/dashboard";
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login">
      <section className="panel login-card">
        <div className="eyebrow">AI BOOK STUDIO</div>
        <h1>책 한 권을 끝까지 관리하는 AI.</h1>
        <p className="muted">이메일과 비밀번호로 로그인하면 프로젝트, 생성 상태, 원고와 버전이 영구 저장됩니다.</p>

        <div className="actions" style={{ marginBottom: 18 }}>
          <button className={mode === "login" ? "button" : "button secondary"} onClick={() => setMode("login")}>로그인</button>
          <button className={mode === "register" ? "button" : "button secondary"} onClick={() => setMode("register")}>회원가입</button>
        </div>

        <div className="field">
          <label>이메일</label>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" />
        </div>
        <div className="field">
          <label>비밀번호</label>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8자 이상" autoComplete={mode === "register" ? "new-password" : "current-password"} />
        </div>
        <div className="actions">
          <button className="button" disabled={!email || password.length < 8 || loading} onClick={submit}>
            {loading ? "처리 중…" : mode === "register" ? "계정 만들고 시작하기" : "로그인"}
          </button>
        </div>
        {message && <p className="notice">{message}</p>}
      </section>
    </main>
  );
}
