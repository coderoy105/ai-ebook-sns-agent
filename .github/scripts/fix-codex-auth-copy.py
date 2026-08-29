from pathlib import Path

files = [Path('app/books/new/book-wizard.tsx'), Path('app/books/[id]/book-editor.tsx')]

for path in files:
    s = path.read_text()
    s = s.replace(
        'Google 계정으로 로그인할 수 있습니다. OpenAI가 인증 코드를 요청하면 이미 클립보드에 복사된 코드를 붙여넣으면 됩니다. 완료되면 이 화면이 자동으로 연결 상태를 확인합니다.',
        'OpenAI 공식 인증 화면에서 “Codex CLI”라는 문구가 표시될 수 있습니다. 우리 서버의 Codex 세션에 ChatGPT 권한을 연결하는 정상 화면이며, 터미널에서 명령어를 입력할 필요는 없습니다. OpenAI가 인증 코드를 요청하면 자동 복사된 코드를 붙여넣으세요. 완료되면 이 화면이 자동으로 연결 상태를 확인합니다.'
    )
    s = s.replace(
        'Google 계정으로 로그인할 수 있습니다. 인증 코드가 필요하면 자동 복사된 코드를 붙여넣으세요. 완료되면 이 화면이 자동으로 연결을 확인합니다.',
        'OpenAI 공식 인증 화면에서 “Codex CLI”라는 문구가 표시될 수 있습니다. 이는 정상이며 터미널을 직접 사용할 필요는 없습니다. 인증 코드가 필요하면 자동 복사된 코드를 붙여넣으세요. 완료되면 이 화면이 자동으로 연결을 확인합니다.'
    )
    s = s.replace(
        '버튼을 누르면 OpenAI 공식 로그인 페이지가 열립니다. Google 계정을 선택해 로그인할 수 있으며, 별도의 터미널이나 CLI 입력은 필요하지 않습니다. 로그인 완료는 이 화면에서 자동으로 확인합니다.',
        '버튼을 누르면 OpenAI 공식 인증 페이지가 열립니다. OpenAI 페이지에는 “Codex CLI”라는 문구가 표시될 수 있지만 터미널을 직접 사용할 필요는 없습니다. 계정 로그인 후 자동 복사된 인증 코드를 붙여넣으면 이 화면이 연결 완료를 자동으로 확인합니다.'
    )
    path.write_text(s)
print('patched auth copy')
