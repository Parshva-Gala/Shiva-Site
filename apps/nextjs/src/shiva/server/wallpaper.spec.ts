// @vitest-environment node
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { defaultShivaSettings } from "@homarr/validation/shiva";

const mocks = vi.hoisted(() => ({ findSettings: vi.fn() }));
vi.mock("@homarr/core/infrastructure/db/env", () => ({ dbEnv: { DRIVER: "better-sqlite3", URL: ":memory:" } }));
vi.mock("@homarr/db", () => ({ db: { query: { shivaSettings: { findFirst: mocks.findSettings } } }, eq: vi.fn() }));
vi.mock("@homarr/db/schema", () => ({ shivaSettings: { userId: "userId" } }));

import {
  assertWallpaperSameOrigin,
  deleteWallpaper,
  listWallpapers,
  MAX_WALLPAPER_BYTES,
  readWallpaper,
  readWallpaperForm,
  saveWallpaper,
} from "./wallpaper";

let directory: string;
let previousDirectory: string | undefined;

beforeEach(async () => {
  previousDirectory = process.env.SHIVA_ASSET_DIR;
  directory = await mkdtemp(path.join(tmpdir(), "shiva-wallpaper-"));
  process.env.SHIVA_ASSET_DIR = directory;
  mocks.findSettings.mockResolvedValue(undefined);
});

afterEach(async () => {
  if (previousDirectory === undefined) delete process.env.SHIVA_ASSET_DIR;
  else process.env.SHIVA_ASSET_DIR = previousDirectory;
  await rm(directory, { recursive: true, force: true });
});

async function bitmap(format: "png" | "jpeg" | "webp" = "png", width = 48, height = 32) {
  const image = sharp({ create: { width, height, channels: 3, background: "#7289aa" } });
  const bytes = await image[format]().toBuffer();
  return new File([new Uint8Array(bytes)], `wallpaper.${format}`, { type: `image/${format}` });
}

