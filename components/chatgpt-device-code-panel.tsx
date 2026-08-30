"use client";

import { useEffect, useState } from "react";
import { CODEX_CONNECTED_EVENT, getCodexVerificationUrl } from "@/lib/ai/codex-browser";
import styles from "./chatgpt-device-code-panel.module.css";

type Props = {
  verificationUrl: string;
  userCode: string;
};

const DEVICE_CODE_LIFETIME_SECONDS = 15 * 60;

function formatRemaining(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = Math.max(0, totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function ChatGptDeviceCodePanel({ verificationUrl, userCode }: Props) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const [opened, setOpened] = useState(false);
  const [connected, setConnected] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(DEVICE_CODE_LIFETIME_SECONDS);
  const safeVerificationUrl = getCodexVerificationUrl(verificationUrl);

  async function copyCode() {
    if (!navigator.clipboard?.writeText) {
      setCopied(false);
      return;
    }
    try {
      await navigator.clipboard.writeText(userCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    let active = true;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(userCode)
        .then(() => { if (active) setCopied(true); })
        .catch(() => { if (active) setCopied(false); });
    }
    return () => { active = false; };
  }, [userCode]);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setRemainingSeconds(Math.max(0, DEVICE_CODE_LIFETIME_SECONDS - elapsed));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const handleConnected = () => setConnected(true);
    window.addEventListener(CODEX_CONNECTED_EVENT, handleConnected);
    return () => window.removeEventListener(CODEX_CONNECTED_EVENT, handleConnected);
  }, []);

  if (connected) {
    return (
      <div className={styles.backdrop} role="presentation">
        <section className={styles.successDialog} role="status" aria-live="assertive">
          <div className={styles.successMark} aria-hidden="true">✓</div>
          <h2>ChatGPT 연결 완료</h2>
          <p>OpenAI 인증이 확인되었습니다. 이 인증 화면은 자동으로 닫힙니다.</p>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.backdrop} role="presentation">
      <section
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-live="polite"
        aria-labelledby="chatgpt-device-title"
        aria-describedby="chatgpt-device-description"
      >
        <header className={styles.header}>
          <span className={styles.kicker}>CHATGPT 연결 · OPENAI 공식 인증</span>
          <h2 className={styles.title} id="chatgpt-device-title">먼저 9자리 코드를 확인하세요</h2>
          <p className={styles.intro} id="chatgpt-device-description">
            OpenAI 인증 페이지를 열기 전에 아래 코드를 복사해 두세요. 페이지의 코드 입력란에 한 번 붙여넣으면 AI Book Studio가 연결 완료를 자동으로 확인합니다.
          </p>
        </header>

        <div className={styles.codeArea}>
          <div className={styles.codeLabel}>
            <span>OpenAI 인증 코드</span>
            <span className={styles.timer}>남은 시간 약 {formatRemaining(remainingSeconds)}</span>
          </div>
          <code className={styles.code} tabIndex={0} aria-label={`OpenAI 인증 코드 ${userCode}`}>{userCode}</code>
          <p className={`${styles.copyStatus} ${copied === true ? "" : styles.copyStatusMuted}`} aria-live="polite">
            {copied === true
              ? "✓ 코드가 클립보드에 복사되었습니다"
              : copied === false
                ? "자동 복사가 안 됐습니다. 코드를 길게 눌러 선택하거나 아래 복사 버튼을 사용하세요."
                : "코드를 클립보드에 복사하는 중…"}
          </p>
        </div>

        <ol className={styles.steps}>
          <li><div><strong>코드 복사</strong><small>위 9자리 코드는 선택 가능하며 이번 로그인에만 사용됩니다.</small></div></li>
          <li><div><strong>OpenAI 인증 페이지 열기</strong><small>페이지에 “Codex CLI”라는 문구가 표시되는 것은 정상입니다.</small></div></li>
          <li><div><strong>코드 입력 후 승인</strong><small>승인이 끝나면 이 화면이 자동으로 연결 완료 상태로 바뀝니다.</small></div></li>
        </ol>

        <div className={styles.actions}>
          {safeVerificationUrl ? (
            <a
              className="button button-primary"
              href={safeVerificationUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpened(true)}
            >
              OpenAI 인증 페이지 열기 ↗
            </a>
          ) : (
            <button className="button button-primary" type="button" disabled>인증 주소를 확인할 수 없습니다</button>
          )}
          <button type="button" className="button secondary" onClick={copyCode}>코드 다시 복사</button>
        </div>

        {opened && <p className={styles.opened}>OpenAI 페이지를 열었습니다. 코드 입력과 승인을 완료하면 여기서 자동으로 확인합니다.</p>}
        {!safeVerificationUrl && <p className={styles.error}>CODEX_LOGIN_URL_INVALID · 공식 OpenAI 인증 주소가 아니어서 열지 않았습니다.</p>}
        {remainingSeconds === 0 && <p className={styles.error}>코드 유효 시간이 지났습니다. 연결이 완료되지 않았다면 다시 “ChatGPT로 계속하기”를 눌러 새 코드를 발급받으세요.</p>}

        <p className={styles.note}>
          터미널을 직접 사용할 필요는 없습니다. 서버 내부에서는 공식 Codex App Server와 OpenAI Device Code authorization을 사용하며, 이 코드는 약 15분 동안 유효합니다.
        </p>
      </section>
    </div>
  );
}
