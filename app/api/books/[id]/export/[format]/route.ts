import { handleBookExport } from "@/lib/export/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; format: string }> }
) {
  const { id, format } = await params;
  return handleBookExport(id, format.toLowerCase());
}
