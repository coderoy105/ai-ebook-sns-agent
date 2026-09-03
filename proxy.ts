import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  const response = await updateSession(request);
  const pathname = request.nextUrl.pathname;
  const isRecoveryEntry = pathname === "/account" && request.nextUrl.searchParams.get("recovery") === "1";
  const isPublic = pathname === "/login" || isRecoveryEntry || pathname.startsWith("/auth/") || pathname.startsWith("/api/auth/") || pathname.startsWith("/api/codex-runtime/") || pathname === "/api/health/service-bridge";

  if (!isPublic && response.headers.get("x-ai-book-user") !== "authenticated") {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"
  ]
};
