# Codex Login Skill

Reusable skill for implementing the same ChatGPT-backed Codex connection architecture used by AI Book Studio.

## Install

```bash
npx skills@latest add coderoy105/ai-ebook-sns-agent
```

The repository exposes the skill under `skills/codex-login/`.

## Invoke

```text
$codex-login
```

Example:

```text
$codex-login
이 Next.js 프로젝트에 Codex 로그인 기능을 구현해줘.
웹사이트 자체 로그인은 유지하고, 로그인한 사용자가 ChatGPT 계정으로 Codex를 연결한 뒤 그 계정으로 AI 기능을 사용할 수 있게 해줘.
연결 상태, device code, 로그아웃, 모델 확인, 실제 Codex 실행까지 구현하고 배포/검증해줘.
```

## What it builds

- ChatGPT/Codex device-code connection UX
- authenticated app-server connection API
- persistent per-user Codex runtime
- isolated `CODEX_HOME`
- connection status and disconnect
- real runtime model availability checks
- optional Codex task execution
- safe non-secret connection metadata
- production verification

## Important boundary

This skill does **not** replace the website's own user login. The website first authenticates its own user, then that user separately connects a Codex runtime with their ChatGPT account.
