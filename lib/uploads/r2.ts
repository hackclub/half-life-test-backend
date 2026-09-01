import "server-only"
import { randomUUID } from "node:crypto"
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3"

export const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_MAX_BYTES ?? 104_857_600)

const EXTENSION_MIME: Record<string, string[]> = {
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png: ["image/png"],
  gif: ["image/gif"],
  webp: ["image/webp"],
  mp4: ["video/mp4"],
  webm: ["video/webm"],
  mov: ["video/quicktime"],
}

export function isUploadConfigured(): boolean {
  return !!(
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY &&
    process.env.S3_BUCKET_NAME &&
    process.env.S3_ENDPOINT
  )
}

function client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
  })
}

/** Both extension and MIME type must be on the allowlist and must agree. */
export function validateUpload(
  filename: string,
  contentType: string,
  size: number,
): { ok: true; ext: string } | { ok: false; reason: string } {
  if (size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: `File is larger than ${MAX_UPLOAD_BYTES} bytes` }
  }
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  const allowed = EXTENSION_MIME[ext]
  if (!allowed) return { ok: false, reason: `Unsupported file type: .${ext}` }
  if (!allowed.includes(contentType)) {
    return { ok: false, reason: `Content type ${contentType} does not match .${ext}` }
  }
  return { ok: true, ext }
}

/**
 * Keys are namespaced by user. Stasis's flat `folder/timestamp-random.ext`
 * makes abuse untraceable and orphan cleanup impossible.
 */
export function buildObjectKey(userId: string, folder: string, ext: string): string {
  return `${folder}/${userId}/${randomUUID()}.${ext}`
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}

/**
 * Mint a public URL from a stored key. Keys are stored rather than URLs so the
 * bucket or CDN can move without rewriting every row.
 */
export function publicUrlFor(key: string | null | undefined): string | null {
  if (!key) return null
  const base = process.env.S3_PUBLIC_URL
  if (!base) return null
  return `${base.replace(/\/$/, "")}/${key}`
}
