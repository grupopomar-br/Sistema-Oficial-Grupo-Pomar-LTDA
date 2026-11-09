import type { MediaType } from "./contracts.ts";

export function matchesMediaSignature(type: MediaType, bytes: Uint8Array) {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  if (type === "image/png")
    return (
      [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte) &&
      ascii(12, 4) === "IHDR"
    );
  if (type === "image/jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === "image/webp")
    return ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP";
  if (type === "video/webm")
    return (
      [26, 69, 223, 163].every((byte, i) => bytes[i] === byte) &&
      ascii(0, Math.min(bytes.length, 4096)).includes("\u0042\u0082\u0084webm")
    );
  if (bytes.length < 16 || ascii(4, 4) !== "ftyp") return false;
  const size = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(0);
  if (size < 16 || size > bytes.length) return false;
  const brands = [ascii(8, 4)];
  for (let offset = 16; offset + 4 <= size; offset += 4)
    brands.push(ascii(offset, 4));
  if (type === "video/quicktime") return brands[0] === "qt  ";
  if (type === "image/heic" || type === "image/heif") {
    if (brands.some((brand) => brand === "avif" || brand === "avis"))
      return false;
    return brands.some((brand) =>
      /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand),
    );
  }
  return (
    brands.some((brand) =>
      /^(isom|iso[2-9]|mp41|mp42|avc1|M4V |dash)$/.test(brand),
    ) && !brands.some((brand) => /^(heic|heix|mif1|avif|qt  )$/.test(brand))
  );
}
