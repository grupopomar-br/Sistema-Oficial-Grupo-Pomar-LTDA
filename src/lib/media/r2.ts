import { AwsClient } from "aws4fetch";
import type { MediaConfig } from "../config/media.ts";
import type { MediaMetadata, MediaType } from "./contracts.ts";
import { matchesMediaSignature } from "./signature.ts";

const mediaClient = ({ accessKeyId, secretAccessKey }: MediaConfig) =>
  new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: "s3",
    region: "auto",
    retries: 0,
  });
const objectUrl = (config: MediaConfig, id: string) =>
  new URL(`/${config.bucket}/vip/${encodeURIComponent(id)}`, config.origin);

export async function mediaUploadUrl(
  config: MediaConfig,
  id: string,
  file: MediaMetadata,
  expiresIn: number,
) {
  const url = objectUrl(config, id);
  url.searchParams.set("X-Amz-Expires", String(expiresIn));
  const encodedName = encodeURIComponent(file.fileName).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const headers = {
    "Content-Type": file.contentType,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "private, no-store",
    "If-None-Match": "*",
  };
  const signed = await mediaClient(config).sign(url, {
    method: "PUT",
    headers: { ...headers, "Content-Length": String(file.sizeBytes) },
    aws: { signQuery: true, allHeaders: true },
  });
  // The browser sets the signed Content-Length when sending a File directly.
  return { url: signed.url, headers };
}

export async function mediaDownloadUrl(config: MediaConfig, id: string) {
  const url = objectUrl(config, id);
  url.searchParams.set("X-Amz-Expires", "60");
  return (
    await mediaClient(config).sign(url, {
      method: "GET",
      aws: { signQuery: true },
    })
  ).url;
}

export async function verifyMediaObject(
  config: MediaConfig,
  id: string,
  file: { contentType: MediaType; sizeBytes: number },
) {
  const end = Math.min(4096, file.sizeBytes) - 1;
  const response = await mediaClient(config).fetch(objectUrl(config, id), {
    method: "GET",
    headers: { Range: `bytes=0-${end}`, "Accept-Encoding": "identity" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    aws: { allHeaders: true },
  });
  if (response.status === 404) {
    await response.body?.cancel();
    return "missing";
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("A verificação do arquivo no R2 falhou.");
  }
  const encoding = response.headers.get("content-encoding");
  const range = response.headers.get("content-range");
  const correctRange =
    (response.status === 206 && range === `bytes 0-${end}/${file.sizeBytes}`) ||
    (response.status === 200 && file.sizeBytes <= 4096 && range === null);
  const valid =
    correctRange &&
    response.headers.get("content-length") === String(end + 1) &&
    response.headers.get("content-type") === file.contentType &&
    (!encoding || encoding === "identity") &&
    response.headers.get("content-disposition")?.startsWith("attachment;") &&
    response.headers.get("cache-control")?.includes("no-store");
  if (!valid) {
    await response.body?.cancel();
    return "invalid";
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.length === end + 1 &&
    matchesMediaSignature(file.contentType, bytes)
    ? "valid"
    : "invalid";
}
