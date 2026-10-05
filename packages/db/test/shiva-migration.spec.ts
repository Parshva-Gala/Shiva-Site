import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";

import { DB_CASING } from "@homarr/core/infrastructure/db/constants";
import { defaultShivaSettings } from "@homarr/validation/shiva";

import { migrateShivaSqlite } from "../migrations/shiva";
import { shivaSettings, shivaShoppingRecords, users } from "../schema/sqlite";
import * as schema from "../schema/sqlite";

const migrations = path.resolve("packages/db/migrations");

describe("SHIVA independent append-only migrations", () => {
  it("upgrades a populated host, persists after close/reopen, and permits a later host migration", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), "shiva-migration-"));
    const file = path.join(folder, "personal.sqlite");
    const hostFolder = path.join(folder, "upstream");
    cpSync(path.join(migrations, "sqlite"), hostFolder, { recursive: true });
    let sqlite: Database.Database | undefined;
    try {
      sqlite = new Database(file);
      sqlite.pragma("foreign_keys = ON");
      let db = drizzle(sqlite, { schema, casing: DB_CASING });
      migrate(db, { migrationsFolder: hostFolder });
      await db.insert(users).values({ id: "owner", name: "Synthetic existing owner" });
      const upstreamBefore = sqlite.prepare("SELECT * FROM __drizzle_migrations ORDER BY id").all();

      migrateShivaSqlite(db, path.join(migrations, "shiva"));
      expect(sqlite.prepare("SELECT * FROM __drizzle_migrations ORDER BY id").all()).toEqual(upstreamBefore);
      expect(sqlite.prepare("SELECT * FROM __shiva_migrations").all()).toHaveLength(1);
      const now = new Date();
      const settings = JSON.stringify({ ...defaultShivaSettings, privacy: true, schemaVersion: 1 });
      await db.insert(shivaSettings).values({ userId: "owner", revision: 1, settings, updatedAt: now });
      await db.insert(shivaShoppingRecords).values({
        id: "purchase",
        userId: "owner",
        name: "Synthetic lamp",
        category: "Home",
        priority: "high",
        estimatedPriceMinor: 29,
        currency: "INR",
        stage: "budgeted",
        notes: "Synthetic persistence fixture",
        url: "",
        createdAt: now,
        updatedAt: now,
      });
      sqlite.close();

      sqlite = new Database(file);
      sqlite.pragma("foreign_keys = ON");
      db = drizzle(sqlite, { schema, casing: DB_CASING });
      migrate(db, { migrationsFolder: hostFolder });
      migrateShivaSqlite(db, path.join(migrations, "shiva"));
      expect((await db.query.shivaSettings.findFirst())?.settings).toBe(settings);
      expect((await db.query.shivaShoppingRecords.findFirst())?.estimatedPriceMinor).toBe(29);
      expect((await db.query.users.findFirst())?.name).toBe("Synthetic existing owner");
      expect(sqlite.prepare("SELECT * FROM __shiva_migrations").all()).toHaveLength(1);

      // Simulate the next upstream append in a copied fixture, leaving tracked/applied histories intact.
      const journalPath = path.join(hostFolder, "meta/_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
        entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
      };
      const last = journal.entries.at(-1);
      if (!last) throw new Error("Missing host migration fixture.");
      journal.entries.push({ ...last, idx: last.idx + 1, when: last.when + 1, tag: "0049_future_host_fixture" });
      writeFileSync(journalPath, JSON.stringify(journal));
      writeFileSync(
        path.join(hostFolder, "0049_future_host_fixture.sql"),
        "CREATE TABLE host_future_fixture (id text PRIMARY KEY);",
      );
      migrate(db, { migrationsFolder: hostFolder });
      migrateShivaSqlite(db, path.join(migrations, "shiva"));
      expect(sqlite.prepare("SELECT * FROM __drizzle_migrations").all()).toHaveLength(upstreamBefore.length + 1);
      expect(sqlite.prepare("SELECT * FROM __shiva_migrations").all()).toHaveLength(1);
      expect((await db.query.shivaShoppingRecords.findFirst())?.estimatedPriceMinor).toBe(29);
      expect((await db.query.shivaSettings.findFirst())?.settings).toBe(settings);
    } finally {
      sqlite?.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
