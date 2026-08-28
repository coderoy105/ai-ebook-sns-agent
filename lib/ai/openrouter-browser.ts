const KEY_STORAGE = "ai-book-openrouter-key";
const VERIFIER_STORAGE = "ai-book-openrouter-pkce-verifier";
const RETURN_STORAGE = "ai-book-openrouter-return";

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function getFreeAiKey() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(KEY_STORAGE);
}

export function setFreeAiKey(key: string) {
  window.sessionStorage.setItem(KEY_STORAGE, key);
}

export function clearFreeAiKey() {
  window.sessionStorage.removeItem(KEY_STORAGE);
}

export function getOpenRouterVerifier() {
  return window.sessionStorage.getItem(VERIFIER_STORAGE);
}

export function getOpenRouterReturnPath() {
  return window.sessionStorage.getItem(RETURN_STORAGE) ?? "/books/new";
}

export function clearOpenRouterHandshake() {
  window.sessionStorage.removeItem(VERIFIER_STORAGE);
  window.sessionStorage.removeItem(RETURN_STORAGE);
}

export async function beginFreeAiConnect(returnTo?: string) {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  const verifier = base64Url(bytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64Url(new Uint8Array(digest));
  const callbackUrl = `${window.location.origin}/auth/openrouter/callback`;

  window.sessionStorage.setItem(VERIFIER_STORAGE, verifier);
  window.sessionStorage.setItem(RETURN_STORAGE, returnTo ?? `${window.location.pathname}${window.location.search}`);

  const url = new URL("https://openrouter.ai/auth");
  url.searchParams.set("callback_url", callbackUrl);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  window.location.assign(url.toString());
}
