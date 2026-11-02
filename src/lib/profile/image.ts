import sharp from "sharp";

export const PROFILE_MAX_BYTES = 2 * 1024 * 1024;
export class ProfileImageError extends Error {}

export async function profileBytes(body: ReadableStream<Uint8Array> | null) {
  if (!body) throw new ProfileImageError("Selecione uma imagem.");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PROFILE_MAX_BYTES) {
        await reader.cancel();
        throw new ProfileImageError("Use uma imagem de até 2 MB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export async function normalizeProfileImage(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > PROFILE_MAX_BYTES)
    throw new ProfileImageError("Use uma imagem de até 2 MB.");
  try {
    const input = sharp(bytes, {
      limitInputPixels: 16_777_216,
      failOn: "warning",
    });
    const metadata = await input.metadata();
    if (
      !metadata.format ||
      !["jpeg", "png", "webp"].includes(metadata.format) ||
      (metadata.pages ?? 1) !== 1 ||
      !metadata.width ||
      !metadata.height
    )
      throw new Error("format");
    // Decode and re-encode: neither uploaded MIME nor the filename is trusted.
    // Metadata (including EXIF location) is discarded by default.
    return await input
      .rotate()
      .resize(512, 512, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .webp({ quality: 86 })
      .toBuffer();
  } catch {
    throw new ProfileImageError(
      "Envie uma imagem válida em PNG, JPG ou WebP, sem animação.",
    );
  }
}
