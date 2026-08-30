import { getBookExportStatus } from "@/lib/export/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; format: string }> }
) {
  const { id, format } = await params;
  const jobId = new URL(request.url).searchParams.get("jobId");
  return getBookExportStatus(id, format.toLowerCase(), jobId);
}
