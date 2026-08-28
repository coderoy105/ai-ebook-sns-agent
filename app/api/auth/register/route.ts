import { NextResponse } from "next/server";
import { registerViaServiceBridge } from "@/lib/supabase/service-bridge";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase() ?? "";
    const password = body.password ?? "";
    if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "올바른 이메일을 입력해 주세요." }, { status: 400 });
    if (password.length < 8 || password.length > 128) return NextResponse.json({ error: "비밀번호는 8~128자로 입력해 주세요." }, { status: 400 });

    const result = await registerViaServiceBridge(email, password);
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "회원가입에 실패했습니다." }, { status: 500 });
  }
}
