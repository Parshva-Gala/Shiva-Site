// SHIVA extension, Apache-2.0. Server-only file ownership and mutation coordination.
import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";

import { dbEnv } from "./db/env";

const assetIdPattern = /^[0-9a-f]{64}$/;
const assetUrlPattern = /^\/api\/shiva\/wallpaper\/([0-9a-f]{64})$/;
const globalState = globalThis as typeof globalThis & { homarrShivaAssetOwnerLocks?: Map<string, Promise<void>> };
const ownerLocks = (globalState.homarrShivaAssetOwnerLocks ??= new Map<string, Promise<void>>());

export class ShivaAssetReferenceError extends Error {
  constructor() {
    super("A wallpaper is unavailable or belongs to another account. Choose or upload it again.");
    this.name = "ShivaAssetReferenceError";
  }
}

function wallpaperDirectory() {
  if (process.env.SHIVA_ASSET_DIR?.trim()) return path.resolve(process.env.SHIVA_ASSET_DIR.trim());
  const databaseUrl = dbEnv.URL;
  if (dbEnv.DRIVER === "better-sqlite3" && databaseUrl && databaseUrl !== ":memory:") {
    return path.resolve(path.dirname(databaseUrl), "..", "shiva", "wallpapers");
  }
  return path.resolve(process.cwd(), "data", "shiva", "wallpapers");
}

export function getShivaWallpaperOwnerDirectory(userId: string) {
  const owner = createHash("sha256").update(userId).digest("hex");
  return path.join(wallpaperDirectory(), owner);
}

export function getShivaWallpaperPath(userId: string, id: string) {
  if (!assetIdPattern.test(id)) throw new ShivaAssetReferenceError();
  return path.join(getShivaWallpaperOwnerDirectory(userId), `${id}.webp`);
}

export async function assertOwnedShivaWallpaperUrls(userId: string, urls: readonly string[]) {
  await Promise.all(
    [...new Set(urls)].map(async (url) => {
      if (url === "" || url === "/shiva/midnight.svg") return;
      const match = assetUrlPattern.exec(url);
      const id = match?.[1];
      if (!id) throw new ShivaAssetReferenceError();
      try {
        const stat = await lstat(getShivaWallpaperPath(userId, id));
        if (!stat.isFile() || stat.size < 1 || stat.size > 2 * 1024 * 1024) throw new ShivaAssetReferenceError();
      } catch {
        throw new ShivaAssetReferenceError();
      }
    }),
  );
}

/** One local application server: serialize settings references with upload/deletion. */
export async function withShivaAssetOwnerLock<T>(userId: string, work: () => Promise<T>): Promise<T> {
  const previous = ownerLocks.get(userId) ?? Promise.resolve();
  const { promise: current, resolve: release } = Promise.withResolvers<void>();
  ownerLocks.set(userId, current);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (ownerLocks.get(userId) === current) ownerLocks.delete(userId);
  }
}
