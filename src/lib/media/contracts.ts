import { z } from "zod";

const extensions = new Map<string, MediaType>([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["heic", "image/heic"],
  ["heif", "image/heif"],
  ["webp", "image/webp"],
  ["mp4", "video/mp4"],
  ["mov", "video/quicktime"],
  ["webm", "video/webm"],
] as const);
export const mediaAccept = [
  ...Array.from(extensions.keys(), (suffix) => `.${suffix}`),
  ...new Set(extensions.values()),
].join(",");
const mime = z.enum([
  "image/png",
  "image/jpeg",
  "image/heic",
  "image/heif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);
export type MediaType = z.infer<typeof mime>;
const extensionMime = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? extensions.get(name.slice(dot + 1).toLowerCase())
    : undefined;
};
export const mediaTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const token = z.string().regex(mediaTokenPattern, "Link VIP inválido.");
const fileName = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .regex(
    /^[^\/\\\p{Cc}\p{Cf}\p{Cs}]+$/u,
    "O nome do arquivo contém caracteres inválidos.",
  );
export const mediaMetadata = z
  .strictObject({
    fileName,
    contentType: mime,
    sizeBytes: z
      .number()
      .int()
      .min(12)
      .max(500_000_000, "Vídeos podem ter até 500 MB."),
  })
  .refine(
    (value) => extensionMime(value.fileName) === value.contentType,
    "A extensão do arquivo precisa corresponder ao formato informado.",
  )
  .refine(
    (value) =>
      !value.contentType.startsWith("image/") || value.sizeBytes <= 30_000_000,
    "Imagens podem ter até 30 MB.",
  );
export type MediaMetadata = z.infer<typeof mediaMetadata>;
export function metadataForFile(file: Pick<File, "name" | "size">) {
  const fileName = file.name.trim();
  const contentType = extensionMime(fileName);
  if (!contentType)
    throw new Error(
      "Escolha uma foto PNG, JPG, HEIC ou WebP, ou um vídeo MP4, MOV ou WebM.",
    );
  return mediaMetadata.parse({
    fileName,
    contentType,
    sizeBytes: file.size,
  });
}
export const mediaRequest = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("status"), token }),
  z.strictObject({
    action: z.literal("reserve"),
    token,
    id: z.uuid(),
    file: mediaMetadata,
  }),
  z.strictObject({ action: z.literal("confirm"), token, id: z.uuid() }),
]);
export type MediaRequest = z.infer<typeof mediaRequest>;
const timestamp = z.iso.datetime({ offset: true });
export const projectMediaSchema = z.strictObject({
  expiresAt: timestamp.nullable(),
  usedBytes: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  removingIds: z.array(z.uuid()).max(100).optional(),
  files: z
    .array(
      z.strictObject({
        id: z.uuid(),
        fileName,
        contentType: mime,
        sizeBytes: z.number().int().positive(),
        receivedAt: timestamp,
      }),
    )
    .max(100),
});
export type ProjectMedia = z.infer<typeof projectMediaSchema>;

export function mediaSize(bytes: number) {
  if (bytes === 0) return "0 MB";
  const megabytes = bytes / 1_000_000;
  return megabytes >= 1
    ? `${megabytes.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(bytes / 1000))} KB`;
}
