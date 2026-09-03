import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const accountSource = readFileSync(new URL("../app/account/page.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../components/app-shell.tsx", import.meta.url), "utf8");
const shellCss = readFileSync(new URL("../components/app-shell.module.css", import.meta.url), "utf8");

test("account security page verifies the current password before changing it", () => {
  assert.match(accountSource, /signInWithPassword/);
  assert.match(accountSource, /currentPassword/);
  assert.match(accountSource, /updateUser\(\{ password: newPassword \}\)/);
  assert.match(accountSource, /새 비밀번호 확인이 일치하지 않습니다/);
});

test("account page offers password recovery without exposing raw credentials", () => {
  assert.match(accountSource, /resetPasswordForEmail/);
  assert.match(accountSource, /\/account\?recovery=1/);
  assert.match(accountSource, /현재 비밀번호를 잊었나요/);
});

test("account security is reachable from desktop and mobile app navigation", () => {
  assert.match(shellSource, /href: "\/account"/);
  assert.match(shellSource, /pathname\.startsWith\("\/account"\)/);
  assert.match(shellCss, /repeat\(4, minmax\(0, 1fr\)\)/);
});
