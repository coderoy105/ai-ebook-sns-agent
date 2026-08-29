from pathlib import Path

path = Path('app/books/new/book-wizard.tsx')
s = path.read_text()

header_marker = '''        </header>\n\n        <div className="wizard-workspace">'''
header_replacement = '''        </header>\n\n        {devicePrompt && (\n          <ChatGptDeviceCodePanel verificationUrl={devicePrompt.verificationUrl} userCode={devicePrompt.userCode} />\n        )}\n\n        <div className="wizard-workspace">'''
if header_marker not in s:
    raise SystemExit('wizard header marker not found')
s = s.replace(header_marker, header_replacement, 1)

step_block = '''              {devicePrompt && (\n                <ChatGptDeviceCodePanel verificationUrl={devicePrompt.verificationUrl} userCode={devicePrompt.userCode} />\n              )}\n\n'''
if step_block not in s:
    raise SystemExit('step-scoped device panel not found')
s = s.replace(step_block, '', 1)

s = s.replace(
    '버튼을 누르면 OpenAI 공식 인증 페이지가 열립니다. OpenAI 페이지에는 “Codex CLI”라는 문구가 표시될 수 있지만 터미널을 직접 사용할 필요는 없습니다. 계정 로그인 후 자동 복사된 인증 코드를 붙여넣으면 이 화면이 연결 완료를 자동으로 확인합니다.',
    '버튼을 누르면 먼저 이 화면에 9자리 일회용 코드가 크게 표시되고 자동 복사를 시도합니다. 코드를 확인한 다음 “OpenAI 인증 페이지 열기”를 눌러 붙여넣으세요. OpenAI 페이지에 “Codex CLI”라는 문구가 표시돼도 정상이며 터미널을 직접 사용할 필요는 없습니다.'
)

path.write_text(s)
print('global device code panel applied')
