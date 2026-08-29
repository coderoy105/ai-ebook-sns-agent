const method = process.argv[2] ?? "GET";
const pathWithQuery = process.argv[3] ?? "/health";
const bodyText = Buffer.from(process.env.BOOKSTUDIO_BODY_B64 ?? "", "base64").toString("utf8");

try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? "8787"}${pathWithQuery}`, {
    method,
    headers: bodyText ? { "content-type": "application/json" } : undefined,
    body: bodyText || undefined
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { error: text || `CODEX_WORKER_HTTP_${response.status}` }; }
  process.stdout.write(JSON.stringify({ status: response.status, body }));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
