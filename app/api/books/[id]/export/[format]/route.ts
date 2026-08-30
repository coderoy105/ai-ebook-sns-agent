import { handleBookExport, startBookExport } from "@/lib/export/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; format: string }> }
) {
  const { id, format } = await params;
  return startBookExport(id, format.toLowerCase());
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; format: string }> }
) {
  const { id, format } = await params;
  const jobId = new URL(request.url).searchParams.get("jobId");
  return handleBookExport(id, format.toLowerCase(), jobId);
}
