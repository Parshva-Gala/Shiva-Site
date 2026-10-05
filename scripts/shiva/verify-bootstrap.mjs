// SHIVA extension, Apache-2.0. Real upstream onboarding on a separately copied, empty-user fixture.
// Root/operator starts the production app against artifacts/bootstrap-verification.sqlite first.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const origin = process.env.SHIVA_VERIFY_ORIGIN ?? "http://127.0.0.1:3000";
assert(
  process.argv.includes("--isolated-bootstrap"),
  "Require --isolated-bootstrap and the root/operator's separate bootstrap server.",
);
assert.equal(origin, "http://127.0.0.1:3000", "Only the fixed loopback verification server is allowed.");
const require = createRequire(path.join(root, "apps/nextjs/package.json"));
const Database = require("better-sqlite3");
const database = path.join(root, "artifacts/bootstrap-verification.sqlite");
const priorFixture = path.join(root, "artifacts/verification.sqlite");
const directory = path.join(root, "artifacts/browser");
const resume = process.argv.includes("--resume-bootstrap");
const bootstrapUsername = "shiva-bootstrap-verification";
await mkdir(directory, { recursive: true });

function databaseSnapshot(filename) {
  const db = new Database(filename, { readonly: true });
  try {
    const users = db.prepare("SELECT id, name FROM user ORDER BY id").all();
    const settings = db.prepare("SELECT * FROM shiva_settings ORDER BY user_id").all();
    const shopping = db.prepare("SELECT * FROM shiva_shopping_record ORDER BY id").all();
    return {
      users,
      settingsCount: settings.length,
      shoppingCount: shopping.length,
      onboarding: db
        .prepare("SELECT step FROM onboarding")
        .all()
        .map((row) => row.step),
      fingerprint: createHash("sha256").update(JSON.stringify({ users, settings, shopping })).digest("hex"),
    };
  } finally {
    db.close();
  }
}
const initial = databaseSnapshot(database);
if (resume) {
  assert.equal(initial.users.length, 1, "Only the synthetic bootstrap account may resume.");
  assert.equal(initial.users[0].name, bootstrapUsername);
  assert(initial.settingsCount <= 1);
  assert.equal(initial.shoppingCount, 0);
  assert(
    initial.onboarding.length === 1 && ["setup", "finish"].includes(initial.onboarding[0]),
    "Resume only the previously created synthetic account's setup or finish.",
  );
  if (initial.onboarding[0] === "setup") assert.equal(initial.settingsCount, 0);
} else {
  assert.equal(initial.users.length, 0, "The bootstrap fixture must have no pre-existing user.");
  assert.equal(initial.settingsCount, 0, "The bootstrap fixture must have no SHIVA settings.");
  assert.equal(initial.shoppingCount, 0, "The bootstrap fixture must have no Shopping records.");
  assert.deepEqual(initial.onboarding, ["start"], "The copied upstream wizard must begin at start.");
}
const original = databaseSnapshot(priorFixture);
assert(
  original.users.length === 1 && original.users[0].name === "shiva-verification",
  "Do not inspect or mutate a real-user fixture.",
);

const credentialPath = path.join(root, "artifacts/bootstrap-credentials.json");
const credentials = resume
  ? JSON.parse(await readFile(credentialPath, "utf8"))
  : { username: bootstrapUsername, password: `Shiva!${randomBytes(28).toString("base64url")}9` };
