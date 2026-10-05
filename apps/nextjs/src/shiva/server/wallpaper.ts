// SHIVA extension, Apache-2.0. Uploaded bytes never become settings or executable content.
// oxlint-disable-next-line import/no-unassigned-import -- enforce the Next.js server boundary
import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import {
  getShivaWallpaperOwnerDirectory,
  getShivaWallpaperPath,
  withShivaAssetOwnerLock,
} from "@homarr/core/infrastructure/shiva-assets";
import { db, eq } from "@homarr/db";
import { shivaSettings } from "@homarr/db/schema";
import { shivaSettingsDocumentSchema } from "@homarr/validation/shiva";

export const MAX_WALLPAPER_BYTES = 2 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_WALLPAPER_BYTES + 64 * 1024;
const MAX_PIXELS = 16_000_000;
const MAX_DIMENSION = 8192;
const MAX_ASSETS = 24;
const MAX_OWNER_BYTES = 50 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 64 * 1024;
const assetIdPattern = /^[0-9a-f]{64}$/;
const assetFilePattern = /^([0-9a-f]{64})\.webp$/;
const ownersUploading = new Set<string>();
let activeUploads = 0;

export class WallpaperError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WallpaperError";
  }
}

export interface WallpaperAsset {
  id: string;
  url: string;
  size: number;
  createdAt: string;
  inUse: boolean;
}

const ownerDirectory = getShivaWallpaperOwnerDirectory;

function assetPath(userId: string, id: string) {
  if (!assetIdPattern.test(id)) throw new WallpaperError(404, "Wallpaper not found.");
  return getShivaWallpaperPath(userId, id);
}

export function assertWallpaperSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (origin !== new URL(request.url).origin || (fetchSite && fetchSite !== "same-origin")) {
    throw new WallpaperError(403, "Wallpaper changes require a same-origin request.");
  }
}

export async function readWallpaperForm(request: Request): Promise<File> {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) {
    throw new WallpaperError(400, "Choose a PNG, JPEG or WebP file.");
  }
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0) throw new WallpaperError(400, "Invalid upload length.");
    if (size > MAX_REQUEST_BYTES) throw new WallpaperError(413, "Wallpaper uploads must be at most 2 MiB.");
  }
  if (!request.body) throw new WallpaperError(400, "Choose a file to upload.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new WallpaperError(413, "Wallpaper uploads must be at most 2 MiB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new WallpaperError(400, "Invalid wallpaper upload.");
  }
  const file = form.get("file");
  if (!(file instanceof File) || form.getAll("file").length !== 1 || [...form.keys()].some((key) => key !== "file")) {
    throw new WallpaperError(400, "Upload exactly one wallpaper file.");
  }
  if (file.size < 1 || file.size > MAX_WALLPAPER_BYTES) {
    throw new WallpaperError(413, "Wallpaper uploads must be at most 2 MiB.");
  }
  return file;
}

function detectBitmap(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpeg";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  throw new WallpaperError(400, "Only genuine PNG, JPEG or WebP images are supported.");
}

function rejectAnimatedChunks(bytes: Buffer, format: "png" | "jpeg" | "webp") {
  // APNG may decode as its first frame in libvips, so inspect its chunk structure too.
  if (format === "png") {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      if (["acTL", "fcTL", "fdAT"].includes(type)) {
        throw new WallpaperError(400, "Use a still image; animated wallpapers are not supported.");
      }
      if (length > bytes.length - offset - 12) break;
      offset += length + 12;
    }
  }
  if (format === "webp") {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const type = bytes.toString("ascii", offset, offset + 4);
      const length = bytes.readUInt32LE(offset + 4);
      if (["ANIM", "ANMF"].includes(type) || (type === "VP8X" && length >= 1 && ((bytes[offset + 8] ?? 0) & 2) !== 0)) {
        throw new WallpaperError(400, "Use a still image; animated wallpapers are not supported.");
      }
      if (length > bytes.length - offset - 8) break;
      offset += 8 + length + (length % 2);
    }
  }
}

