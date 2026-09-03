"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/client";
import { userFacingAuthError } from "@/lib/auth/user-facing-errors";
import styles from "./account.module.css";

type Notice = { kind: "success" | "error" | "info"; text: string } | null;

export default function AccountPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const recoveryMode = searchParams.get("recovery") === "1";
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [notice, setNotice] = useState<Notice>(recoveryMode ? { kind: "info", text: "비밀번호 재설정 링크로 들어왔습니다. 새 비밀번호를 입력해 저장해 주세요." } : null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!active) return;
      if (error || !data.user) {
        router.replace("/login?next=/account");
        return;
      }
      setEmail(data.user.email ?? "");
    })();
    return () => { active = false; };
  }, [router, supabase]);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setNotice(null);

    if (newPassword.length < 8 || newPassword.length > 128) {
      setNotice({ kind: "error", text: "새 비밀번호는 8~128자로 입력해 주세요." });
      return;
    }
    if (newPassword !== confirmPassword) {
      setNotice({ kind: "error", text: "새 비밀번호 확인이 일치하지 않습니다." });
      return;
    }
    if (!recoveryMode && currentPassword === newPassword) {
      setNotice({ kind: "error", text: "현재 비밀번호와 다른 새 비밀번호를 입력해 주세요." });
      return;
    }
    if (!email) {
      setNotice({ kind: "error", text: "계정 이메일을 확인하지 못했습니다. 다시 로그인해 주세요." });
      return;
    }

    setLoading(true);
    try {
      if (!recoveryMode) {
        const { error: verifyError } = await supabase.auth.signInWithPassword({
          email,
          password: currentPassword
        });
        if (verifyError) {
          setNotice({ kind: "error", text: "현재 비밀번호가 올바르지 않습니다. 비밀번호를 잊었다면 아래의 이메일 재설정을 이용해 주세요." });
          return;
        }
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice({ kind: "success", text: "비밀번호를 변경했습니다. 다음 로그인부터 새 비밀번호를 사용하세요." });
      if (recoveryMode) router.replace("/account");
    } catch (error) {
      setNotice({ kind: "error", text: userFacingAuthError(error, "비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.") });
    } finally {
      setLoading(false);
    }
  }

  async function sendResetEmail() {
    if (!email || resetLoading) return;
    setResetLoading(true);
    setNotice(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/account?recovery=1`
      });
      if (error) throw error;
      setNotice({ kind: "info", text: "비밀번호 재설정 메일을 보냈습니다. 메일의 링크를 열면 새 비밀번호를 설정할 수 있습니다." });
    } catch (error) {
      setNotice({ kind: "error", text: userFacingAuthError(error, "재설정 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.") });
    } finally {
      setResetLoading(false);
    }
  }

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <AppShell>
      <div className={styles.page}>
        <header className={styles.header}>
          <span className="page-eyebrow">Account</span>
          <h1>계정과 보안</h1>
          <p>로그인 정보와 비밀번호를 안전하게 관리합니다. 원고와 백그라운드 작업은 계정에 계속 연결됩니다.</p>
        </header>

        <div className={styles.grid}>
          <section className={styles.card} aria-labelledby="account-profile-title">
            <div className={styles.cardHeading}>
              <span>PROFILE</span>
              <h2 id="account-profile-title">내 계정</h2>
            </div>
            <dl className={styles.profileList}>
              <div><dt>이메일</dt><dd>{email || "불러오는 중…"}</dd></div>
              <div><dt>보안</dt><dd>Supabase Auth · 세션 암호화</dd></div>
            </dl>
            <button type="button" className="button" onClick={signOut} disabled={signingOut}>
              {signingOut ? "로그아웃 중…" : "로그아웃"}
            </button>
          </section>

          <section className={`${styles.card} ${styles.passwordCard}`} aria-labelledby="password-title">
            <div className={styles.cardHeading}>
              <span>SECURITY</span>
              <h2 id="password-title">{recoveryMode ? "새 비밀번호 설정" : "비밀번호 변경"}</h2>
              <p>{recoveryMode ? "이메일로 확인된 복구 세션에서 새 비밀번호를 설정합니다." : "현재 비밀번호를 한 번 확인한 뒤 새 비밀번호로 변경합니다."}</p>
            </div>

            <form className={styles.form} onSubmit={changePassword} aria-busy={loading}>
              {!recoveryMode ? (
                <div className="field">
                  <label htmlFor="current-password">현재 비밀번호</label>
                  <input id="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" minLength={6} maxLength={128} required />
                </div>
              ) : null}
              <div className="field">
                <label htmlFor="new-password">새 비밀번호</label>
                <input id="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required />
                <small>8자 이상 입력해 주세요.</small>
              </div>
              <div className="field">
                <label htmlFor="confirm-password">새 비밀번호 확인</label>
                <input id="confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required />
              </div>

              <div className={styles.actions}>
                <button type="submit" className="button button-primary" disabled={loading || (!recoveryMode && !currentPassword) || newPassword.length < 8 || confirmPassword.length < 8}>
                  {loading ? <><span className="button-spinner" aria-hidden="true" /> 변경 중…</> : recoveryMode ? "새 비밀번호 저장" : "비밀번호 변경"}
                </button>
                {!recoveryMode ? (
                  <button type="button" className="text-button" onClick={sendResetEmail} disabled={resetLoading || !email}>
                    {resetLoading ? "재설정 메일 보내는 중…" : "현재 비밀번호를 잊었나요?"}
                  </button>
                ) : null}
              </div>
            </form>

            {notice ? <p className={`${styles.notice} ${styles[notice.kind]}`} role={notice.kind === "error" ? "alert" : "status"} aria-live="polite">{notice.text}</p> : null}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
