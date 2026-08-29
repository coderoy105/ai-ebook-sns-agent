from pathlib import Path

path = Path('app/books/new/book-wizard.tsx')
s = path.read_text()

old = '''  async function connectCodex() {\n    setError(\"\");\n    if (codexWorkerAvailable === false) {'''
new = '''  async function connectCodex() {\n    setError(\"\");\n    update(\"aiProvider\", \"codex\");\n    if (codexWorkerAvailable === false) {'''
if old not in s:
    raise SystemExit('connectCodex pattern not found')
s = s.replace(old, new, 1)

old = '''          {form.aiProvider === \"codex\" ? (\n            codexConnected\n              ? <button className=\"button secondary compact\" disabled={loading || codexConnecting} onClick={disconnectCodex}>ChatGPT 연결 해제</button>\n              : <button className=\"button button-primary compact\" disabled={loading || codexConnecting || codexWorkerAvailable === false} onClick={connectCodex}>{codexWorkerAvailable === false ? \"연결 준비 중\" : codexConnecting ? \"OpenAI 로그인 완료를 기다리는 중…\" : \"ChatGPT로 계속하기\"}</button>\n          ) : (\n            freeConnected\n              ? <button className=\"button secondary compact\" disabled={loading} onClick={disconnectFreeAi}>무료 AI 연결 해제</button>\n              : <button className=\"button button-primary compact\" disabled={loading} onClick={connectFreeAi}>무료 AI 연결</button>\n          )}'''
new = '''          <div className=\"panel-actions\">\n            {codexConnected\n              ? <button className=\"button secondary compact\" disabled={loading || codexConnecting} onClick={disconnectCodex}>ChatGPT 연결 해제</button>\n              : <button className=\"button button-primary compact\" disabled={loading || codexConnecting || codexWorkerAvailable === false} onClick={connectCodex}>{codexWorkerAvailable === false ? \"연결 준비 중\" : codexConnecting ? \"OpenAI 로그인 완료를 기다리는 중…\" : \"ChatGPT로 계속하기\"}</button>}\n            {form.aiProvider === \"openrouter\" && (freeConnected\n              ? <button className=\"button secondary compact\" disabled={loading} onClick={disconnectFreeAi}>무료 AI 연결 해제</button>\n              : <button className=\"button secondary compact\" disabled={loading} onClick={connectFreeAi}>무료 AI 연결</button>)}\n          </div>'''
if old not in s:
    raise SystemExit('header provider block not found')
s = s.replace(old, new, 1)

path.write_text(s)
print('patched')
