// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";

import type * as WallpaperModule from "~/shiva/server/wallpaper";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), save: vi.fn(), read: vi.fn(), remove: vi.fn() }));
vi.mock("@homarr/auth/next", () => ({ auth: mocks.auth }));
vi.mock("@homarr/core/infrastructure/logs", () => ({ createLogger: () => ({ error: vi.fn() }) }));
vi.mock("~/shiva/server/wallpaper", async (importOriginal) => {
  const original = await importOriginal<typeof WallpaperModule>();
  return {
    ...original,
    listWallpapers: mocks.list,
    saveWallpaper: mocks.save,
    readWallpaper: mocks.read,
    deleteWallpaper: mocks.remove,
  };
});
vi.mock("@homarr/core/infrastructure/db/env", () => ({ dbEnv: { DRIVER: "better-sqlite3", URL: ":memory:" } }));
vi.mock("@homarr/db", () => ({ db: {}, eq: vi.fn() }));
vi.mock("@homarr/db/schema", () => ({ shivaSettings: {} }));

import { GET, POST } from "./route";
import { DELETE, GET as GET_ASSET } from "./[id]/route";

const id = "a".repeat(64);
const context = { params: Promise.resolve({ id }) };
const requestUrl = `http://localhost:3000/api/shiva/wallpaper/${id}`;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner" } });
  mocks.list.mockResolvedValue([]);
  mocks.read.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mocks.remove.mockResolvedValue({ deleted: true });
});

test("unauthenticated requests never read, list, save or delete files", async () => {
  mocks.auth.mockResolvedValue(null);
  expect((await GET()).status).toBe(401);
  expect((await POST(new Request(requestUrl, { method: "POST" }))).status).toBe(401);
  expect((await GET_ASSET(new Request(requestUrl), context)).status).toBe(401);
  expect((await DELETE(new Request(requestUrl, { method: "DELETE" }), context)).status).toBe(401);
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
});

test("cross-origin POST and DELETE do not reach storage", async () => {
  const headers = { origin: "https://malicious.example" };
  expect((await POST(new Request(requestUrl, { method: "POST", headers }))).status).toBe(403);
  expect((await DELETE(new Request(requestUrl, { method: "DELETE", headers }), context)).status).toBe(403);
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
});

test("serves only the authenticated owner's bytes with private image headers", async () => {
  const result = await GET_ASSET(new Request(requestUrl), context);
  expect(result.status).toBe(200);
  expect(mocks.read).toHaveBeenCalledWith("owner", id, false);
  expect(result.headers.get("content-type")).toBe("image/webp");
  expect(result.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  expect(result.headers.get("vary")).toBe("Cookie");
  expect(result.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  expect(result.headers.get("x-content-type-options")).toBe("nosniff");
  expect((await GET()).headers.get("cache-control")).toBe("no-store");
});

test("does not disclose internal paths or parser messages on storage failure", async () => {
  mocks.read.mockRejectedValue(new Error("secret /home/private/path"));
  const result = await GET_ASSET(new Request(requestUrl), context);
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain("/home/private");
});

test("serves separately cached bounded library thumbnails for the authenticated owner", async () => {
  const result = await GET_ASSET(new Request(`${requestUrl}?thumbnail=1`), context);
  expect(mocks.read).toHaveBeenCalledWith("owner", id, true);
  expect(result.headers.get("etag")).toBe(`"${id}-thumbnail"`);
});
