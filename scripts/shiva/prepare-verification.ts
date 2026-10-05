// Local test account only. Never import this fixture into a personal database.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, eq } from "../../packages/db/index";
import { users } from "../../packages/db/schema";
import { updateServerSettingByKeyAsync } from "../../packages/db/queries";
import { defaultServerSettings } from "../../packages/server-settings/src/index";
import { seedAdminUserAsync } from "../../e2e/shared/seed-admin-user";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const expected = path.join(root, "artifacts", "verification.sqlite");
if (process.argv[2] !== "--isolated-verification" || path.resolve(process.env.DB_URL ?? ".") !== expected) {
  throw new Error(
    "This fixture requires --isolated-verification and the isolated artifacts/verification.sqlite database.",
  );
}
const credentialPath = path.join(root, "artifacts", "verification-credentials.json");
async function main() {
  const configuredUsers = await db.query.users.findMany({ columns: { name: true }, limit: 2 });
  if (configuredUsers.length > 1 || configuredUsers.some((user) => user.name !== "shiva-verification")) {
    throw new Error("Preserve any database containing accounts other than the isolated verification account.");
  }
  await updateServerSettingByKeyAsync(db, "branding", defaultServerSettings.branding);
  await updateServerSettingByKeyAsync(db, "analytics", defaultServerSettings.analytics);
  await updateServerSettingByKeyAsync(db, "user", defaultServerSettings.user);
  const existing = await db.query.users.findFirst({ where: eq(users.name, "shiva-verification") });
  if (existing) {
    await readFile(credentialPath);
    console.log("Existing isolated verification account preserved.");
  } else {
    const credentials = { username: "shiva-verification", password: randomBytes(32).toString("base64url") };
    await mkdir(path.dirname(credentialPath), { recursive: true });
    await seedAdminUserAsync(db, credentials);
    await writeFile(credentialPath, JSON.stringify(credentials), { mode: 0o600, flag: "wx" });
    console.log("Created isolated synthetic verification account; credentials are private and not printed.");
  }
  process.exit(0);
}
void main();
