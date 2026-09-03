import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const loginSource = readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");
const errorSource = readFileSync(new URL("../lib/auth/user-facing-errors.ts", import.meta.url), "utf8");

test("duplicate signup attempts reuse the existing account instead of showing Supabase raw English", () => {
  assert.match(loginSource, /isAccountAlreadyRegistered\(registrationError\)/);
  assert.match(loginSource, /signInExistingAccount\(normalizedEmail\)/);
  assert.match(loginSource, /setMode\("login"\)/);
  assert.match(loginSource, /이미 가입된 이메일입니다/);
});

test("common Supabase auth errors are translated for Korean users", () => {
  assert.match(errorSource, /already been registered/);
  assert.match(errorSource, /invalid login credentials/);
  assert.match(errorSource, /email not confirmed/);
  assert.match(errorSource, /이메일 또는 비밀번호가 올바르지 않습니다/);
  assert.match(errorSource, /return fallback/);
});
