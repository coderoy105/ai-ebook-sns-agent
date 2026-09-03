"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { requestPasswordResetEmail } from "@/lib/auth/password-recovery";
import { isAccountAlreadyRegistered, userFacingAuthError } from "@/lib/auth/user-facing-errors";
import styles from "./login.module.css";

type RegistrationPayload = { error?: unknown };
type AuthMode = "login" | "register";

function EyeIcon({ hidden }: { hidden: boolean }) {
  return hidden ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3l18 18M10.6 10.7a2 2 0 002.7 2.7M9.9 4.4A10.8 10.8 0 0112 4c5.3 0 9 4.6 9 4.6a16 16 0 01-3.1 3.2M6.2 6.2C4.2 7.4 3 8.6 3 8.6S6.7 13.2 12 13.2c.8 0 1.6-.1 2.3-.3" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12s3.7-5 9-5 9 5 9 5-3.7 5-9 5-9-5-9-5z" />
      <circle cx="12" cy="12" r="2.4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5.5" y="10" width="13" height="10" rx="2.2" />
      <path d="M8.5 10V7.7a3.5 3.5 0 017 0V10" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"info" | "error">("info");
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const minimumPasswordLength = mode === "register" ? 8 : 6;

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setMessage("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
  }

  async function signInExistingAccount(normalizedEmail: string) {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    if (error) return error;
    router.replace("/dashboard");
    router.refresh();
    return null;
  }

  async function sendPasswordReset() {
    if (resetLoading) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setMessageKind("error");
      setMessage("비밀번호를 재설정할 이메일을 먼저 입력해 주세요.");
      return;
    }

    setResetLoading(true);
    setMessage("");
    try {
      const { error } = await requestPasswordResetEmail(
        normalizedEmail,
        `${window.location.origin}/account?recovery=1`
      );
      if (error) throw error;
      setMessageKind("info");
      setMessage("비밀번호 재설정 메일을 보냈습니다. 메일의 링크를 열어 새 비밀번호를 설정해 주세요.");
    } catch (error) {
      setMessageKind("error");
      setMessage(userFacingAuthError(error, "재설정 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요."));
    } finally {
      setResetLoading(false);
    }
  }

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (loading) return;

    const normalizedEmail = email.trim().toLowerCase();
    if (mode === "register" && password !== confirmPassword) {
      setMessageKind("error");
      setMessage("비밀번호 재확인이 일치하지 않습니다.");
      return;
    }
    if (mode === "register" && !termsAccepted) {
      setMessageKind("error");
      setMessage("서비스 약관에 동의해 주세요.");
      return;
    }

    setLoading(true);
    setMessage("");

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
            setConfirmPassword("");
            setShowPassword(false);
            setShowConfirmPassword(false);
            setMessageKind("error");
            setMessage("이미 가입된 이메일입니다. 로그인 탭으로 전환했습니다. 기존 비밀번호를 확인하거나 비밀번호 재설정을 이용해 주세요.");
            return;
          }
          throw new Error(userFacingAuthError(registrationError, "회원가입에 실패했습니다. 잠시 후 다시 시도해 주세요."));
        }
      }

      const loginError = await signInExistingAccount(normalizedEmail);
      if (loginError) throw loginError;
    } catch (error) {
      setMessageKind("error");
      setMessage(userFacingAuthError(
        error,
        mode === "register" ? "회원가입에 실패했습니다. 잠시 후 다시 시도해 주세요." : "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요."
      ));
    } finally {
      setLoading(false);
    }
  }

  const isLogin = mode === "login";
  const submitDisabled = !email || password.length < minimumPasswordLength || loading || resetLoading ||
    (!isLogin && (confirmPassword.length < 8 || password !== confirmPassword || !termsAccepted));

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand} aria-label="AI Book Studio">
          <span className={styles.mark} aria-hidden="true"><i /><i /></span>
          <span>AI Book Studio</span>
        </div>
      </header>

      <section className={styles.stage}>
        <div className={styles.shell}>
          <div className={styles.intro}>
            <h1>작업실로 돌아가기</h1>
            <p>저장된 원고와 AI 집필 프로젝트를 안전하게 이어가세요.</p>
          </div>

          <section className={styles.card} aria-label="계정 로그인 및 회원가입">
            <div className={styles.tabBar}>
              <div className={styles.tabs} role="tablist" aria-label="계정 모드">
                <button
                  type="button"
                  role="tab"
                  aria-selected={isLogin}
                  className={isLogin ? styles.activeTab : ""}
                  onClick={() => changeMode("login")}
                >
                  로그인
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!isLogin}
                  className={!isLogin ? styles.activeTab : ""}
                  onClick={() => changeMode("register")}
                >
                  회원가입
                </button>
              </div>
            </div>

            <div className={styles.formBody}>
              <form className={styles.form} onSubmit={submit} aria-busy={loading || resetLoading}>
                <div className={styles.field}>
                  <label htmlFor="login-email">이메일</label>
                  <input
                    id="login-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="author@studio.com"
                    autoComplete="email"
                    inputMode="email"
                    required
                  />
                </div>

                <div className={styles.field}>
                  <div className={styles.labelRow}>
                    <label htmlFor="login-password">{isLogin ? "비밀번호" : "새 비밀번호 (8자 이상)"}</label>
                    {isLogin ? (
                      <button
                        type="button"
                        className={styles.forgot}
                        aria-label="비밀번호 재설정 메일 받기"
                        onClick={sendPasswordReset}
                        disabled={resetLoading || loading}
                      >
                        {resetLoading ? "메일 보내는 중…" : "비밀번호를 잊으셨나요?"}
                      </button>
                    ) : null}
                  </div>
                  <div className={styles.passwordField}>
                    <input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder={isLogin ? "비밀번호 입력" : "안전한 비밀번호"}
                      autoComplete={isLogin ? "current-password" : "new-password"}
                      minLength={minimumPasswordLength}
                      maxLength={128}
                      required
                    />
                    <button
                      type="button"
                      className={styles.eyeButton}
                      aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      <EyeIcon hidden={showPassword} />
                    </button>
                  </div>
                </div>

                {!isLogin ? (
                  <div className={styles.field}>
                    <label htmlFor="signup-password-confirm">비밀번호 재확인</label>
                    <div className={styles.passwordField}>
                      <input
                        id="signup-password-confirm"
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="비밀번호 다시 입력"
                        autoComplete="new-password"
                        minLength={8}
                        maxLength={128}
                        required
                      />
                      <button
                        type="button"
                        className={styles.eyeButton}
                        aria-label={showConfirmPassword ? "비밀번호 확인 숨기기" : "비밀번호 확인 보기"}
                        onClick={() => setShowConfirmPassword((value) => !value)}
                      >
                        <EyeIcon hidden={showConfirmPassword} />
                      </button>
                    </div>
                  </div>
                ) : null}

                {isLogin ? (
                  <label className={styles.checkRow}>
                    <input type="checkbox" defaultChecked />
                    <span>로그인 상태 유지</span>
                  </label>
                ) : (
                  <label className={styles.termsRow}>
                    <input
                      type="checkbox"
                      checked={termsAccepted}
                      onChange={(event) => setTermsAccepted(event.target.checked)}
                      required
                    />
                    <span>집필 작업물 저작권 보호 및 <strong>서비스 약관</strong>에 동의합니다.</span>
                  </label>
                )}

                <button type="submit" className={styles.primaryButton} disabled={submitDisabled}>
                  {loading ? <><span className={styles.spinner} aria-hidden="true" /> 처리 중…</> : isLogin ? "로그인" : "작가 계정 시작하기"}
                </button>

                <div className={styles.switchRow}>
                  <span>{isLogin ? "계정이 없으신가요?" : "이미 계정이 있으신가요?"}</span>
                  <button type="button" onClick={() => changeMode(isLogin ? "register" : "login")}>
                    {isLogin ? "간편 회원가입" : "로그인"}
                  </button>
                </div>

                {message ? (
                  <p className={`${styles.notice} ${messageKind === "error" ? styles.errorNotice : styles.infoNotice}`} role="alert" aria-live="assertive">
                    {message}
                  </p>
                ) : null}
              </form>
            </div>
          </section>

          <p className={styles.securityNote}>
            <span className={styles.lockIcon}><LockIcon /></span>
            <span>모든 원고와 집필 데이터는 안전하게 암호화되어 보관됩니다</span>
          </p>

          <footer className={styles.footer}>
            <div><span>이용약관</span><i>·</i><span>개인정보처리방침</span><i>·</i><span>고객지원</span></div>
            <p>© AI Book Studio. Dedicated to the discipline of writing.</p>
          </footer>
        </div>
      </section>
    </main>
  );
}
