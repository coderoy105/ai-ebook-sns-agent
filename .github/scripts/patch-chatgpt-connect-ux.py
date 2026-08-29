from pathlib import Path


def replace(path: str, old: str, new: str):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f"missing pattern in {path}: {old[:100]!r}")
    p.write_text(s.replace(old, new))

# New-book wizard: remove implementation jargon and present browser-first ChatGPT login.
path = "app/books/new/book-wizard.tsx"
replace(path, 'codexWorkerAvailable === false ? "Codex Worker 미연결 · 현재 선택 불가" : `${codexPlanType ?? "ChatGPT"} · Codex OAuth · Worker CODEX_HOME`', 'codexWorkerAvailable === false ? "ChatGPT 연결을 준비할 수 없습니다." : `${codexPlanType ?? "ChatGPT"} · 계정 연결`')
replace(path, 'codexWorkerAvailable === false ? "Codex Worker 준비 중" : codexConnecting ? "ChatGPT 로그인 대기 중…" : "ChatGPT Plus 연결"', 'codexWorkerAvailable === false ? "연결 준비 중" : codexConnecting ? "OpenAI 로그인 완료를 기다리는 중…" : "ChatGPT로 계속하기"')
replace(path, '책을 만들 AI를 선택합니다. GPT-5.6 Luna는 API 키가 아니라 ChatGPT/Codex OAuth를 사용하고, OpenRouter Free는 기존 무료 fallback입니다.', '책을 만들 AI를 선택합니다. GPT-5.6 Luna는 ChatGPT 계정을 연결해 사용하며, OpenRouter Free는 무료 대안으로 사용할 수 있습니다.')
replace(path, 'codexWorkerAvailable === false ? "Codex Worker 연결 후 사용 가능" : codexConnected ? `${codexPlanType ?? "ChatGPT"} 연결됨` : "API 키 불필요 · Codex OAuth"', 'codexWorkerAvailable === false ? "현재 연결 준비 중" : codexConnected ? `${codexPlanType ?? "ChatGPT"} 연결됨` : "Google 로그인 가능 · ChatGPT 계정 사용"')
replace(path, '현재 지속 실행 Codex Worker가 연결되지 않아 ChatGPT Plus 로그인을 시작할 수 없습니다. OpenRouter Free는 바로 사용할 수 있습니다.', '현재 ChatGPT 연결 기능을 준비할 수 없습니다. 잠시 후 다시 시도하거나 OpenRouter Free를 사용할 수 있습니다.')
replace(path, '버튼을 누르면 OpenAI의 Codex 기기 로그인 페이지가 새 탭으로 열립니다. 인증정보는 브라우저나 Supabase에 저장하지 않고 사용자별 Worker CODEX_HOME에서 관리합니다.', '버튼을 누르면 OpenAI 공식 로그인 페이지가 열립니다. Google 계정을 선택해 로그인할 수 있으며, 별도의 터미널이나 CLI 입력은 필요하지 않습니다. 로그인 완료는 이 화면에서 자동으로 확인합니다.')
replace(path, '{codexWorkerAvailable === false ? "Codex Worker 준비 중" : codexConnecting ? "로그인 완료를 기다리는 중…" : "ChatGPT Plus 연결"}', '{codexWorkerAvailable === false ? "연결 준비 중" : codexConnecting ? "OpenAI 로그인 완료를 기다리는 중…" : "ChatGPT로 계속하기"}')
replace(path, '''              {devicePrompt && (\n                <div className="research-note" aria-live="polite">\n                  <strong>새 탭에서 이 코드를 입력하세요: {devicePrompt.userCode}</strong>\n                  <p>로그인 탭을 닫았으면 아래 버튼으로 다시 열 수 있습니다. 이 화면은 로그인 완료를 기다리고 있습니다.</p>\n                  <a className="button secondary compact" href={devicePrompt.verificationUrl} target="_blank" rel="noreferrer">OpenAI 로그인 페이지 열기</a>\n                  <button className="button secondary compact" onClick={() => void navigator.clipboard?.writeText(devicePrompt.userCode)}>코드 복사</button>\n                </div>\n              )}''', '''              {devicePrompt && (\n                <div className="research-note" aria-live="polite">\n                  <strong>OpenAI에서 로그인을 완료해 주세요</strong>\n                  <p>Google 계정으로 로그인할 수 있습니다. OpenAI가 인증 코드를 요청하면 이미 클립보드에 복사된 코드를 붙여넣으면 됩니다. 완료되면 이 화면이 자동으로 연결 상태를 확인합니다.</p>\n                  <div className="panel-actions">\n                    <a className="button button-primary compact" href={devicePrompt.verificationUrl} target="_blank" rel="noreferrer">OpenAI 로그인 계속하기</a>\n                    <button className="button secondary compact" onClick={() => void navigator.clipboard?.writeText(devicePrompt.userCode)}>인증 코드 다시 복사</button>\n                  </div>\n                  <small>코드가 자동으로 복사되지 않았다면: {devicePrompt.userCode}</small>\n                </div>\n              )}''')
replace(path, 'Codex OAuth가 사용자별 Worker CODEX_HOME에 연결되어 있습니다. ChatGPT/Codex 사용 한도를 사용합니다.', 'ChatGPT 계정 연결이 완료되었습니다. 생성에는 해당 ChatGPT 계정의 사용 한도가 적용됩니다.')

