from pathlib import Path

wizard = Path('app/books/new/book-wizard.tsx')
s = wizard.read_text()
if 'ChatGptDeviceCodePanel' not in s:
    marker = '} from "@/lib/ai/codex-browser";\n'
    s = s.replace(marker, marker + 'import { ChatGptDeviceCodePanel } from "@/components/chatgpt-device-code-panel";\n', 1)
s = s.replace('openVerificationPage: true,', 'openVerificationPage: false,', 1)
old = '''              {devicePrompt && (\n                <div className="research-note" aria-live="polite">\n                  <strong>OpenAI에서 로그인을 완료해 주세요</strong>\n                  <p>OpenAI 공식 인증 화면에서 “Codex CLI”라는 문구가 표시될 수 있습니다. 우리 서버의 Codex 세션에 ChatGPT 권한을 연결하는 정상 화면이며, 터미널에서 명령어를 입력할 필요는 없습니다. OpenAI가 인증 코드를 요청하면 자동 복사된 코드를 붙여넣으세요. 완료되면 이 화면이 자동으로 연결 상태를 확인합니다.</p>\n                  <div className="panel-actions">\n                    <a className="button button-primary compact" href={devicePrompt.verificationUrl} target="_blank" rel="noreferrer">OpenAI 로그인 계속하기</a>\n                    <button className="button secondary compact" onClick={() => void navigator.clipboard?.writeText(devicePrompt.userCode)}>인증 코드 다시 복사</button>\n                  </div>\n                  <small>코드가 자동으로 복사되지 않았다면: {devicePrompt.userCode}</small>\n                </div>\n              )}'''
new = '''              {devicePrompt && (\n                <ChatGptDeviceCodePanel verificationUrl={devicePrompt.verificationUrl} userCode={devicePrompt.userCode} />\n              )}'''
if old not in s:
    raise SystemExit('wizard device prompt block not found')
s = s.replace(old, new, 1)
wizard.write_text(s)

editor = Path('app/books/[id]/book-editor.tsx')
s = editor.read_text()
if 'ChatGptDeviceCodePanel' not in s:
    marker = 'import { connectCodexChatGPT, getCodexConnectionStatus, type CodexDeviceEvent } from "@/lib/ai/codex-browser";\n'
    s = s.replace(marker, marker + 'import { ChatGptDeviceCodePanel } from "@/components/chatgpt-device-code-panel";\n', 1)
s = s.replace('const result=await connectCodexChatGPT({onEvent(event:CodexDeviceEvent)', 'const result=await connectCodexChatGPT({openVerificationPage:false,onEvent(event:CodexDeviceEvent)', 1)
old = '''        {devicePrompt&&<div className="research-note"><strong>OpenAI에서 로그인을 완료해 주세요</strong><p>OpenAI 공식 인증 화면에서 “Codex CLI”라는 문구가 표시될 수 있습니다. 이는 정상이며 터미널을 직접 사용할 필요는 없습니다. 인증 코드가 필요하면 자동 복사된 코드를 붙여넣으세요. 완료되면 이 화면이 자동으로 연결을 확인합니다.</p><div className="panel-actions"><a className="button button-primary compact" href={devicePrompt.verificationUrl} target="_blank" rel="noreferrer">OpenAI 로그인 계속하기</a><button className="button secondary compact" onClick={()=>void navigator.clipboard?.writeText(devicePrompt.userCode)}>인증 코드 다시 복사</button></div><small>필요한 경우 코드: {devicePrompt.userCode}</small></div>}'''
new = '''        {devicePrompt&&<ChatGptDeviceCodePanel verificationUrl={devicePrompt.verificationUrl} userCode={devicePrompt.userCode}/>}'''
if old not in s:
    raise SystemExit('editor device prompt block not found')
s = s.replace(old, new, 1)
editor.write_text(s)

css = Path('app/globals.css')
s = css.read_text()
marker = '/* ChatGPT device code authorization */'
if marker not in s:
    s += '''\n\n/* ChatGPT device code authorization */\n.chatgpt-device-panel {\n  margin: 18px 0;\n  padding: clamp(20px, 4vw, 30px);\n  border: 1px solid var(--line-strong);\n  border-radius: var(--radius-md);\n  background: var(--paper);\n  box-shadow: 0 10px 30px rgba(23, 25, 20, .06);\n}\n.chatgpt-device-kicker { margin-bottom: 8px; color: var(--accent); font-size: 10px; font-weight: 800; letter-spacing: .12em; }\n.chatgpt-device-panel h2 { margin-bottom: 8px; font-size: clamp(22px, 4vw, 30px); }\n.chatgpt-device-intro { max-width: 58ch; margin-bottom: 18px; color: var(--muted-strong); font-size: 13px; }\n.chatgpt-device-code {\n  width: 100%;\n  margin: 0 0 20px;\n  padding: 20px 18px;\n  display: grid;\n  gap: 7px;\n  border: 1px solid #aebaf3;\n  border-radius: var(--radius-md);\n  background: var(--accent-soft);\n  color: var(--ink);\n  text-align: center;\n}\n.chatgpt-device-code:hover { border-color: var(--accent); background: #e6ebff; }\n.chatgpt-device-code > span { font-size: clamp(30px, 8vw, 52px); font-weight: 790; line-height: 1; letter-spacing: .12em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }\n.chatgpt-device-code small { color: var(--success); font-size: 12px; font-weight: 720; letter-spacing: 0; }\n.chatgpt-device-steps { margin: 0 0 20px; padding: 0; display: grid; gap: 10px; list-style: none; }\n.chatgpt-device-steps li { display: grid; grid-template-columns: 28px minmax(0,1fr); gap: 11px; align-items: start; }\n.chatgpt-device-steps li > span { width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 50%; background: var(--surface-subtle); font-size: 11px; font-weight: 780; }\n.chatgpt-device-steps p { margin: 0; display: grid; gap: 2px; }\n.chatgpt-device-steps strong { font-size: 13px; }\n.chatgpt-device-steps small { color: var(--muted); font-size: 11px; }\n.chatgpt-device-actions { display: flex; flex-wrap: wrap; gap: 8px; }\n.chatgpt-device-note { margin: 14px 0 0; padding-top: 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; }\n@media (max-width: 640px) {\n  .chatgpt-device-panel { margin-inline: -2px; padding: 18px 14px; }\n  .chatgpt-device-code { padding: 18px 10px; }\n  .chatgpt-device-code > span { font-size: clamp(28px, 10vw, 42px); letter-spacing: .08em; }\n  .chatgpt-device-actions { display: grid; grid-template-columns: 1fr; }\n  .chatgpt-device-actions .button { width: 100%; }\n}\n'''
css.write_text(s)

print('device code UX patched')