describe("owned wallpaper storage", () => {
  test.each(["png", "jpeg", "webp"] as const)(
    "decodes %s, saves optimized bytes, and isolates owners",
    async (format) => {
      const file = await bitmap(format);
      const first = await saveWallpaper("owner", file);
      const again = await saveWallpaper("owner", file);
      expect(again).toEqual(first);
      expect(first.url).toMatch(/^\/api\/shiva\/wallpaper\/[a-f0-9]{64}$/);
      const id = first.url.split("/").at(-1) ?? "";
      const bytes = await readWallpaper("owner", id);
      expect((await sharp(bytes).metadata()).format).toBe("webp");
      expect(bytes.byteLength).toBeLessThanOrEqual(MAX_WALLPAPER_BYTES);
      expect(await listWallpapers("owner")).toEqual([
        expect.objectContaining({ id, url: first.url, size: bytes.byteLength, inUse: false }),
      ]);
      expect(await listWallpapers("another-owner")).toEqual([]);
      await expect(readWallpaper("another-owner", id)).rejects.toMatchObject({ status: 404 });
    },
  );

  test("rejects scripts, MIME mismatches, malformed images, animation and dimensions", async () => {
    await expect(
      saveWallpaper("owner", new File(["<svg onload='alert(1)'/>"], "image.png", { type: "image/png" })),
    ).rejects.toMatchObject({ status: 400 });
    const png = await bitmap();
    await expect(
      saveWallpaper("owner", new File([await png.arrayBuffer()], "image.jpg", { type: "image/jpeg" })),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      saveWallpaper(
        "owner",
        new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "image.png", { type: "image/png" }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(saveWallpaper("owner", await bitmap("png", 9000, 1))).rejects.toMatchObject({ status: 400 });
    const pngBytes = Buffer.from(await png.arrayBuffer());
    const animated = Buffer.concat([
      pngBytes.subarray(0, 8),
      Buffer.from([0, 0, 0, 8]),
      Buffer.from("acTL"),
      Buffer.alloc(12),
      pngBytes.subarray(8),
    ]);
    await expect(
      saveWallpaper("owner", new File([new Uint8Array(animated)], "animation.png", { type: "image/png" })),
    ).rejects.toMatchObject({ status: 400, message: expect.stringContaining("still image") });
    expect(await readdir(directory)).toEqual([]);
  });

  test("rejects large files and never resolves user-supplied filesystem paths", async () => {
    await expect(
      saveWallpaper("owner", new File([new Uint8Array(MAX_WALLPAPER_BYTES + 1)], "large.png", { type: "image/png" })),
    ).rejects.toMatchObject({ status: 413 });
    for (const id of ["../outside", "a".repeat(63), "A".repeat(64), "/etc/passwd"]) {
      await expect(readWallpaper("owner", id)).rejects.toMatchObject({ status: 404 });
    }
    expect(await readdir(directory)).toEqual([]);
  });

  test("bounds full-size and library image decoding independently", async () => {
    const saved = await saveWallpaper("owner", await bitmap("png", 3200, 2000));
    const id = saved.url.split("/").at(-1) ?? "";
    const full = await sharp(await readWallpaper("owner", id)).metadata();
    expect(full.width).toBe(2560);
    expect(full.height).toBe(1600);
    const thumbnailBytes = await readWallpaper("owner", id, true);
    const thumbnail = await sharp(thumbnailBytes).metadata();
    expect(thumbnail.width).toBe(320);
    expect(thumbnail.height).toBe(200);
    expect(thumbnailBytes.length).toBeLessThanOrEqual(64 * 1024);
  });

  test("caps asset storage while allowing duplicate uploads at the quota", async () => {
    let firstFile: File | undefined;
    for (let index = 0; index < 24; index += 1) {
      const bytes = await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: index * 10, g: 40, b: 140 } },
      })
        .png()
        .toBuffer();
      const file = new File([new Uint8Array(bytes)], "image.png", { type: "image/png" });
      firstFile ??= file;
      await saveWallpaper("owner", file);
    }
    expect(await listWallpapers("owner")).toHaveLength(24);
    if (!firstFile) throw new Error("The fixture image was not created.");
    await saveWallpaper("owner", firstFile);
    expect(await listWallpapers("owner")).toHaveLength(24);
    await expect(saveWallpaper("owner", await bitmap())).rejects.toMatchObject({ status: 409 });
  });

  test("protects current and preset references, then removes unused owned assets", async () => {
    const saved = await saveWallpaper("owner", await bitmap());
    const id = saved.url.split("/").at(-1) ?? "";
    const settings = { ...structuredClone(defaultShivaSettings), schemaVersion: 1 };
    settings.presets = [{ ...settings.theme, wallpaper: saved.url }];
    mocks.findSettings.mockResolvedValue({ settings: JSON.stringify(settings) });
    expect((await listWallpapers("owner"))[0]?.inUse).toBe(true);
    await expect(deleteWallpaper("owner", id)).rejects.toMatchObject({ status: 409 });
    settings.presets = [];
    settings.theme.wallpaper = saved.url;
    mocks.findSettings.mockResolvedValue({ settings: JSON.stringify(settings) });
    await expect(deleteWallpaper("owner", id)).rejects.toMatchObject({ status: 409 });
    mocks.findSettings.mockResolvedValue({ settings: "corrupt settings" });
    expect((await listWallpapers("owner"))[0]?.inUse).toBe(true);
    await expect(deleteWallpaper("owner", id)).rejects.toMatchObject({ status: 409 });
    mocks.findSettings.mockResolvedValue(undefined);
    expect(await deleteWallpaper("owner", id)).toEqual({ deleted: true });
    await expect(readWallpaper("owner", id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("upload request boundaries", () => {
  test("requires a same-origin mutation, including browser fetch metadata", () => {
    assertWallpaperSameOrigin(
      new Request("http://localhost:3000/api/shiva/wallpaper", {
        headers: { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" },
      }),
    );
    const headerCases: Record<string, string>[] = [
      {},
      { origin: "https://other.example" },
      { origin: "http://localhost:3000", "sec-fetch-site": "cross-site" },
    ];
    for (const headers of headerCases) {
      expect(() =>
        assertWallpaperSameOrigin(new Request("http://localhost:3000/api/shiva/wallpaper", { headers })),
      ).toThrow("same-origin");
    }
  });

  test("accepts one multipart file and rejects oversized streamed bodies and extra fields", async () => {
    const form = new FormData();
    form.set("file", await bitmap());
    const accepted = await readWallpaperForm(new Request("http://localhost/api", { method: "POST", body: form }));
    expect(accepted.type).toBe("image/png");
    form.set("extra", "not accepted");
    await expect(
      readWallpaperForm(new Request("http://localhost/api", { method: "POST", body: form })),
    ).rejects.toMatchObject({ status: 400 });
    const oversize = new Uint8Array(MAX_WALLPAPER_BYTES + 64 * 1024 + 1);
    await expect(
      readWallpaperForm(
        new Request("http://localhost/api", {
          method: "POST",
          headers: { "content-type": "multipart/form-data; boundary=example" },
          body: oversize,
        }),
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      readWallpaperForm(
        new Request("http://localhost/api", {
          method: "POST",
          headers: { "content-type": "multipart/form-data; boundary=example", "content-length": "not-a-number" },
          body: "bad",
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
