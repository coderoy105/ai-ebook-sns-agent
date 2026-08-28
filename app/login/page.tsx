"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendMagicLink() {
    setLoading(true);
    setMessage("");
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo }
    });
    setLoading(false);
    setMessage(error ? error.message : "로그인 링크를 이메일로 보냈습니다.");
  }

  return (
    <main className="login">
      <section className="panel login-card">
        <div className="eyebrow">AI BOOK STUDIO</div>
        <h1>책 한 권을 끝까지 관리하는 AI.</h1>
        <p className="muted">이메일로 로그인하면 프로젝트, 생성 상태, 원고와 버전이 영구 저장됩니다.</p>
        <div className="field">
          <label>이메일</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div className="actions">
          <button className="button" disabled={!email || loading} onClick={sendMagicLink}>
            {loading ? "전송 중…" : "로그인 링크 받기"}
          </button>
        </div>
        {message && <p className="notice">{message}</p>}
      </section>
    </main>
  );
}
