const DUPLICATE_ACCOUNT_PATTERNS = [
  "already been registered",
  "already registered",
  "user already registered",
  "email address has already been registered"
];

function rawMessage(error: unknown) {
  if (error instanceof Error) return error.message.trim();
  if (typeof error === "string") return error.trim();
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message.trim();
  }
  return "";
}

export function isAccountAlreadyRegistered(error: unknown) {
  const message = rawMessage(error).toLowerCase();
  return DUPLICATE_ACCOUNT_PATTERNS.some((pattern) => message.includes(pattern));
}

export function userFacingAuthError(error: unknown, fallback = "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.") {
  const message = rawMessage(error);
  const lower = message.toLowerCase();

  if (!message) return fallback;
  if (isAccountAlreadyRegistered(message)) return "이미 가입된 이메일입니다. 기존 계정으로 로그인해 주세요.";
  if (lower.includes("invalid login credentials")) return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (lower.includes("email not confirmed")) return "이메일 인증이 아직 완료되지 않았습니다. 받은편지함의 인증 메일을 확인해 주세요.";
  if (lower.includes("too many requests") || lower.includes("rate limit")) return "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.";
  if (lower.includes("network") || lower.includes("failed to fetch")) return "네트워크 연결을 확인한 뒤 다시 시도해 주세요.";
  if (/[가-힣]/u.test(message)) return message;

  return fallback;
}
