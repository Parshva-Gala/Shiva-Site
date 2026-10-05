// SHIVA extension, Apache-2.0. Local, synthetic-data verification only.
// Usage: node scripts/shiva/verify-browser.mjs --isolated-verification --phase smoke
// Restart the same isolated application, then run again with --phase persistence.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import sharp from "sharp";

import { assertVerificationRuntime, readVerificationCredentials } from "./verification-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const phaseIndex = args.indexOf("--phase");
const phase = phaseIndex < 0 ? "smoke" : args[phaseIndex + 1];
const origin = process.env.SHIVA_VERIFY_ORIGIN ?? "http://127.0.0.1:3000";
assert(args.includes("--isolated-verification"), "Require --isolated-verification: never run against personal data.");
assert.equal(origin, "http://127.0.0.1:3000", "Only the fixed localhost verification instance is allowed.");
assert(
  ["smoke", "wallpaper", "persistence", "host", "ssr"].includes(phase),
  "Use --phase smoke, wallpaper, persistence, host or ssr.",
);
const credentials = await readVerificationCredentials(root);
const runtimeGuard = await assertVerificationRuntime(root);
const output = path.join(root, "artifacts/browser");
await mkdir(output, { recursive: true });
const fixture = {
  name: "SHIVA Verification Persistence",
  editedName: "SHIVA Verification Persistence Edited",
  category: "Verification only",
  notes: "Synthetic browser fixture; no real purchases, accounts or live prices.",
  price: "123456.78",
  preset: "SHIVA Verification Preset",
  layout: "SHIVA Verification Layout",
};
const report = {
  phase,
  startedAt: new Date().toISOString(),
  origin,
  runtimeGuard,
  viewport: { desktop: "1440x1000", narrow: "390x844" },
  steps: [],
  screenshots: [],
  consoleErrors: [],
  pageErrors: [],
  network: [],
  passed: false,
};
const destinations = new Map();
let networkScope = "host-login";
const sensitive = [credentials.username, credentials.password];
function redact(value) {
  let result = String(value).slice(0, 2500);
  for (const secret of sensitive) if (secret) result = result.replaceAll(secret, "[redacted]");
  return result.replace(/(?:Bearer\s+)[^\s"']+/gi, "Bearer [redacted]");
}
async function flush() {
  report.network = [...destinations.values()].toSorted((a, b) => a.origin.localeCompare(b.origin));
  await writeFile(path.join(output, `${phase}-report.json`), JSON.stringify(report, null, 2));
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
    console.error(`FAIL ${name}: ${redact(error?.message ?? error)}`);
    throw error;
  } finally {
    await flush();
  }
}
function monitor(page) {
  page.on("console", (message) => {
    if (message.type() === "error") report.consoleErrors.push(redact(message.text()));
  });
  page.on("pageerror", (error) => report.pageErrors.push(redact(error.message)));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return;
    const key = `${networkScope} ${url.origin} ${request.method()} ${url.pathname}`;
    const previous = destinations.get(key);
    destinations.set(key, {
      origin: url.origin,
      method: request.method(),
      path: url.pathname,
      count: (previous?.count ?? 0) + 1,
      external: url.origin !== origin,
      scope: networkScope,
    });
  });
}
const browser = await chromium.launch({
  executablePath: process.env.SHIVA_CHROMIUM_PATH ?? "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
  reducedMotion: "no-preference",
  locale: "en-IN",
  timezoneId: "Asia/Kolkata",
});
context.setDefaultTimeout(15000);
const page = await context.newPage();
monitor(page);
async function open(route) {
  await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#shiva-theme-root")).toBeVisible();
}
async function screenshot(name, target = page) {
  const filename = `${phase}-${name}.png`;
  await target.screenshot({ path: path.join(output, filename), fullPage: true, animations: "disabled" });
  report.screenshots.push(path.relative(root, path.join(output, filename)));
}
async function checkTheme(name, background, target = page) {
  await expect(target.getByLabel("Theme name", { exact: true })).toHaveValue(name);
  await expect
    .poll(() =>
      target
        .locator("#shiva-theme-root")
        .evaluate((element) => getComputedStyle(element).getPropertyValue("--shiva-bg").trim()),
    )
    .toBe(background);
  await expect
    .poll(() =>
      target.locator("#shiva-theme-root").evaluate((element) => {
        const styles = getComputedStyle(element);
        return (
          styles.getPropertyValue("--mantine-color-dimmed").trim() ===
            styles.getPropertyValue("--shiva-muted").trim() &&
          styles.getPropertyValue("--mantine-color-text").trim() === styles.getPropertyValue("--shiva-text").trim()
        );
      }),
    )
    .toBe(true);
  const description = target.getByText("Choose a starting point, then tune the details across your workspace.", {
    exact: true,
  });
  await expect
    .poll(() =>
      description.evaluate((element) => {
        const rootElement = element.closest("#shiva-theme-root");
        const probe = document.createElement("span");
        probe.style.color = getComputedStyle(rootElement).getPropertyValue("--shiva-muted").trim();
        return getComputedStyle(element).color === probe.style.color;
      }),
    )
    .toBe(true);
}
async function select(label, option, scope = page) {
  await scope.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function saveAppearance() {
  const save = page.getByRole("button", { name: "Save changes", exact: true });
  if (await save.isEnabled()) {
    await save.click();
    await expect(
      page.getByText("Appearance saved. It will be here after your next restart.", { exact: true }),
    ).toBeVisible();
  }
  await expect(page.getByText("Saved appearance", { exact: true })).toBeVisible();
}
async function privacy(enabled) {
  const toggle = page.getByRole("button", {
    name: enabled ? "Hide sensitive content" : "Show sensitive content",
    exact: true,
  });
  if (await toggle.count()) {
    await expect(toggle).toBeEnabled();
    await toggle.click();
  }
  await expect(
    page.getByRole("button", { name: enabled ? "Show sensitive content" : "Hide sensitive content", exact: true }),
  ).toBeEnabled();
}
async function removeFixture(name, cancelFirst = false) {
  await page.getByRole("button", { name: `Delete ${name}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete shopping item?", exact: true });
  await expect(dialog).toBeVisible();
  if (cancelFirst) {
    await dialog.getByRole("button", { name: "Keep item", exact: true }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Delete ${name}`, exact: true }).click();
  }
  await dialog.getByRole("button", { name: "Delete item", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(0);
}

async function verifyWallpaper() {
  await step("Wallpaper upload, owned asset reference, save and reload", async () => {
    await open("/shiva/settings/appearance");
    await page.getByRole("tab", { name: "Wallpaper & glass", exact: true }).click();
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#27436b" } })
      .png()
      .toBuffer();
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Choose wallpaper", exact: true }).click();
    await (
      await chooserPromise
    ).setFiles({ name: "SHIVA-verification-wallpaper.png", mimeType: "image/png", buffer: png });
    await expect(
      page.getByText("Wallpaper uploaded into preview. Save changes to keep it active.", { exact: true }),
    ).toBeVisible();
    const image = page.getByRole("img", { name: "Selected wallpaper preview", exact: true });
    const reference = await image.getAttribute("src");
    assert.match(reference ?? "", /^\/api\/shiva\/wallpaper\/[a-f0-9]{64}$/);
    report.wallpaperReference = reference;
    await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
    await saveAppearance();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Wallpaper & glass", exact: true }).click();
    await expect(page.getByRole("img", { name: "Selected wallpaper preview", exact: true })).toHaveAttribute(
      "src",
      reference,
    );
    await expect
      .poll(() => page.locator("#shiva-theme-root").evaluate((element) => getComputedStyle(element).backgroundImage))
      .toContain(reference);
  });
  await step("Saved Shopping, settings and owned image survive a private backup/reopen drill", async () => {
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [path.join(root, "scripts/shiva/verify-backup.mjs"), "--isolated-verification"],
        { cwd: root, shell: false, stdio: ["ignore", "pipe", "pipe"] },
      );
      let backupOutput = "";
      child.stdout.on("data", (chunk) => {
        backupOutput += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        backupOutput += chunk.toString();
      });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`Private backup drill failed: ${redact(backupOutput)}`)),
      );
    });
    const backup = JSON.parse(await readFile(path.join(root, "artifacts/backup-report.json"), "utf8"));
    assert.equal(backup.passed, true);
    assert(backup.recordCount >= 1, "The combined backup must include a real synthetic Shopping record.");
    assert(backup.referencedImagesVerified >= 1, "The combined backup must include the active owned wallpaper.");
    return {
      recordCount: backup.recordCount,
      copiedImages: backup.copiedImages,
      referencedImagesVerified: backup.referencedImagesVerified,
      journalsRetained: backup.journalsRetained,
    };
  });
  await step("Owned wallpaper thumbnail and protected in-use deletion", async () => {
    await page.getByRole("button", { name: "Open library", exact: true }).click();
    const asset = page
      .locator(".shiva-wallpaper-asset")
      .filter({ has: page.locator(`img[src="${report.wallpaperReference}?thumbnail=1"]`) });
    await expect(asset).toHaveCount(1);
    await expect
      .poll(() => asset.locator("img").evaluate((element) => element.complete && element.naturalWidth > 0))
      .toBe(true);
    await expect(asset.getByText(/In use/)).toBeVisible();
    const remove = asset.getByRole("button", { name: /Delete uploaded wallpaper/ });
    await expect(remove).toBeDisabled();
    await expect(
      page.getByText("Keep up to 24 uploaded images. Saved themes and presets protect their images from deletion.", {
        exact: true,
      }),
    ).toBeVisible();
    await remove.click({ force: true });
    await expect(page.getByRole("dialog", { name: "Delete uploaded wallpaper", exact: true })).toHaveCount(0);
    await expect(asset).toHaveCount(1);
    await screenshot("wallpaper-library");
  });
  await step("Bitmap theme export and portable import with actual upload", async () => {
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export theme", exact: true }).click();
    const file = path.join(output, "synthetic-wallpaper-theme.json");
    await (await downloadPromise).saveAs(file);
    const document = JSON.parse(await readFile(file, "utf8"));
    assert.deepEqual(Object.keys(document).toSorted(), ["format", "theme", "version"]);
    assert.match(document.theme.wallpaper, /^data:image\/webp;base64,/);
    assert(!JSON.stringify(document).includes(credentials.password), "Bitmap exports must contain appearance only.");
    await page.getByRole("button", { name: "Remove wallpaper", exact: true }).click();
    await expect(page.getByRole("img", { name: "Selected wallpaper preview", exact: true })).toHaveCount(0);
    const uploaded = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/shiva/wallpaper" && response.request().method() === "POST",
    );
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Import theme", exact: true }).click();
    await (await chooserPromise).setFiles(file);
    assert.equal((await uploaded).status(), 201, "Portable bitmap import must upload successfully.");
    await expect(
      page.getByText("Theme imported into preview. Save changes to keep it.", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByRole("img", { name: "Selected wallpaper preview", exact: true })
          .evaluate((element) => element.complete && element.naturalWidth > 0),
      )
      .toBe(true);
    report.portableWallpaperReference = await page
      .getByRole("img", { name: "Selected wallpaper preview", exact: true })
      .getAttribute("src");
    assert.match(report.portableWallpaperReference ?? "", /^\/api\/shiva\/wallpaper\/[a-f0-9]{64}$/);
    await saveAppearance();
  });
  await step("Remove wallpaper, cancel deletion, confirm unused-asset cleanup and restore preset", async () => {
    await page.getByRole("button", { name: "Remove wallpaper", exact: true }).click();
    await saveAppearance();
    await page.getByRole("button", { name: "Refresh library", exact: true }).click();
    // Re-encoding a portable WebP may create a second owned asset. Remove only this test's selected images.
    const portable = JSON.parse(await readFile(path.join(output, "synthetic-wallpaper-theme.json"), "utf8"));
    const fixtureAssets = [...new Set([report.wallpaperReference, report.portableWallpaperReference])];
    for (const reference of fixtureAssets) {
      const asset = page
        .locator(".shiva-wallpaper-asset")
        .filter({ has: page.locator(`img[src="${reference}?thumbnail=1"]`) });
      await expect(asset).toHaveCount(1);
      const remove = asset.getByRole("button", { name: /Delete uploaded wallpaper/ });
      if (await remove.isDisabled()) continue;
      await remove.click();
      const dialog = page.getByRole("dialog", { name: "Delete uploaded wallpaper", exact: true });
      await dialog.getByRole("button", { name: "Keep image", exact: true }).click();
      await expect(asset).toBeVisible();
      await remove.click();
      await dialog.getByRole("button", { name: "Delete image", exact: true }).click();
      await expect(dialog).toBeHidden();
    }
    const expected = JSON.parse(await readFile(path.join(output, "restart-expectations.json"), "utf8"));
    await page.getByRole("button", { name: `Preview ${expected.theme}`, exact: true }).click();
    await saveAppearance();
    await page.getByRole("tab", { name: "Colors", exact: true }).click();
    await checkTheme(expected.theme, expected.background);
    await expect(page.getByRole("button", { name: "Show sensitive content", exact: true })).toBeEnabled();
    await expect(page.locator(".shiva-shell")).toHaveClass(/sidebar-icons/);
    return { exportedFormat: portable.format, restoredTheme: expected.theme, syntheticImageReferences: fixtureAssets };
  });
}

