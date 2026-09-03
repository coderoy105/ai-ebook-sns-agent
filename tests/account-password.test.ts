import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const accountSource = readFileSync(new URL("../app/account/page.tsx", import.meta.url), "utf8");
const loginSource = readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8");
const recoverySource = readFileSync(new URL("../lib/auth/password-recovery.ts", import.meta.url), "utf8");
const proxySource = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../components/app-shell.module.css", import.meta.url), "utf8");

test("account security page verifies the current password before changing it", () => {
  assert.match(accountSource, /signInWithPassword/);
  assert.match(accountSource, /currentPassword/);
  assert.match(accountSource, /updateUser\(\{ password: newPassword \}\)/);
  assert.match(accountSource, /새 비밀번호 확인이 일치하지 않습니다/);
});

test("verified recovery sessions can set a new password without asking for the old password", () => {
  assert.match(accountSource, /const recoveryMode = searchParams\.get\("recovery"\) === "1"/);
  assert.match(accountSource, /if \(!recoveryMode\)/);
  assert.match(accountSource, /router\.replace\("\/account"\)/);
});

test("password recovery callbacks are allowed through the auth proxy before a session exists", () => {
  assert.ok(proxySource.includes('const isRecoveryEntry = pathname === "/account" && request.nextUrl.searchParams.get("recovery") === "1";'));
  assert.ok(proxySource.includes('pathname === "/login" || isRecoveryEntry'));
});

test("portable recovery emails use the implicit flow instead of browser-bound PKCE", () => {
  assert.ok(recoverySource.includes('flowType: "implicit"'));
  assert.ok(recoverySource.includes('persistSession: false'));
  assert.match(recoverySource, /resetPasswordForEmail/);
  assert.match(loginSource, /requestPasswordResetEmail/);
  assert.match(accountSource, /requestPasswordResetEmail/);
});

test("implicit recovery tokens are converted into the app session before checking the user", () => {
  assert.ok(accountSource.includes('window.location.hash'));
  assert.ok(accountSource.includes('hashParams.get("access_token")'));
  assert.ok(accountSource.includes('hashParams.get("refresh_token")'));
  assert.match(accountSource, /setSession/);
  assert.match(accountSource, /history\.replaceState/);
});

test("legacy PKCE recovery auth codes are still exchanged before checking the account session", () => {
  assert.ok(accountSource.includes('const authCode = searchParams.get("code");'));
  assert.ok(accountSource.includes('const flowId = searchParams.get("sb_flow_id");'));
  assert.match(accountSource, /exchangeCodeForSession/);
  assert.ok(accountSource.includes('router.replace("/account?recovery=1")'));
  assert.ok(accountSource.includes('if (recoveryMode && authCode)'));
});

test("recovery failures stay on the recovery screen instead of bouncing back to login", () => {
  assert.ok(accountSource.includes('if (recoveryMode) {'));
  assert.ok(accountSource.includes('재설정 세션을 확인하지 못했습니다'));
  assert.ok(accountSource.includes('disabled={recoveryMode && !email}'));
});

test("account and login pages both offer password recovery without exposing credentials", () => {
  assert.match(accountSource, /requestPasswordResetEmail/);
  assert.match(accountSource, /\/account\?recovery=1/);
  assert.match(accountSource, /현재 비밀번호를 잊었나요/);
  assert.match(loginSource, /requestPasswordResetEmail/);
  assert.match(loginSource, /비밀번호 재설정 메일 받기/);
  assert.match(loginSource, /\/account\?recovery=1/);
});

test("legacy existing passwords can still be entered while new passwords remain eight characters or longer", () => {
  assert.ok(loginSource.includes('const minimumPasswordLength = mode === "register" ? 8 : 6;'));
  assert.ok(loginSource.includes('minLength={minimumPasswordLength}'));
  assert.ok(accountSource.includes('autoComplete="current-password" minLength={6} maxLength={128}'));
  assert.ok(accountSource.includes('autoComplete="new-password" minLength={8} maxLength={128}'));
});

test("account security is reachable from desktop and mobile app navigation", () => {
  assert.match(shellSource, /href: "\/account"/);
  assert.match(shellSource, /pathname\.startsWith\("\/account"\)/);
  assert.match(shellCss, /repeat\(4, minmax\(0, 1fr\)\)/);
});
