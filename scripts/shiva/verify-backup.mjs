// SHIVA extension, Apache-2.0. Synthetic fixture backup/reopen and asset-copy drill.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
assert(process.argv.includes("--isolated-verification"), "Require the isolated synthetic verification flag.");
const require = createRequire(path.join(root, "apps/nextjs/package.json"));
const Database = require("better-sqlite3");
const sourcePath = path.join(root, "artifacts/verification.sqlite");
const assetSource = path.join(root, "artifacts/verification-assets");
const source = new Database(sourcePath, { readonly: true });
const users = source.prepare("SELECT id, name FROM user").all();
assert.equal(users.length, 1, "Only the private synthetic account is allowed.");
assert.equal(users[0].name, "shiva-verification", "Never back up real accounts with this fixture utility.");
const owner = createHash("sha256").update(users[0].id).digest("hex");
const settingsRows = source.prepare("SELECT * FROM shiva_settings ORDER BY user_id").all();
const records = source.prepare("SELECT * FROM shiva_shopping_record ORDER BY id").all();
assert(
  records.every(
    (record) => record.name.startsWith("SHIVA Verification") || record.name.startsWith("SHIVA Performance"),
  ),
  "Unexpected non-fixture record.",
);
assert(settingsRows.length > 0, "Save the fixture appearance before the restore drill.");
const outputParent = path.join(root, "artifacts/restore-verification");
await mkdir(outputParent, { recursive: true });
const output = await mkdtemp(path.join(outputParent, "copy-"));
const destinationPath = path.join(output, "db.sqlite");
await source.backup(destinationPath);
source.close();
let assetCount = 0;
try {
  await cp(assetSource, path.join(output, "wallpapers"), { recursive: true, errorOnExist: true });
  const files = await readdir(path.join(assetSource, owner));
  for (const filename of files) {
    const [before, after] = await Promise.all([
      readFile(path.join(assetSource, owner, filename)),
      readFile(path.join(output, "wallpapers", owner, filename)),
    ]);
    assert.equal(createHash("sha256").update(before).digest("hex"), createHash("sha256").update(after).digest("hex"));
    if (/^[a-f0-9]{64}\.webp$/.test(filename)) assetCount++;
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
for (let reopen = 0; reopen < 2; reopen++) {
  const restored = new Database(destinationPath, { readonly: true });
  assert.deepEqual(restored.prepare("SELECT * FROM shiva_settings ORDER BY user_id").all(), settingsRows);
  assert.deepEqual(restored.prepare("SELECT * FROM shiva_shopping_record ORDER BY id").all(), records);
  assert.equal(restored.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  for (const table of ["__drizzle_migrations", "__shiva_migrations"]) {
    assert(
      restored.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n > 0,
      "Both migration journals must be retained.",
    );
  }
  restored.close();
}
let referencedAssets = 0;
for (const row of settingsRows) {
  const settings = JSON.parse(row.settings);
  assert.equal(settings.schemaVersion, 1);
  for (const theme of [settings.theme, ...settings.presets]) {
    const match = /^\/api\/shiva\/wallpaper\/([a-f0-9]{64})$/.exec(theme.wallpaper);
    if (!match) continue;
    const bytes = await readFile(path.join(output, "wallpapers", owner, `${match[1]}.webp`));
    assert(bytes.length > 0);
    referencedAssets++;
  }
}
const report = {
  recordedAt: new Date().toISOString(),
  method:
    "SQLite online backup API, stable synthetic settings/records, separate owner-scoped asset copy, two restored reopen/integrity checks",
  coordination:
    "Run sequentially while no fixture writes or asset changes occur; normal user backup instructions stop the app.",
  settingsCount: settingsRows.length,
  recordCount: records.length,
  copiedImages: assetCount,
  referencedImagesVerified: referencedAssets,
  journalsRetained: true,
  restoredDirectory: path.relative(root, output),
  passed: true,
};
await writeFile(path.join(root, "artifacts/backup-report.json"), JSON.stringify(report, null, 2));
console.log(
  `PASS isolated backup/reopen: ${records.length} records, ${assetCount} copied images, ${referencedAssets} owned image references.`,
);