async function normalizeWallpaper(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const format = detectBitmap(bytes);
  if (file.type !== `image/${format}`)
    throw new WallpaperError(400, "The file's image type does not match its contents.");
  rejectAnimatedChunks(bytes, format);
  try {
    const image = sharp(bytes, { failOn: "error", limitInputPixels: MAX_PIXELS, sequentialRead: true });
    const metadata = await image.metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height) {
      throw new WallpaperError(400, "The image could not be decoded.");
    }
    if (
      metadata.width > MAX_DIMENSION ||
      metadata.height > MAX_DIMENSION ||
      metadata.width * metadata.height > MAX_PIXELS
    ) {
      throw new WallpaperError(400, "Choose an image below 16 megapixels and 8192 pixels per side.");
    }
    if ((metadata.pages ?? 1) > 1)
      throw new WallpaperError(400, "Use a still image; animated wallpapers are not supported.");
    // Decode/re-encode, strip metadata, honor orientation, and bound browser texture cost.
    const output = await image
      .rotate()
      .resize(2560, 2560, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 86 })
      .toBuffer();
    if (output.length > MAX_WALLPAPER_BYTES)
      throw new WallpaperError(413, "The optimized wallpaper exceeds 2 MiB; choose a smaller image.");
    return output;
  } catch (error) {
    if (error instanceof WallpaperError) throw error;
    throw new WallpaperError(400, "The image is invalid or exceeds the 16 megapixel limit.");
  }
}

async function ownerFiles(userId: string) {
  const directory = ownerDirectory(userId);
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const assets = await Promise.all(
    names
      .filter((name) => assetFilePattern.test(name))
      .map(async (name) => {
        const stat = await lstat(path.join(directory, name));
        if (!stat.isFile() || stat.size > MAX_WALLPAPER_BYTES) return null;
        const id = name.slice(0, 64);
        return {
          id,
          url: `/api/shiva/wallpaper/${id}`,
          size: stat.size,
          createdAt: (stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime).toISOString(),
        };
      }),
  );
  return assets.filter((asset): asset is NonNullable<typeof asset> => asset !== null);
}

async function usedWallpaperIds(userId: string): Promise<Set<string> | null> {
  const row = await db.query.shivaSettings.findFirst({
    where: eq(shivaSettings.userId, userId),
    columns: { settings: true },
  });
  if (!row) return new Set();
  try {
    const parsed = shivaSettingsDocumentSchema.safeParse(JSON.parse(row.settings));
    if (!parsed.success) return null;
    return new Set(
      [parsed.data.theme, ...parsed.data.presets]
        .map((theme) => theme.wallpaper)
        .filter((url) => url.startsWith("/api/shiva/wallpaper/"))
        .map((url) => url.slice("/api/shiva/wallpaper/".length)),
    );
  } catch {
    return null;
  }
}

