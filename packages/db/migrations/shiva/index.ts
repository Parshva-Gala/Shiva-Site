// Separate append-only Drizzle journal, in the same host database.
import path from "node:path";
import { migrate as migrateSqlite } from "drizzle-orm/better-sqlite3/migrator";
import { migrate as migratePostgresql } from "drizzle-orm/node-postgres/migrator";

import { isPostgresql } from "../../collection";
import type { HomarrDatabase, HomarrDatabasePostgresql } from "../../driver";

const migrationsTable = "__shiva_migrations";

export const migrateShivaSqlite = (db: HomarrDatabase, migrationsRoot: string) => {
  migrateSqlite(db, { migrationsFolder: path.join(migrationsRoot, "sqlite"), migrationsTable });
};

export const migrateShivaAsync = async (db: HomarrDatabase, migrationsRoot: string) => {
  if (isPostgresql()) {
    await migratePostgresql(db as unknown as HomarrDatabasePostgresql, {
      migrationsFolder: path.join(migrationsRoot, "postgresql"),
      migrationsTable,
      migrationsSchema: "drizzle",
    });
  } else {
    migrateShivaSqlite(db, migrationsRoot);
  }
};
