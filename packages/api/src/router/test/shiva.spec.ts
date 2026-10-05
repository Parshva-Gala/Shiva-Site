import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { Session } from "@homarr/auth";
import { getShivaWallpaperOwnerDirectory, getShivaWallpaperPath } from "@homarr/core/infrastructure/shiva-assets";
import { eq } from "@homarr/db";
import { shivaSettings, shivaShoppingRecords, users } from "@homarr/db/schema";
import { createDb } from "@homarr/db/test";
import {
  defaultShivaSettings,
  graphiteTheme,
  SHIVA_SETTINGS_MAX_BYTES,
  shivaSettingsSchema,
  themeDocumentSchema,
} from "@homarr/validation/shiva";
import type { ShoppingInput } from "@homarr/validation/shiva";

import { shivaRouter } from "../shiva";

vi.mock("@homarr/auth", () => ({}));

const purchase: ShoppingInput = {
  name: "Desk lamp",
  category: "Home",
  priority: "medium",
  estimatedPrice: 1499.5,
  currency: "INR",
  stage: "researching",
  notes: "Check dimensions",
  url: "https://example.com/lamp",
};

const fixture = async () => {
  const db = createDb();
  await db.insert(users).values([{ id: "owner" }, { id: "other" }]);
  const caller = (id: string | null) =>
    shivaRouter.createCaller({
      db,
      deviceType: undefined,
      session:
        id === null
          ? null
          : ({ user: { id, permissions: [], colorScheme: "dark" }, expires: "2099-01-01" } satisfies Session),
    });
  return { db, owner: caller("owner"), other: caller("other"), anonymous: caller(null), caller };
};
const initial = () => ({ ...structuredClone(defaultShivaSettings), revision: 0 });