async function saveWallpaperUnlocked(userId: string, file: File) {
  if (file.size < 1 || file.size > MAX_WALLPAPER_BYTES)
    throw new WallpaperError(413, "Wallpaper uploads must be at most 2 MiB.");
  if (ownersUploading.has(userId) || activeUploads >= 2)
    throw new WallpaperError(429, "A wallpaper upload is already running. Try again shortly.");
  ownersUploading.add(userId);
  activeUploads += 1;
  let temporaryFile: string | undefined;
  let temporaryThumbnail: string | undefined;
  try {
    const output = await normalizeWallpaper(file);
    const thumbnail = await sharp(output)
      .resize(320, 200, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer();
    if (thumbnail.length > MAX_THUMBNAIL_BYTES)
      throw new WallpaperError(400, "A thumbnail could not be generated. Choose a smaller image.");
    const id = createHash("sha256").update(output).digest("hex");
    const assets = await ownerFiles(userId);
    if (assets.some((asset) => asset.id === id)) return { url: `/api/shiva/wallpaper/${id}` };
    if (
      assets.length >= MAX_ASSETS ||
      assets.reduce((total, asset) => total + asset.size, 0) + output.length > MAX_OWNER_BYTES
    ) {
      throw new WallpaperError(
        409,
        "Wallpaper storage is full (24 images / 50 MiB). Delete an unused wallpaper before uploading another.",
      );
    }
    await mkdir(ownerDirectory(userId), { recursive: true, mode: 0o700 });
    temporaryFile = path.join(ownerDirectory(userId), `.upload-${randomUUID()}`);
    temporaryThumbnail = `${temporaryFile}.thumbnail`;
    await writeFile(temporaryFile, output, { flag: "wx", mode: 0o600 });
    await writeFile(temporaryThumbnail, thumbnail, { flag: "wx", mode: 0o600 });
    await rename(temporaryFile, assetPath(userId, id));
    temporaryFile = undefined;
    await rename(temporaryThumbnail, `${assetPath(userId, id)}.thumbnail`);
    temporaryThumbnail = undefined;
    return { url: `/api/shiva/wallpaper/${id}` };
  } finally {
    if (temporaryFile) await unlink(temporaryFile).catch(() => undefined);
    if (temporaryThumbnail) await unlink(temporaryThumbnail).catch(() => undefined);
    ownersUploading.delete(userId);
    activeUploads -= 1;
  }
}

export async function saveWallpaper(userId: string, file: File) {
  return withShivaAssetOwnerLock(userId, () => saveWallpaperUnlocked(userId, file));
}

export async function listWallpapers(userId: string): Promise<WallpaperAsset[]> {
  const [assets, used] = await Promise.all([ownerFiles(userId), usedWallpaperIds(userId)]);
  return assets
    .map((asset) => ({ ...asset, inUse: used === null || used.has(asset.id) }))
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readWallpaper(userId: string, id: string, thumbnail = false) {
  const filename = assetPath(userId, id);
  try {
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.size > MAX_WALLPAPER_BYTES) throw new WallpaperError(404, "Wallpaper not found.");
    const bytes = await readFile(filename);
    if (createHash("sha256").update(bytes).digest("hex") !== id) throw new WallpaperError(404, "Wallpaper not found.");
    if (thumbnail) {
      const thumbnailPath = `${filename}.thumbnail`;
      try {
        const thumbnailStat = await lstat(thumbnailPath);
        if (thumbnailStat.isFile() && thumbnailStat.size > 0 && thumbnailStat.size <= MAX_THUMBNAIL_BYTES)
          return new Uint8Array(await readFile(thumbnailPath));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const output = await sharp(bytes)
        .resize(320, 200, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 70 })
        .toBuffer();
      if (output.length > MAX_THUMBNAIL_BYTES) throw new WallpaperError(503, "Wallpaper thumbnail is unavailable.");
      return new Uint8Array(output);
    }
    return new Uint8Array(bytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new WallpaperError(404, "Wallpaper not found.");
    throw error;
  }
}

async function deleteWallpaperUnlocked(userId: string, id: string) {
  const filename = assetPath(userId, id);
  if (ownersUploading.has(userId)) throw new WallpaperError(409, "Wait for the current wallpaper upload to finish.");
  const used = await usedWallpaperIds(userId);
  if (used === null)
    throw new WallpaperError(
      409,
      "Saved appearance settings could not be verified. Recover settings before deleting wallpapers.",
    );
  if (used.has(id))
    throw new WallpaperError(
      409,
      "This wallpaper is used by saved appearance settings or a preset. Change those references first.",
    );
  await readWallpaper(userId, id);
  await unlink(filename);
  await unlink(`${filename}.thumbnail`).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  return { deleted: true };
}

export async function deleteWallpaper(userId: string, id: string) {
  return withShivaAssetOwnerLock(userId, () => deleteWallpaperUnlocked(userId, id));
}