try {
  await step("Host credentials login and private session export", async () => {
    await page.goto(`${origin}/auth/login?callbackUrl=%2Fshiva`, { waitUntil: "domcontentloaded" });
    // The upstream auth form is server-rendered; wait for its scripts before entering credentials.
    await page.waitForLoadState("networkidle");
    await page.locator("#username").fill(credentials.username);
    await page.locator("#password").fill(credentials.password);
    await page.locator('button[type="submit"][value="credentials"]').click();
    await expect(page.locator("#shiva-theme-root")).toBeVisible({ timeout: 60000 });
    const sessionResponse = await context.request.get(`${origin}/api/auth/session`);
    assert(sessionResponse.status() === 200, "The authenticated fixture session must be verified.");
    const session = await sessionResponse.json();
    assert(
      session?.user?.name === "shiva-verification",
      "The session must belong to the synthetic verification account before any settings or Shopping writes.",
    );
    networkScope = "shiva";
    // Ignored file: contains host-session cookies. Never include it in output reports.
    await context.storageState({ path: path.join(root, "artifacts/verification-storage.json") });
    await chmod(path.join(root, "artifacts/verification-storage.json"), 0o600);
  });
  if (phase === "smoke") {
    await step("Prepare only prefixed synthetic fixtures for a repeatable run", async () => {
      await open("/shiva/settings/appearance");
      await privacy(false);
      const existingPreset = page.getByRole("button", { name: `Remove preset ${fixture.preset}`, exact: true });
      if (await existingPreset.count()) {
        await existingPreset.click();
        await page
          .getByRole("dialog", { name: "Remove saved preset", exact: true })
          .getByRole("button", { name: "Remove preset", exact: true })
          .click();
        await saveAppearance();
      }
      await open("/shiva/shopping");
      await expect(page.getByRole("heading", { name: "Shopping", exact: true, level: 1 })).toBeVisible();
      await expect(page.getByText("Loading your shopping list…", { exact: true })).toHaveCount(0);
      for (const name of [fixture.name, fixture.editedName]) {
        if (await page.getByRole("button", { name: `Delete ${name}`, exact: true }).count()) await removeFixture(name);
      }
      await open("/shiva");
      await page.getByRole("button", { name: "Edit layout", exact: true }).click();
      await page.getByRole("button", { name: "Reset preview", exact: true }).click();
      await page.getByRole("button", { name: "Save & lock layout", exact: true }).click();
      await expect(page.getByRole("button", { name: "Edit layout", exact: true })).toBeVisible();
    });
    await step("Home sample notice, honest sources and desktop screenshot", async () => {
      await open("/shiva");
      await privacy(false);
      await expect(page.getByRole("heading", { name: "Today, at a glance", exact: true })).toBeVisible();
      await expect(page.getByText("SAMPLE OVERVIEW", { exact: true })).toBeVisible();
      await expect(page.locator(".source-item").getByText("Not configured", { exact: true })).toHaveCount(4);
      await screenshot("home-desktop");
    });
    await step("Every planned navigation page and unconfigured integrations", async () => {
      const routes = [
        ["vision", "SHIVA", "Planned module"],
        ["tasks", "Tasks", "Not configured"],
        ["calendar", "Calendar", "Not configured"],
        ["health", "Health", "Planned module"],
        ["finance", "Finance", "Not configured"],
        ["knowledge", "Knowledge", "Not configured"],
        ["inbox", "Inbox", "Not configured"],
      ];
      for (const [route, heading, status] of routes) {
        await page.locator(`.shiva-sidebar a[href="/shiva/${route}"]`).click();
        await expect(page.getByRole("heading", { name: heading, level: 1, exact: true })).toBeVisible();
        await expect(page.locator(".planned-state").getByText(status, { exact: true })).toBeVisible();
      }
      await open("/shiva/settings/integrations");
      await expect(page.locator(".integration-grid").getByText("Not configured", { exact: true })).toHaveCount(7);
      await expect(page.getByText("Last refresh: never", { exact: true })).toHaveCount(7);
    });
    await step("Three actual preset previews, save and reload persistence", async () => {
      await open("/shiva/settings/appearance");
      for (const [name, background, mode] of [
        ["Graphite", "#14171c", "dark"],
        ["Ivory", "#f3f1ec", "light"],
        ["Midnight Glass", "#0c111b", "dark"],
      ]) {
        await page.getByRole("button", { name: `Preview ${name}`, exact: true }).click();
        await checkTheme(name, background);
        await expect(page.locator("#shiva-theme-root")).toHaveAttribute("data-mantine-color-scheme", mode);
        await saveAppearance();
        await page.reload({ waitUntil: "domcontentloaded" });
        await checkTheme(name, background);
        if (name !== "Midnight Glass") await screenshot(`appearance-${name.toLowerCase()}`);
      }
      await expect
        .poll(() => page.locator("#shiva-theme-root").evaluate((element) => getComputedStyle(element).backgroundImage))
        .toContain("midnight.svg");
      await expect(page.locator("#shiva-theme-root")).toHaveAttribute("data-effects", "full");
      await screenshot("appearance-midnight-glass");
      // Explicitly requesting reduced motion must turn the visual effects off.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator("#shiva-theme-root")).toHaveAttribute("data-effects", "reduced");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await expect(page.locator("#shiva-theme-root")).toHaveAttribute("data-effects", "full");
    });
    await step("Preview cancel, live-preview switch and safe URL recovery", async () => {
      await page.getByRole("button", { name: "Preview Ivory", exact: true }).click();
      await checkTheme("Ivory", "#f3f1ec");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await checkTheme("Midnight Glass", "#0c111b");
      await page.getByLabel("Live preview", { exact: true }).uncheck();
      await page.getByRole("button", { name: "Preview Ivory", exact: true }).click();
      await expect
        .poll(() =>
          page
            .locator("#shiva-theme-root")
            .evaluate((element) => getComputedStyle(element).getPropertyValue("--shiva-bg").trim()),
        )
        .toBe("#0c111b");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByLabel("Live preview", { exact: true }).check();
      await open("/shiva/settings/appearance?safe=1");
      await expect(page.getByText("Safe appearance mode", { exact: true })).toBeVisible();
      await expect
        .poll(() =>
          page
            .locator("#shiva-theme-root")
            .evaluate((element) => getComputedStyle(element).getPropertyValue("--shiva-bg").trim()),
        )
        .toBe("#14171c");
      await open("/shiva/settings/appearance");
      await checkTheme("Midnight Glass", "#0c111b");
      await page.getByRole("button", { name: "Reset / recover", exact: true }).click();
      const reset = page.getByRole("dialog", { name: "Reset appearance", exact: true });
      await expect(reset).toBeVisible();
      await reset.getByRole("button", { name: "Cancel", exact: true }).click();
      await checkTheme("Midnight Glass", "#0c111b");
      await page.getByRole("button", { name: "Reset / recover", exact: true }).click();
      await reset.getByRole("button", { name: "Reset to Graphite", exact: true }).click();
      await expect(reset).toBeHidden();
      await checkTheme("Graphite", "#14171c");
    });
    await step("Appearance-only export, invalid import and valid round trip", async () => {
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export theme", exact: true }).click();
      const download = await downloadPromise;
      const file = path.join(output, "synthetic-theme.json");
      await download.saveAs(file);
      const document = JSON.parse(await readFile(file, "utf8"));
      assert.deepEqual(Object.keys(document).toSorted(), ["format", "theme", "version"]);
      assert.equal(document.format, "shiva-theme");
      assert.equal(document.version, 1);
      assert.equal(document.theme.name, "Graphite");
      assert(!JSON.stringify(document).includes(credentials.password), "Exports must not contain secrets.");
      let chooserPromise = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Import theme", exact: true }).click();
      await (
        await chooserPromise
      ).setFiles({
        name: "invalid-theme.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ ...document, credentials: "not allowed" })),
      });
      await expect(
        page.getByText("Invalid SHIVA theme. Use a version 1 theme export with appearance fields only.", {
          exact: true,
        }),
      ).toBeVisible();
      await checkTheme("Graphite", "#14171c");
      await page.getByRole("button", { name: "Preview Ivory", exact: true }).click();
      chooserPromise = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Import theme", exact: true }).click();
      await (await chooserPromise).setFiles(file);
      await expect(
        page.getByText("Theme imported into preview. Save changes to keep it.", { exact: true }),
      ).toBeVisible();
      await checkTheme("Graphite", "#14171c");
      await page.getByRole("button", { name: "Preview Midnight Glass", exact: true }).click();
      await page.getByLabel("New preset name", { exact: true }).fill(fixture.preset);
      await page.getByRole("button", { name: "Add preset", exact: true }).click();
      await saveAppearance();
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: `Preview ${fixture.preset}`, exact: true })).toBeVisible();
      await checkTheme("Midnight Glass", "#0c111b");
    });
    await step("Shopping validation, keyboard focus and create", async () => {
      await open("/shiva/shopping");
      await expect(
        page.getByText("Your list starts empty. Prices are estimates you enter.", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Add item", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Add shopping item", exact: true });
      await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(dialog.getByRole("textbox", { name: "Category", exact: true })).toBeFocused();
      await dialog.getByRole("button", { name: "Add item", exact: true }).click();
      await expect(dialog.getByText("Enter a name.", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toBeFocused();
      await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(fixture.name);
      await dialog.getByRole("textbox", { name: "Category", exact: true }).fill(fixture.category);
      await dialog.getByLabel("Estimated price", { exact: true }).fill(fixture.price);
      await select("Priority", "High priority", dialog);
      await select("Purchase stage", "Budgeted", dialog);
      await dialog.getByLabel("Notes and requirements", { exact: true }).fill(fixture.notes);
      await dialog.getByLabel("Product or source URL", { exact: true }).fill("javascript:alert(1)");
      await dialog.getByRole("button", { name: "Add item", exact: true }).click();
      await expect(
        dialog.getByText("Enter a valid HTTP or HTTPS link without credentials.", { exact: true }),
      ).toBeVisible();
      await dialog.getByLabel("Product or source URL", { exact: true }).fill("https://example.com/shiva-verification");
      await screenshot("shopping-modal");
      await dialog.getByRole("button", { name: "Add item", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByRole("heading", { name: fixture.name, exact: true })).toBeVisible();
      await expect(page.locator(".shiva-shopping-row").getByText("₹1,23,456.78", { exact: true })).toBeVisible();
    });
    await step("Shopping edit details, cancel deletion and reload persistence", async () => {
      await page.getByRole("button", { name: `Edit ${fixture.name}`, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Edit shopping item", exact: true });
      await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(fixture.name);
      await expect(dialog.getByLabel("Notes and requirements", { exact: true })).toHaveValue(fixture.notes);
      await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(fixture.editedName);
      await select("Purchase stage", "Shortlisted", dialog);
      await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(dialog).toBeHidden();
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: fixture.editedName, exact: true })).toBeVisible();
      await expect(page.locator(".shiva-shopping-row").getByText("Shortlisted", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: `Delete ${fixture.editedName}`, exact: true }).click();
      await page
        .getByRole("dialog", { name: "Delete shopping item?", exact: true })
        .getByRole("button", { name: "Keep item", exact: true })
        .click();
      await expect(page.getByRole("heading", { name: fixture.editedName, exact: true })).toBeVisible();
      await screenshot("shopping-desktop");
    });
    await step("Saved layout, keyboard reordering, resize, cancel and icon sidebar", async () => {
      await open("/shiva");
      await page.waitForLoadState("networkidle");
      const widgets = page.locator(".home-grid > [data-widget]");
      const widgetOrder = () => widgets.evaluateAll((cards) => cards.map((card) => card.getAttribute("data-widget")));
      const originalOrder = await widgetOrder();
      const reordered = [...originalOrder];
      const taskIndex = reordered.indexOf("tasks");
      assert(taskIndex > 0, "The synthetic default layout must allow Task preview to move up.");
      [reordered[taskIndex - 1], reordered[taskIndex]] = [reordered[taskIndex], reordered[taskIndex - 1]];
      const settingsWrites = () =>
        [...destinations.values()]
          .filter((destination) => destination.method === "POST" && destination.path.includes("shiva.saveSettings"))
          .reduce((count, destination) => count + destination.count, 0);
      const beforePreviewWrites = settingsWrites();
      const shoppingCard = page.locator('.home-grid > [data-widget="shopping"]');
      const isFullWidth = async () => {
        const [grid, card] = await Promise.all([page.locator(".home-grid").boundingBox(), shoppingCard.boundingBox()]);
        return Boolean(grid && card && Math.abs(grid.width - card.width) < 2);
      };
      await page.getByRole("button", { name: "Edit layout", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Layout preferences", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Move Task preview up", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect.poll(widgetOrder).toEqual(reordered);
      await select("Shopping summary width", "Full width");
      await expect.poll(isFullWidth).toBe(true);
      await page.getByLabel("Agenda", { exact: true }).uncheck();
      await expect.poll(widgetOrder).toEqual(reordered.filter((widget) => widget !== "agenda"));
      await page.locator(".layout-editor").getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.locator(".layout-editor")).toHaveCount(0);
      await expect.poll(widgetOrder).toEqual(originalOrder);
      await expect.poll(isFullWidth).toBe(false);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect.poll(widgetOrder).toEqual(originalOrder);
      await expect.poll(isFullWidth).toBe(false);
      assert.equal(settingsWrites(), beforePreviewWrites, "Cancelling an unsaved layout must not write settings.");
      await page.getByRole("button", { name: "Edit layout", exact: true }).click();
      await select("Sidebar", "Icons only");
      await page.getByRole("button", { name: "Move Task preview up", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect.poll(widgetOrder).toEqual(reordered);
      await select("Shopping summary width", "Full width");
      await page.getByLabel("Agenda", { exact: true }).uncheck();
      if (!(await page.getByRole("button", { name: fixture.layout, exact: true }).count())) {
        await page.getByLabel("Layout name", { exact: true }).fill(fixture.layout);
        await page.getByRole("button", { name: "Save layout preset", exact: true }).click();
      }
      await expect(page.getByRole("button", { name: fixture.layout, exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Save & lock layout", exact: true }).click();
      await expect(page.getByRole("button", { name: "Edit layout", exact: true })).toBeVisible();
      await expect(page.locator(".shiva-shell")).toHaveClass(/sidebar-icons/);
      await expect(page.locator(".home-grid").getByRole("heading", { name: "Agenda", exact: true })).toHaveCount(0);
      await expect.poll(widgetOrder).toEqual(reordered.filter((widget) => widget !== "agenda"));
      await expect.poll(isFullWidth).toBe(true);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.locator(".shiva-shell")).toHaveClass(/sidebar-icons/);
      await expect.poll(widgetOrder).toEqual(reordered.filter((widget) => widget !== "agenda"));
      await expect.poll(isFullWidth).toBe(true);
      await page.getByRole("button", { name: "Toggle navigation", exact: true }).click();
      await expect(page.locator(".shiva-shell")).toHaveClass(/sidebar-expanded/);
      await expect(page.getByRole("button", { name: "Toggle navigation", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Toggle navigation", exact: true }).click();
      await expect(page.locator(".shiva-shell")).toHaveClass(/sidebar-icons/);
    });
    await step("Privacy hides synthetic records and persists through reload", async () => {
      await open("/shiva/shopping");
      await privacy(true);
      await expect(page.getByRole("heading", { name: "Hidden item 1", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: fixture.editedName, exact: true })).toHaveCount(0);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("button", { name: "Show sensitive content", exact: true })).toBeEnabled();
      await expect(page.getByRole("heading", { name: "Hidden item 1", exact: true })).toBeVisible();
    });
    await step("Narrow viewport drawer, navigation, readability and modal keyboard close", async () => {
      const mobile = await browser.newContext({
        viewport: { width: 390, height: 844 },
        storageState: await context.storageState(),
        isMobile: true,
        hasTouch: true,
        locale: "en-IN",
        timezoneId: "Asia/Kolkata",
      });
      mobile.setDefaultTimeout(15000);
      const narrow = await mobile.newPage();
      monitor(narrow);
      await narrow.goto(`${origin}/shiva`, { waitUntil: "domcontentloaded" });
      await expect(narrow.getByRole("heading", { name: "Today, at a glance", exact: true })).toBeVisible();
      await expect(narrow.locator("#shiva-theme-root")).toHaveAttribute("data-effects", "reduced");
      assert(
        await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        "Narrow Home must not overflow horizontally.",
      );
      await screenshot("home-mobile", narrow);
      await narrow.getByRole("button", { name: "Toggle navigation", exact: true }).click();
      await expect(narrow.locator(".nav-scrim")).toBeVisible();
      await expect(narrow.locator(".shiva-nav-close")).toBeFocused();
      await narrow.keyboard.press("Escape");
      await expect(narrow.locator(".shiva-shell")).not.toHaveClass(/nav-open/);
      await narrow.getByRole("button", { name: "Toggle navigation", exact: true }).click();
      await narrow.locator('.shiva-sidebar a[href="/shiva/shopping"]').click();
      await expect(narrow.getByRole("heading", { name: "Shopping", exact: true, level: 1 })).toBeVisible();
      await expect(narrow.locator(".nav-scrim")).toHaveCount(0);
      await narrow.getByRole("button", { name: "Add item", exact: true }).click();
      const dialog = narrow.getByRole("dialog", { name: "Add shopping item", exact: true });
      await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toBeFocused();
      await screenshot("shopping-modal-mobile", narrow);
      await narrow.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      assert(
        await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        "Narrow Shopping must not overflow horizontally.",
      );
      await narrow.goto(`${origin}/shiva/settings/appearance`, { waitUntil: "domcontentloaded" });
      await expect(narrow.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
      await expect(narrow.getByRole("button", { name: "Preview Ivory", exact: true })).toBeVisible();
      assert(
        await narrow.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        "Narrow Appearance must not overflow horizontally.",
      );
      await screenshot("appearance-mobile", narrow);
      await mobile.close();
    });
    await writeFile(
      path.join(output, "restart-expectations.json"),
      JSON.stringify(
        {
          fixture,
          theme: "Midnight Glass",
          background: "#0c111b",
          privacy: true,
          sidebar: "icons",
          hiddenWidget: "agenda",
          wideWidget: "shopping",
          savedPreset: fixture.preset,
          savedLayout: fixture.layout,
        },
        null,
        2,
      ),
    );
    await verifyWallpaper();
  } else if (phase === "wallpaper") {
    await verifyWallpaper();
  } else if (phase === "ssr") {
    await step(
      "Authenticated server HTML contains useful Home, owner summary and saved presentation before hydration",
      async () => {
        const [settingsResponse, summaryResponse] = await Promise.all([
          context.request.get(`${origin}/api/trpc/shiva.settings`),
          context.request.get(`${origin}/api/trpc/shiva.shoppingSummary`),
        ]);
        assert(
          settingsResponse.status() === 200 && summaryResponse.status() === 200,
          "Owner settings and summary reads must succeed.",
        );
        const settingsBody = await settingsResponse.json();
        const summaryBody = await summaryResponse.json();
        const settings = settingsBody.result?.data?.json ?? settingsBody.result?.data;
        const summary = summaryBody.result?.data?.json ?? summaryBody.result?.data;
        assert(
          settings?.theme && settings?.layout && typeof settings.privacy === "boolean",
          "Require validated owner settings.",
        );
        assert(
          typeof summary?.total === "number" && typeof summary?.active === "number",
          "Require a real owner Shopping summary.",
        );
        const response = await context.request.get(`${origin}/shiva`);
        assert(response.status() === 200, "Authenticated Home HTML must succeed.");
        assert(response.headers()["content-type"]?.includes("text/html"), "Require actual server-rendered HTML.");
        const { JSDOM, VirtualConsole } = await import("jsdom");
        // No scripts execute or external resources load. Script/Flight text is excluded from every DOM assertion.
        const document = new JSDOM(await response.text(), { virtualConsole: new VirtualConsole() }).window.document;
        for (const script of document.querySelectorAll("script")) script.remove();
        const rootElement = document.querySelector("#shiva-theme-root");
        assert(rootElement, "Initial server HTML must contain the native theme root.");
        assert(
          rootElement.querySelector(".home-heading h1")?.textContent === "Today, at a glance",
          "Useful Home heading must be rendered before hydration.",
        );
        assert(
          rootElement.querySelector(".demo-tag")?.textContent === "SAMPLE OVERVIEW",
          "Sample notice must be actual rendered DOM.",
        );
        const date = new Intl.DateTimeFormat("en-IN", {
          timeZone: "Asia/Kolkata",
          weekday: "long",
          day: "numeric",
          month: "long",
        }).format(new Date());
        assert(
          rootElement.querySelector(".home-heading .eyebrow")?.textContent?.includes(date),
          "Server date must use Asia/Kolkata.",
        );
        const scheme = rootElement.getAttribute("data-mantine-color-scheme");
        assert(
          scheme === (settings.theme.mode === "system" ? "dark" : settings.theme.mode),
          "Server theme mode must match saved configuration or stable system fallback.",
        );
        assert(
          rootElement.querySelector(".shiva-shell")?.classList.contains(`sidebar-${settings.layout.sidebar}`),
          "Server layout must use saved sidebar preference.",
        );
        const privacyLabel = settings.privacy ? "Show sensitive content" : "Hide sensitive content";
        assert(
          rootElement.querySelector(`.shiva-header button[aria-label="${privacyLabel}"]`),
          "Privacy header must already reflect the saved preference.",
        );
        const shopping = rootElement.querySelector('[data-widget="shopping"]');
        assert(shopping, "Fixture layout must retain the real Shopping summary widget.");
        assert(
          !shopping.querySelector(".mantine-Loader-root"),
          "Initial Shopping summary must not be a loading placeholder.",
        );
        const metricElement = shopping.querySelector(".shopping-metric");
        assert(metricElement, "The initial owner summary metric must be rendered before hydration.");
        const metric = [...metricElement.childNodes]
          .filter((node) => node.nodeType === 3)
          .map((node) => node.textContent)
          .join("")
          .trim();
        assert(
          metric === (settings.privacy ? "••" : String(summary.active)),
          "Rendered Shopping count must use the actual owner summary and privacy mask.",
        );
        assert(
          shopping.textContent.includes(summary.total ? "Review your list" : "Plan your first purchase"),
          "Server summary link must reflect the actual record state.",
        );
        assert(
          rootElement.querySelectorAll(".source-item").length === 4,
          "Initial Home must include honest source states.",
        );
        if (settings.privacy)
          assert(
            rootElement.querySelector(".privacy-banner")?.textContent?.includes("Sensitive content is hidden"),
            "Saved privacy must already mask the server-rendered presentation.",
          );
        report.serverPresentation = {
          usefulHome: true,
          actualOwnerSummary: true,
          privacyMasked: settings.privacy,
          dateTimeZone: "Asia/Kolkata",
          renderedMode: scheme,
          savedSidebar: settings.layout.sidebar,
        };
        return report.serverPresentation;
      },
    );
    await step("Hydrated System preview follows device media and narrow reduced effects without saving", async () => {
      await open("/shiva/settings/appearance");
      await page.waitForLoadState("networkidle");
      const originalScheme = await page.locator("#shiva-theme-root").getAttribute("data-mantine-color-scheme");
      await page.getByLabel("Live preview", { exact: true }).check();
      await page.emulateMedia({ colorScheme: "light" });
      await page.getByText("System", { exact: true }).click();
      await expect(page.locator("#shiva-theme-root")).toHaveAttribute("data-mantine-color-scheme", "light");
      await page.emulateMedia({ colorScheme: "dark" });
      await expect(page.locator("#shiva-theme-root")).toHaveAttribute("data-mantine-color-scheme", "dark");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator("#shiva-theme-root")).toHaveAttribute("data-effects", "reduced");
      const cancel = page.getByRole("button", { name: "Cancel", exact: true });
      if (await cancel.isEnabled()) await cancel.click();
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.emulateMedia({ colorScheme: null, reducedMotion: "no-preference" });
      await expect(page.locator("#shiva-theme-root")).toHaveAttribute("data-mantine-color-scheme", originalScheme);
      await open("/shiva");
      await expect(page.getByRole("heading", { name: "Today, at a glance", exact: true })).toBeVisible();
      await expect(page.getByText("SAMPLE OVERVIEW", { exact: true })).toBeVisible();
      assert(
        ![...destinations.values()].some(
          (request) => request.method === "POST" && request.path.startsWith("/api/trpc/shiva."),
        ),
        "Server-render and media preview checks must not mutate settings or Shopping.",
      );
      await screenshot("hydrated-home");
      return { systemLightDarkVerified: true, reducedMediaVerified: true, nativeMutationCount: 0 };
    });
  } else if (phase === "host") {
    await step("Native Home transitions to existing host administration and Settings", async () => {
      await open("/shiva");
      networkScope = "host-administration";
      await page.getByRole("link", { name: "Homarr administration", exact: true }).click();
      await expect(page).toHaveURL(`${origin}/manage`);
      const settingsLink = page.locator('a[href="/manage/settings"]').first();
      await expect(settingsLink).toBeVisible();
      await settingsLink.click();
      await expect(page).toHaveURL(`${origin}/manage/settings`);
      await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
      await expect(page.getByRole("textbox", { name: "Application name", exact: true })).toBeVisible();
    });
    await step(
      "Actual host ModalProvider opens unsaved-draft confirmation and Cancel preserves the draft",
      async () => {
        const applicationName = page.getByRole("textbox", { name: "Application name", exact: true });
        const originalName = await applicationName.inputValue();
        await applicationName.fill("SHIVA Verification Unsaved Draft");
        await expect(page.getByText("You have unsaved changes!", { exact: true })).toBeVisible();
        await page.locator('a[href="/manage/boards"]').first().click();
        const confirmation = page.getByRole("dialog", { name: "Unsaved changes", exact: true });
        await expect(confirmation).toBeVisible();
        await screenshot("host-unsaved-confirmation");
        await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(confirmation).toBeHidden();
        await expect(page).toHaveURL(`${origin}/manage/settings`);
        await expect(applicationName).toHaveValue("SHIVA Verification Unsaved Draft");
        await page.getByRole("button", { name: "Discard", exact: true }).click();
        await expect(applicationName).toHaveValue(originalName);
        await expect(page.getByText("You have unsaved changes!", { exact: true })).toHaveCount(0);
        const mutations = [...destinations.values()].filter(
          (request) =>
            request.scope === "host-administration" &&
            request.method === "POST" &&
            request.path.startsWith("/api/trpc/"),
        );
        assert.equal(mutations.length, 0, "Opening and canceling the host dialog must not call a mutation.");
        return { originalDraftRestored: true, hostMutationCount: 0 };
      },
    );
    await step("Browser Back returns to SHIVA and native Shopping dialog remains functional", async () => {
      await page.goBack({ waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(`${origin}/manage`);
      networkScope = "shiva-return";
      await page.goBack({ waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(`${origin}/shiva`);
      await expect(page.getByRole("heading", { name: "Today, at a glance", exact: true })).toBeVisible();
      await page.locator('.shiva-sidebar a[href="/shiva/shopping"]').click();
      await page.getByRole("button", { name: "Add item", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Add shopping item", exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("textbox", { name: "Name", exact: true })).toBeFocused();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toBeHidden();
      await screenshot("native-return-shopping");
    });
  } else {
    const expected = JSON.parse(await readFile(path.join(output, "restart-expectations.json"), "utf8"));
    assert.equal(expected.fixture.editedName, fixture.editedName, "Require the smoke phase's synthetic fixture.");
    await step("After process restart: theme, preset, privacy and layout persist", async () => {
      await open("/shiva/settings/appearance");
      await checkTheme(expected.theme, expected.background);
      await expect(page.getByRole("button", { name: "Show sensitive content", exact: true })).toBeEnabled();
      await expect(page.getByRole("button", { name: `Preview ${expected.savedPreset}`, exact: true })).toBeVisible();
      await expect(page.locator(".shiva-shell")).toHaveClass(/sidebar-icons/);
      await open("/shiva");
      assert.equal(expected.wideWidget, "shopping", "Require the smoke phase's synthetic resize expectation.");
      await expect
        .poll(() =>
          page
            .locator(".home-grid > [data-widget]")
            .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-widget"))),
        )
        .toEqual(["priorities", "tasks", "shopping", "connections"]);
      await expect(page.locator('.home-grid > [data-widget="shopping"]')).toHaveClass(/width-wide/);
      const [grid, shoppingCard] = await Promise.all([
        page.locator(".home-grid").boundingBox(),
        page.locator('.home-grid > [data-widget="shopping"]').boundingBox(),
      ]);
      assert(
        grid && shoppingCard && Math.abs(grid.width - shoppingCard.width) < 2,
        "Saved card resize must survive restart.",
      );
      await page.getByRole("button", { name: "Edit layout", exact: true }).click();
      await expect(page.getByLabel("Agenda", { exact: true })).not.toBeChecked();
      await expect(page.getByRole("button", { name: expected.savedLayout, exact: true })).toBeVisible();
      await page.locator(".layout-editor").getByRole("button", { name: "Cancel", exact: true }).click();
    });
    await step("After process restart: edited Shopping record and details persist", async () => {
      await open("/shiva/shopping");
      await privacy(false);
      await expect(page.getByRole("heading", { name: fixture.editedName, exact: true })).toBeVisible();
      await page.getByRole("button", { name: `Edit ${fixture.editedName}`, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Edit shopping item", exact: true });
      await expect(dialog.getByRole("textbox", { name: "Category", exact: true })).toHaveValue(fixture.category);
      await expect(dialog.getByLabel("Notes and requirements", { exact: true })).toHaveValue(fixture.notes);
      await expect(dialog.getByLabel("Product or source URL", { exact: true })).toHaveValue(
        "https://example.com/shiva-verification",
      );
      await expect(dialog.getByLabel("Estimated price", { exact: true })).toHaveValue("1,23,456.78");
      await expect(dialog.getByRole("combobox", { name: "Purchase stage", exact: true })).toHaveValue("Shortlisted");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await screenshot("shopping-after-restart");
    });
    await step("Confirmed deletion, empty state and deletion persistence", async () => {
      await removeFixture(fixture.editedName, true);
      await expect(
        page.getByText("Your list starts empty. Prices are estimates you enter.", { exact: true }),
      ).toBeVisible();
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(
        page.getByText("Your list starts empty. Prices are estimates you enter.", { exact: true }),
      ).toBeVisible();
      await screenshot("shopping-empty");
    });
  }
  await step("No browser runtime exceptions or external account requests", async () => {
    assert.equal(report.pageErrors.length, 0, `Browser runtime exceptions: ${report.pageErrors.join("; ")}`);
    assert.equal(report.consoleErrors.length, 0, `Browser console errors: ${report.consoleErrors.join("; ")}`);
    const external = [...destinations.values()].filter((destination) => destination.external);
    assert.equal(
      external.length,
      0,
      `External browser requests observed: ${external.map((destination) => destination.origin + destination.path).join(", ")}`,
    );
    return {
      consoleErrorCount: report.consoleErrors.length,
      shivaExternalDestinationCount: external.length,
      hostLoginExternalDestinationCount: [...destinations.values()].filter(
        (destination) => destination.external && destination.scope === "host-login",
      ).length,
    };
  });
  report.passed = true;
} catch {
  process.exitCode = 1;
  // No screenshot of an unsuccessful login; password input could still contain credentials.
  if ((await page.locator("#shiva-theme-root").count()) && !new URL(page.url()).pathname.includes("/auth/"))
    await screenshot("failure").catch(() => undefined);
} finally {
  report.finishedAt = new Date().toISOString();
  await flush();
  await browser.close();
  console.log(`Report: ${path.relative(root, path.join(output, `${phase}-report.json`))}`);
}