# Editor: same browser-first language during reconnects.
path = "app/books/[id]/book-editor.tsx"
replace(path, '{devicePrompt&&<div className="research-note"><strong>OpenAI 기기 코드: {devicePrompt.userCode}</strong><p>새 탭의 OpenAI 로그인 페이지에서 이 코드를 입력하세요.</p><a className="button secondary compact" href={devicePrompt.verificationUrl} target="_blank" rel="noreferrer">로그인 페이지 열기</a></div>}', '{devicePrompt&&<div className="research-note"><strong>OpenAI에서 로그인을 완료해 주세요</strong><p>Google 계정으로 로그인할 수 있습니다. 인증 코드가 필요하면 자동 복사된 코드를 붙여넣으세요. 완료되면 이 화면이 자동으로 연결을 확인합니다.</p><div className="panel-actions"><a className="button button-primary compact" href={devicePrompt.verificationUrl} target="_blank" rel="noreferrer">OpenAI 로그인 계속하기</a><button className="button secondary compact" onClick={()=>void navigator.clipboard?.writeText(devicePrompt.userCode)}>인증 코드 다시 복사</button></div><small>필요한 경우 코드: {devicePrompt.userCode}</small></div>}')
replace(path, '{codexConnecting?"ChatGPT 로그인 대기 중…":`${providerLabel} ${needsReconnect?"다시 ":""}연결`}', '{codexConnecting?"OpenAI 로그인 완료를 기다리는 중…":aiProvider==="codex"?"ChatGPT로 계속하기":`${providerLabel} ${needsReconnect?"다시 ":""}연결`}')

# Connected status strip: keep technical transport details out of user-facing UI.
path = "app/books/new/codex-usage-status.tsx"
replace(path, '<small>{prettyPlan(status.planType)} · Codex OAuth</small>', '<small>{prettyPlan(status.planType)} · 계정 연결</small>')
replace(path, 'Codex model/list에서 GPT-5.6 Luna가 확인되지 않았습니다.', '현재 ChatGPT 계정에서 GPT-5.6 Luna를 사용할 수 없습니다.')
replace(path, '`Codex 사용량 ${primaryUsed}%${reset ? ` · 초기화 ${reset}` : ""}${secondaryUsed == null ? "" : ` · 보조 한도 ${secondaryUsed}%`}`', '`ChatGPT 사용량 ${primaryUsed}%${reset ? ` · 초기화 ${reset}` : ""}${secondaryUsed == null ? "" : ` · 보조 한도 ${secondaryUsed}%`}`')
replace(path, 'aria-label={`Codex 사용량 ${primaryUsed}%`}', 'aria-label={`ChatGPT 사용량 ${primaryUsed}%`}')

print("ChatGPT connect UX patched")
