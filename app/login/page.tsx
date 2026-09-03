"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ProductMark } from "@/components/product-mark";
import { createClient } from "@/lib/supabase/client";
import { isAccountAlreadyRegistered, userFacingAuthError } from "@/lib/auth/user-facing-errors";

type RegistrationPayload = { error?: unknown };

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function signInExistingAccount(normalizedEmail: string) {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    if (error) return error;
    router.replace("/dashboard");
    router.refresh();
    return null;
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (loading) return;
    setLoading(true);
    setMessage("");
    const normalizedEmail = email.trim().toLowerCase();

    try {
      if (mode === "register") {
        const registration = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: normalizedEmail, password })
        });
        const payload = await registration.json().catch(() => ({})) as RegistrationPayload;

        if (!registration.ok) {
          const registrationError = payload.error ?? "회원가입에 실패했습니다.";
          if (isAccountAlreadyRegistered(registrationError)) {
            const loginError = await signInExistingAccount(normalizedEmail);
            if (!loginError) return;

            setMode("login");
            setMessage("이미 가입된 이메일입니다. 로그인 탭으로 전환했습니다. 기존 비밀번호를 확인해 다시 로그인해 주세요.");
            return;
          }
          throw new Error(userFacingAuthError(registrationError, "회원가입에 실패했습니다. 잠시 후 다시 시도해 주세요."));
        }
      }

      const loginError = await signInExistingAccount(normalizedEmail);
      if (loginError) throw loginError;
    } catch (error) {
      setMessage(userFacingAuthError(
        error,
        mode === "register" ? "회원가입에 실패했습니다. 잠시 후 다시 시도해 주세요." : "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요."
      ));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-stage">
      <section className="login-story" aria-labelledby="login-product-title">
        <ProductMark href="/" />
        <div className="login-statement">
          <h1 id="login-product-title">책을 쓰는 일과<br />책을 완성하는 일을<br />한곳에서.</h1>
          <p>AI Book Studio는 아이디어를 원고 구조로 만들고, Section 단위로 집필하고, 수정과 버전 관리, 최종 파일 제작까지 이어지는 출판 작업 환경입니다.</p>
        </div>
        <div className="production-sequence" aria-label="책 제작 과정">
          <div><span>01</span><strong>Blueprint</strong><small>독자 · 구조 · 분량 설계</small></div>
          <div><span>02</span><strong>Manuscript</strong><small>Section 단위 장문 집필</small></div>
          <div><span>03</span><strong>Revision</strong><small>자동 저장 · 버전 복원</small></div>
          <div><span>04</span><strong>Publish</strong><small>PDF · EPUB · DOCX</small></div>
        </div>
      </section>

      <section className="login-panel">
        <form className="login-form-shell" onSubmit={submit} aria-busy={loading}>
          <div className="login-form-intro">
            <span>{mode === "login" ? "Welcome back" : "Create workspace"}</span>
            <h2>{mode === "login" ? "작업실로 돌아가기" : "새 작업실 만들기"}</h2>
            <p>{mode === "login" ? "저장된 원고와 백그라운드 생성 상태를 그대로 이어서 작업합니다." : "계정을 만들면 프로젝트, 원고, 생성 진행률이 서버에 연결됩니다."}</p>
          </div>

          <div className="login-mode" role="tablist" aria-label="계정 모드">
            <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setMessage(""); }}>로그인</button>
            <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setMessage(""); }}>회원가입</button>
          </div>

          <div className="login-fields">
            <div className="field">
              <label htmlFor="login-email">이메일</label>
              <input id="login-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" inputMode="email" required />
            </div>
            <div className="field">
              <label htmlFor="login-password">비밀번호</label>
              <input id="login-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="8자 이상" autoComplete={mode === "register" ? "new-password" : "current-password"} minLength={8} maxLength={128} required />
              <small>{mode === "register" ? "8자 이상 입력해 주세요." : "등록한 비밀번호를 입력해 주세요."}</small>
            </div>
          </div>

          <button type="submit" className="button button-primary login-submit" disabled={!email || password.length < 8 || loading}>
            {loading ? <><span className="button-spinner" aria-hidden="true" /> 처리 중…</> : mode === "register" ? "계정 만들고 시작" : "로그인"}
          </button>
          <p className="login-security-note">로그인 후 원고 데이터는 계정 권한에 따라 분리되어 표시됩니다.</p>
          {message && <p className="notice" role="alert" aria-live="assertive">{message}</p>}
        </form>
      </section>
    </main>
  );
}
