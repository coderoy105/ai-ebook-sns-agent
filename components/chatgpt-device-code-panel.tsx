"use client";

import { useEffect, useState } from "react";

type Props = {
  verificationUrl: string;
  userCode: string;
};

export function ChatGptDeviceCodePanel({ verificationUrl, userCode }: Props) {
  const [copied, setCopied] = useState<boolean | null>(null);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(userCode);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  useEffect(() => {
    let active = true;
    void navigator.clipboard?.writeText(userCode)
      .then(() => { if (active) setCopied(true); })
      .catch(() => { if (active) setCopied(false); });
    return () => { active = false; };
  }, [userCode]);

  return (
    <section className="chatgpt-device-panel" aria-live="polite" aria-label="ChatGPT 연결 인증 코드">
      <div className="chatgpt-device-kicker">CHATGPT PLUS 연결</div>
      <h2>OpenAI에 이 코드를 입력하세요</h2>
      <p className="chatgpt-device-intro">아래 코드는 이번 로그인에만 사용하는 9자리 일회용 코드입니다. 코드부터 확인한 뒤 OpenAI 인증 페이지를 여세요.</p>

      <button type="button" className="chatgpt-device-code" onClick={copyCode} aria-label={`인증 코드 ${userCode}, 눌러서 복사`}>
        <span>{userCode}</span>
        <small>{copied === true ? "코드가 클립보드에 복사됐어요 ✓" : copied === false ? "자동 복사가 안 됐어요 · 여기를 눌러 복사" : "코드를 복사하는 중…"}</small>
      </button>

      <ol className="chatgpt-device-steps">
        <li><span>1</span><p><strong>코드 확인</strong><small>위 9자리 코드를 복사합니다.</small></p></li>
        <li><span>2</span><p><strong>OpenAI 인증 페이지 열기</strong><small>페이지에 “Codex CLI”가 보여도 정상입니다.</small></p></li>
        <li><span>3</span><p><strong>코드 붙여넣기</strong><small>계속을 누르면 AI Book Studio가 연결 완료를 자동으로 확인합니다.</small></p></li>
      </ol>

      <div className="chatgpt-device-actions">
        <a className="button button-primary" href={verificationUrl} target="_blank" rel="noreferrer">OpenAI 인증 페이지 열기 ↗</a>
        <button type="button" className="button secondary" onClick={copyCode}>코드 다시 복사</button>
      </div>

      <p className="chatgpt-device-note">터미널에서 CLI 명령을 직접 입력할 필요는 없습니다. OpenAI가 이 인증 화면의 이름을 “Codex CLI”로 표시하는 것입니다. 코드는 15분 후 만료됩니다.</p>
    </section>
  );
}