assert.equal(credentials.username, bootstrapUsername);
assert(typeof credentials.password === "string" && credentials.password.length > 30);
if (!resume) await writeFile(credentialPath, JSON.stringify(credentials), { mode: 0o600, flag: "wx" });
const freshReport = {
  startedAt: new Date().toISOString(),
  origin,
  database: "artifacts/bootstrap-verification.sqlite",
  initial: { userCount: 0, settingsCount: 0, shoppingCount: 0, onboarding: "start" },
  steps: [],
  screenshots: [],
  consoleErrors: [],
  pageErrors: [],
  requests: [],
  capabilityEvidence: null,
  passed: false,
};
const report = resume ? JSON.parse(await readFile(path.join(directory, "bootstrap-report.json"), "utf8")) : freshReport;
if (resume) {
  assert.equal(report.initial.userCount, 0, "Resume must retain evidence from an actually empty-user fixture.");
  assert.equal(report.steps[0]?.passed, true);
  assert.equal(report.steps[1]?.passed, true);
  if (initial.onboarding[0] === "finish") {
    assert(report.steps.some((entry) => entry.name.startsWith("Complete native setup") && entry.passed));
  }
  report.recoveredHarnessFailures = [
    ...(report.recoveredHarnessFailures ?? []),
    ...report.steps.filter((entry) => !entry.passed).map(({ name, error }) => ({ name, error })),
  ];
  report.steps = report.steps.filter((entry) => entry.passed);
}
function redact(value) {
  return String(value)
    .replaceAll(credentials.password, "[redacted]")
    .replaceAll(credentials.username, "[redacted]")
    .slice(0, 3000);
}
async function flush() {
  await writeFile(path.join(directory, "bootstrap-report.json"), JSON.stringify(report, null, 2));
}
async function step(name, action) {
  const started = performance.now();
  try {
    const observation = await action();
    report.steps.push({
      name,
      passed: true,
      elapsedMs: Math.round(performance.now() - started),
      ...(observation ? { observation } : {}),
    });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.steps.push({
      name,
      passed: false,
      elapsedMs: Math.round(performance.now() - started),
      error: redact(error?.message ?? error),
    });
    throw error;
  } finally {
    await flush();
  }
}
function findCapabilities(value) {
  if (!value || typeof value !== "object") return null;
  if (value.workshop && value.kubernetes) return value;
  for (const nested of Object.values(value)) {
    const found = findCapabilities(nested);
    if (found) return found;
  }
  return null;
}
async function parseRpcBody(response) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    // The production client uses tRPC httpBatchStreamLink: each completed result is a JSONL chunk.
    // Read complete streamed response chunks without requesting a different endpoint or trusting UI text.
    return body
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  }
}
const browser = await chromium.launch({
  executablePath: process.env.SHIVA_CHROMIUM_PATH ?? "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "en-IN",
  timezoneId: "Asia/Kolkata",
  reducedMotion: "reduce",
});
context.setDefaultTimeout(15000);
const page = await context.newPage();
page.on("console", (message) => {
  if (message.type() === "error") report.consoleErrors.push(redact(message.text()));
});
page.on("pageerror", (error) => report.pageErrors.push(redact(error.message)));
page.on("request", (request) => {
  const url = new URL(request.url());
  if (!["http:", "https:"].includes(url.protocol)) return;
  report.requests.push({
    origin: url.origin,
    path: url.pathname,
    method: request.method(),
    external: url.origin !== origin,
  });
});
async function screenshot(name) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  const filename = `bootstrap-${name}.png`;
  await page.screenshot({ path: path.join(directory, filename), fullPage: true, animations: "disabled" });
  report.screenshots.push(`artifacts/browser/${filename}`);
}
async function navigateAfterHostRefresh(url) {
  await page.waitForLoadState("networkidle");
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (error) {
    if (!String(error?.message ?? error).includes("net::ERR_ABORTED")) throw error;
    // Upstream finish/sign-in revalidates the route. Retry only that already-observed navigation race once.
    await page.waitForLoadState("networkidle");
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }
}
try {
  if (resume) {
    await step("Resume the synthetic administrator's existing setup after selector recovery", async () => {
      const callback = initial.onboarding[0] === "finish" ? "%2Fshiva" : "%2Finit";
      await page.goto(`${origin}/auth/login?callbackUrl=${callback}`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle");
      await page.locator("#username").fill(credentials.username);
      await page.locator("#password").fill(credentials.password);
      await page.locator('button[type="submit"][value="credentials"]').click();
      const heading = initial.onboarding[0] === "finish" ? "Today, at a glance" : "Start with familiar defaults";
      await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    });
  } else {
    await step("Fresh upstream welcome and secure onboarding claim", async () => {
      await page.goto(`${origin}/shiva`, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/init$/);
      await expect(page.getByRole("heading", { name: "Welcome home.", exact: true })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await screenshot("welcome");
      await page.getByRole("button", { name: "Get started", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Create your administrator", exact: true })).toBeVisible();
    });
    await step("Create one synthetic administrator through the upstream UI", async () => {
      await page.getByRole("textbox", { name: "Administrator username", exact: true }).fill(credentials.username);
      await page.getByLabel("Password", { exact: true }).fill(credentials.password);
      await page.getByLabel("Confirm password", { exact: true }).fill(credentials.password);
      await page.getByRole("button", { name: "Create administrator", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Start with familiar defaults", exact: true })).toBeVisible();
      await page.waitForLoadState("networkidle");
      // Account setup revalidates the route after host sign-in. Its browser stream can be discarded by Chrome;
      // use the same authenticated cookie context to verify the actual read-only RPC after navigation settles.
      const response = await context.request.get(`${origin}/api/trpc/onboard.detectRuntimeCapabilities`);
      assert.equal(response.status(), 200, "The authenticated capability RPC must succeed.");
      const capabilities = findCapabilities(await parseRpcBody(response));
      assert(capabilities, "The actual capability RPC must return its structured result.");
      assert.equal(
        capabilities.workshop.status,
        "disabled",
        "NO_EXTERNAL_CONNECTION must disable the Workshop capability probe.",
      );
      report.capabilityEvidence = {
        actualRpc: "/api/trpc/onboard.detectRuntimeCapabilities",
        httpStatus: response.status(),
        workshopStatus: capabilities.workshop.status,
        kubernetesStatus: capabilities.kubernetes.status,
        scope:
          "Actual server RPC reports disabled; no-outbound-fetch implementation is verified by the separate server regression test.",
      };
      const snapshot = databaseSnapshot(database);
      assert.equal(snapshot.users.length, 1, "The server must create the account in the bootstrap database.");
      assert.equal(snapshot.users[0].name, credentials.username);
      assert.equal(
        databaseSnapshot(priorFixture).fingerprint,
        original.fingerprint,
        "The original verification fixture must remain intact.",
      );
    });
  }
  if (!resume || initial.onboarding[0] === "setup") {
    await step("Complete native setup without provider credentials or analytics", async () => {
      const analytics = page.getByRole("switch", { name: /^Share anonymous product analytics/ });
      await expect(analytics).not.toBeChecked();
      await analytics.uncheck();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "See what this installation can actually reach", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Connect what makes the board useful", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Shape the board before it is built", exact: true }),
      ).toBeVisible();
      await page.getByRole("textbox", { name: "Board name", exact: true }).fill("SHIVA-Verification");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Advanced features", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "One board, built around your services", exact: true }),
      ).toBeVisible();
      await screenshot("review");
      await page.getByRole("button", { name: "Build my board", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Your first board is ready.", exact: true })).toBeVisible({
        timeout: 30000,
      });
      assert.deepEqual(databaseSnapshot(database).onboarding, ["finish"]);
      await screenshot("complete");
    });
  }
  await step("Fresh account reaches SHIVA Home and empty native Shopping", async () => {
    await navigateAfterHostRefresh(`${origin}/shiva`);
    await expect(page.getByRole("heading", { name: "Today, at a glance", exact: true })).toBeVisible();
    await expect(page.getByText("SAMPLE OVERVIEW", { exact: true })).toBeVisible();
    await screenshot("shiva-home");
    await page.goto(`${origin}/shiva/shopping`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByText("Your list starts empty. Prices are estimates you enter.", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.locator("#username")).toBeVisible();
    await page.goto(`${origin}/auth/login?callbackUrl=%2Fshiva`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.locator("#username").fill(credentials.username);
    await page.locator("#password").fill(credentials.password);
    await page.locator('button[type="submit"][value="credentials"]').click();
    await expect(page.locator("#username")).toHaveCount(0);
    await navigateAfterHostRefresh(`${origin}/shiva`);
    await expect(page.getByRole("heading", { name: "Today, at a glance", exact: true })).toBeVisible();
    await context.storageState({ path: path.join(root, "artifacts/bootstrap-storage.json") });
    await chmod(path.join(root, "artifacts/bootstrap-storage.json"), 0o600);
  });
  await step("First-run isolation, runtime privacy state and browser network gate", async () => {
    const snapshot = databaseSnapshot(database);
    assert.equal(snapshot.users.length, 1);
    assert.equal(snapshot.settingsCount, 0, "Reading fresh default settings must not create a database record.");
    assert.equal(snapshot.shoppingCount, 0);
    assert.equal(
      databaseSnapshot(priorFixture).fingerprint,
      original.fingerprint,
      "Prior fixture records/settings must be unchanged.",
    );
    assert.equal(report.pageErrors.length, 0, "No browser runtime exceptions are allowed.");
    assert.equal(report.consoleErrors.length, 0, "No browser console errors are allowed.");
    assert.equal(
      report.requests.filter((request) => request.external).length,
      0,
      "The first-run browser must make no external requests.",
    );
    return {
      userCount: 1,
      shivaSettingsCount: 0,
      shoppingCount: 0,
      onboarding: "finish",
      originalFixtureIntact: true,
      externalBrowserRequestCount: 0,
    };
  });
  report.passed = true;
} catch (error) {
  console.error(`FAIL bootstrap: ${redact(error?.message ?? error)}`);
  process.exitCode = 1;
  // Never capture a user-creation or login form containing a password.
  if ((await page.locator('input[type="password"]').count()) === 0) await screenshot("failure").catch(() => undefined);
} finally {
  report.finishedAt = new Date().toISOString();
  await flush();
  await browser.close();
  console.log("Report: artifacts/browser/bootstrap-report.json");
}
