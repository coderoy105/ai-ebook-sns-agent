const EXPORT_SANDBOX_NAME = "ai-book-studio-export-store-v1";
const EXPORT_SANDBOX_TIMEOUT_MS = 44 * 60 * 1000;

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function getExportSandbox() {
  const { Sandbox } = await import("@vercel/sandbox");
  return Sandbox.getOrCreate({
    name: EXPORT_SANDBOX_NAME,
    runtime: "node24",
    resources: { vcpus: 1 },
    timeout: EXPORT_SANDBOX_TIMEOUT_MS,
    persistent: true,
    snapshotExpiration: 0,
    keepLastSnapshots: { count: 2, expiration: 0, deleteEvicted: true },
    resume: true
  });
}

export function exportArtifactPath(userId: string, jobId: string, extension: string) {
  return `exports/${safeSegment(userId)}/${safeSegment(jobId)}.${safeSegment(extension)}`;
}

export async function writeExportArtifact(input: {
  userId: string;
  jobId: string;
  extension: string;
  bytes: Uint8Array;
}) {
  const path = exportArtifactPath(input.userId, input.jobId, input.extension);
  const sandbox = await getExportSandbox();
  await sandbox.writeFiles([{ path, content: Buffer.from(input.bytes) }]);
  return {
    backend: "vercel-persistent-sandbox" as const,
    sandboxName: EXPORT_SANDBOX_NAME,
    path,
    byteLength: input.bytes.byteLength
  };
}

export async function readExportArtifact(path: string) {
  if (!path.startsWith("exports/") || path.includes("..")) throw new Error("EXPORT_ARTIFACT_PATH_INVALID");
  const sandbox = await getExportSandbox();
  const buffer = await sandbox.readFileToBuffer({ path });
  if (!buffer?.byteLength) throw new Error("EXPORT_ARTIFACT_NOT_FOUND");
  return buffer;
}