describe("SHIVA native storage and access", () => {
  it("requires authentication and hides another user's records and settings", async () => {
    const { owner, other, anonymous } = await fixture();
    await expect(anonymous.shoppingList()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.shoppingSummary()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.shoppingCategories()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.saveSettings(initial())).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const record = await owner.shoppingCreate(purchase);
    await owner.saveSettings({ ...initial(), privacy: true });
    expect(await other.shoppingList()).toEqual({ items: [], total: 0 });
    expect((await other.settings()).privacy).toBe(false);
    await expect(other.shoppingDetail({ id: record.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.shoppingUpdate({ id: record.id, data: purchase })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.shoppingDelete({ id: record.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await owner.shoppingList()).items[0]?.id).toBe(record.id);
  });

  it("retains CRUD changes and versioned preferences for a fresh API caller", async () => {
    const { owner, caller, db } = await fixture();
    const settings = {
      ...initial(),
      theme: graphiteTheme,
      privacy: true,
      layout: { ...defaultShivaSettings.layout, sidebar: "icons" as const },
      presets: [graphiteTheme],
      savedLayouts: [{ name: "Focus", layout: defaultShivaSettings.layout }],
    };
    await owner.saveSettings(settings);
    const record = await owner.shoppingCreate(purchase);
    await owner.shoppingUpdate({ id: record.id, data: { ...purchase, stage: "budgeted", estimatedPrice: null } });
    const fresh = caller("owner");
    expect(await fresh.settings()).toEqual({ ...settings, revision: 1, recoveryWarning: false });
    const stored = await db.query.shivaSettings.findFirst();
    expect(JSON.parse(stored?.settings ?? "{}").schemaVersion).toBe(1);
    expect(new TextEncoder().encode(stored?.settings).byteLength).toBeLessThan(SHIVA_SETTINGS_MAX_BYTES);
    expect(await fresh.shoppingDetail({ id: record.id })).toEqual(
      expect.objectContaining({
        id: record.id,
        stage: "budgeted",
        estimatedPrice: null,
        notes: purchase.notes,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
    await fresh.shoppingDelete({ id: record.id });
    expect(await owner.shoppingList()).toEqual({ items: [], total: 0 });
    await expect(owner.shoppingDelete({ id: record.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects unsafe input and stores monetary values as exact integer minor units", async () => {
    const { owner, db } = await fixture();
    for (const invalid of [
      { ...purchase, estimatedPrice: -1 },
      { ...purchase, estimatedPrice: 3.456 },
      { ...purchase, estimatedPrice: 0.0000001 },
      { ...purchase, estimatedPrice: Infinity },
      { ...purchase, url: "javascript:alert(1)" },
      { ...purchase, url: "https://user:password@example.com" },
      { ...purchase, userId: "other" } as ShoppingInput,
    ])
      await expect(owner.shoppingCreate(invalid)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (const price of [0, 0.29, 1499.5, 1_000_000_000]) {
      const record = await owner.shoppingCreate({ ...purchase, estimatedPrice: price });
      const stored = await db.query.shivaShoppingRecords.findFirst({ where: eq(shivaShoppingRecords.id, record.id) });
      expect(stored?.estimatedPriceMinor).toBe(Math.round(price * 100));
      expect((await owner.shoppingDetail({ id: record.id })).estimatedPrice).toBe(price);
    }
  });

  it("rejects stale and simultaneous settings saves instead of losing updates", async () => {
    const { owner, caller } = await fixture();
    const stale = await owner.settings();
    const attempts = await Promise.allSettled([
      owner.saveSettings({ ...initial(), privacy: true }),
      caller("owner").saveSettings({ ...initial(), theme: graphiteTheme }),
    ]);
    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: "CONFLICT" }) }),
    ]);
    const { recoveryWarning: _warning, ...current } = await owner.settings();
    await owner.saveSettings({ ...current, privacy: false });
    const { recoveryWarning: _staleWarning, ...staleInput } = stale;
    await expect(owner.saveSettings(staleInput)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await owner.settings()).revision).toBe(2);
  });

  it("reports corrupt or unsupported settings without deleting source content or records", async () => {
    const { db, owner } = await fixture();
    const record = await owner.shoppingCreate(purchase);
    for (const settings of ["{invalid", JSON.stringify({ ...defaultShivaSettings, schemaVersion: 2 })]) {
      await db
        .insert(shivaSettings)
        .values({ userId: "owner", settings, revision: 8, updatedAt: new Date() })
        .onConflictDoUpdate({ target: shivaSettings.userId, set: { settings } });
      expect(await owner.settings()).toEqual({ ...defaultShivaSettings, revision: 8, recoveryWarning: true });
      expect((await db.query.shivaSettings.findFirst())?.settings).toBe(settings);
      expect((await owner.shoppingList()).items[0]?.id).toBe(record.id);
    }
    expect(await owner.saveSettings({ ...initial(), revision: 8 })).toMatchObject({
      revision: 9,
      recoveryWarning: false,
    });
  });

  it("bounds lists and filters on the server while detail retrieves long notes", async () => {
    const { db, owner, other } = await fixture();
    const now = new Date();
    for (let start = 0; start < 2000; start += 100) {
      await db.insert(shivaShoppingRecords).values(
        Array.from({ length: 100 }, (_, n) => {
          const i = start + n;
          return {
            ...purchase,
            estimatedPrice: undefined,
            estimatedPriceMinor: 29,
            id: `synthetic_${String(i).padStart(4, "0")}`,
            userId: "owner",
            name: `Purchase ${i}`,
            category: i % 2 ? "Home" : "Office",
            priority: i % 2 ? ("high" as const) : ("medium" as const),
            stage: i % 2 ? ("budgeted" as const) : ("purchased" as const),
            notes: "Synthetic long note ".repeat(200),
            createdAt: now,
            updatedAt: now,
          };
        }),
      );
    }
    const first = await owner.shoppingList();
    const second = await owner.shoppingList({ limit: 30, offset: 30 });
    expect(first.items).toHaveLength(30);
    expect(first.total).toBe(2000);
    expect(first.items[0]?.id).toBe("synthetic_1999");
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(60);
    expect(first.items[0]).not.toHaveProperty("notes");
    expect((await owner.shoppingDetail({ id: "synthetic_1999" })).notes.length).toBeGreaterThan(3000);
    expect(
      (
        await owner.shoppingList({
          limit: 10,
          offset: 0,
          category: "Home",
          priority: "high",
          stage: "budgeted",
          search: "Purchase 19",
        })
      ).total,
    ).toBe(56);
    expect((await owner.shoppingList({ limit: 100, offset: 1999 })).items).toHaveLength(1);
    expect(await owner.shoppingCategories()).toEqual(["Home", "Office"]);
    expect(await other.shoppingCategories()).toEqual([]);
    expect((await other.shoppingSummary()).total).toBe(0);
    await expect(owner.shoppingList({ limit: 101 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.shoppingList({ limit: 5, offset: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("summarizes without mixing currencies and treats search wildcards literally", async () => {
    const { owner } = await fixture();
    await owner.shoppingCreate({ ...purchase, name: "100% cotton", stage: "budgeted", estimatedPrice: 0.29 });
    await owner.shoppingCreate({ ...purchase, name: "a_b", currency: "USD", stage: "budgeted", estimatedPrice: 12.34 });
    await owner.shoppingCreate({ ...purchase, stage: "purchased", estimatedPrice: 900 });
    expect((await owner.shoppingList({ search: "%" })).items.map((item) => item.name)).toEqual(["100% cotton"]);
    expect((await owner.shoppingList({ search: "_" })).items.map((item) => item.name)).toEqual(["a_b"]);
    expect(await owner.shoppingSummary()).toEqual({
      total: 3,
      active: 2,
      purchased: 1,
      budgetedMinorByCurrency: { INR: 29, USD: 1234, EUR: 0, GBP: 0 },
    });
  });

  it("keeps inline bitmaps out of settings and credentials out of portable themes", async () => {
    const { owner } = await fixture();
    const bitmap = "data:image/png;base64,AAAA";
    expect(
      themeDocumentSchema.safeParse({
        format: "shiva-theme",
        version: 1,
        theme: { ...graphiteTheme, wallpaper: bitmap },
      }).success,
    ).toBe(true);
    expect(
      shivaSettingsSchema.safeParse({ ...defaultShivaSettings, theme: { ...graphiteTheme, wallpaper: bitmap } })
        .success,
    ).toBe(false);
    for (const wallpaper of [
      "https://example.com/track.jpg",
      "/api/shiva/wallpaper/" + "F".repeat(64),
      "data:image/svg+xml;base64,AAAA",
    ]) {
      await expect(owner.saveSettings({ ...initial(), theme: { ...graphiteTheme, wallpaper } })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    expect(
      themeDocumentSchema.safeParse({ format: "shiva-theme", version: 1, theme: graphiteTheme, apiKey: "placeholder" })
        .success,
    ).toBe(false);
    const previousAssetDir = process.env.SHIVA_ASSET_DIR;
    const assetDir = mkdtempSync(path.join(tmpdir(), "shiva-owned-assets-"));
    process.env.SHIVA_ASSET_DIR = assetDir;
    try {
      const id = "a".repeat(64);
      const asset = "/api/shiva/wallpaper/" + id;
      await expect(
        owner.saveSettings({ ...initial(), theme: { ...graphiteTheme, wallpaper: asset } }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      mkdirSync(getShivaWallpaperOwnerDirectory("other"), { recursive: true });
      writeFileSync(getShivaWallpaperPath("other", id), "synthetic ownership fixture");
      await expect(
        owner.saveSettings({ ...initial(), theme: { ...graphiteTheme, wallpaper: asset } }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      mkdirSync(getShivaWallpaperOwnerDirectory("owner"), { recursive: true });
      writeFileSync(getShivaWallpaperPath("owner", id), "synthetic ownership fixture");
      expect(await owner.saveSettings({ ...initial(), theme: { ...graphiteTheme, wallpaper: asset } })).toMatchObject({
        theme: { wallpaper: asset },
      });
      const missing = "/api/shiva/wallpaper/" + "b".repeat(64);
      await expect(
        owner.saveSettings({ ...initial(), revision: 1, presets: [{ ...graphiteTheme, wallpaper: missing }] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect((await owner.settings()).revision).toBe(1);
    } finally {
      if (previousAssetDir === undefined) delete process.env.SHIVA_ASSET_DIR;
      else process.env.SHIVA_ASSET_DIR = previousAssetDir;
      rmSync(assetDir, { recursive: true, force: true });
    }
  });
});
