// SHIVA extension, Apache-2.0. Production lab measurements on an isolated synthetic account only.
// Run after verify-browser.mjs exports its private session:
// node scripts/shiva/verify-browser-performance.mjs --isolated-verification [--mobile-approximation]
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium, expect } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const origin = process.env.SHIVA_VERIFY_ORIGIN ?? "http://127.0.0.1:3000";
assert(args.includes("--isolated-verification"), "Require --isolated-verification: never measure personal data.");
assert.equal(origin, "http://127.0.0.1:3000", "Only the fixed localhost verification instance is allowed.");
assert(
  args.every((arg) => ["--isolated-verification", "--mobile-approximation"].includes(arg)),
  "Unsupported argument.",
);
const artifact = (name) => path.join(root, "artifacts", name);
await stat(artifact("verification.sqlite"));
const credentialsPath = artifact("verification-credentials.json");
const storagePath = artifact("verification-storage.json");
for (const filename of [credentialsPath, storagePath]) {
  const metadata = await stat(filename);
  if (process.platform !== "win32")
    assert.equal(metadata.mode & 0o077, 0, "Verification credentials/session must remain private.");
}
const credentials = JSON.parse(await readFile(credentialsPath, "utf8"));
assert.equal(
  credentials.username,
  "shiva-verification",
  "Only the isolated synthetic verification account is allowed.",
);
assert.equal(typeof credentials.password, "string");
assert(credentials.password.length >= 20, "Require the generated private verification credentials.");
const buildId = (await readFile(path.join(root, "apps/nextjs/.next/BUILD_ID"), "utf8")).trim();
assert(buildId, "A completed production build is required.");
await mkdir(artifact("."), { recursive: true });

const execFileAsync = promisify(execFile);
const round = (value) => Math.round(value * 100) / 100;
function distribution(values, precision = 2) {
  const rounded = (value) => Number(value.toFixed(precision));
  const sorted = values.filter(Number.isFinite).toSorted((a, b) => a - b);
  const percentile = (rank) =>
    sorted.length ? rounded(sorted[Math.max(0, Math.ceil(rank * sorted.length) - 1)]) : null;
  return {
    count: sorted.length,
    minimum: sorted.length ? rounded(sorted[0]) : null,
    p50: percentile(0.5),
    p75: percentile(0.75),
    p95: percentile(0.95),
    maximum: sorted.length ? rounded(sorted.at(-1)) : null,
  };
}
function redact(value) {
  let result = String(value).slice(0, 2000);
  for (const secret of [credentials.username, credentials.password]) result = result.replaceAll(secret, "[redacted]");
  return result.replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]");
}
const report = {
  startedAt: new Date().toISOString(),
  mode: "Production lab; Windows laptop and Android field performance remain unverified",
  buildId,
  environment: {
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    logicalCpuCount: os.cpus().length,
    totalMemoryMiB: round(os.totalmem() / 1024 ** 2),
    node: process.version,
    browser: null,
  },
  origin,
  dataset: null,
  method: {
    cold: "Ten new authenticated browser contexts; CDP HTTP cache disabled; init-script LCP and standard maximum-session-window CLS observers. Headings, fonts, and network idle awaited before final two-animation-frame snapshot. No interactions before snapshot.",
    warmNavigation:
      "First visit to each module warms its code/data; 50 Home→Shopping→Appearance→Home cycles (150 link activations). Useful destination heading detected on animation frames; endpoint recorded two animation frames later.",
    feedback:
      "Browser capture-phase click timestamp to first visible modal, first closing opacity change/removal, or applied theme token; endpoint recorded after two animation frames. Full modal close settling and Playwright wall duration also reported separately. This is lab feedback latency, not INP.",
    transfers:
      "Chromium CDP Network.loadingFinished encodedDataLength, attributed by Network.responseReceived resource type. Script transfer bytes include encoded response transfer; decoded script bytes are separately drawn from Resource Timing.",
    memory:
      "Linux ps PID/PPID/RSS/comm snapshots; browser subprocess descendants of this benchmark process summed by Chromium/chrome comm, so shared pages may be counted in several process RSS values. RSS is not browser tab memory. Optional app PID from SHIVA_VERIFY_APP_PID measured as a descendant process tree, excluding separately launched Redis and container overhead. Node harness memory reported separately; no combined services-budget claim.",
    percentiles:
      "Nearest-rank distributions, with all samples/outliers/failures retained. Ten cold samples and 50 feedback samples are limited lab evidence; no p99 durable-save or field Web Vitals claim.",
    boundaries:
      "No saved records/settings changes. All external browser requests and non-read API requests are blocked and reported. Private credentials and cookie state are never included in reports.",
  },
  desktop: { coldLoads: [], navigation: [], modalOpen: [], modalClose: [], themePreview: [], warmup: [] },
  mobileApproximation: {
    requested: args.includes("--mobile-approximation"),
    status: "Not run; actual Android qualification remains pending",
    profile: {
      viewport: "390x844",
      downloadMbps: 4,
      uploadMbps: 1,
      roundTripLatencyMs: 150,
      cpuSlowdown: 4,
      mobile: true,
      reducedEffects: true,
    },
    coldLoads: [],
  },
  memory: [],
  consoleErrors: [],
  pageErrors: [],
  blockedRequests: [],
  externalRequests: [],
  devSignals: [],
  failures: [],
  completed: false,
};
async function flush() {
  await writeFile(artifact("performance-browser.json"), JSON.stringify(report, null, 2));
}
function monitor(context, label) {
  context.on("page", (page) => {
    page.on("console", (message) => {
      if (message.type() === "error") report.consoleErrors.push({ phase: label, message: redact(message.text()) });
    });
    page.on("pageerror", (error) => report.pageErrors.push({ phase: label, message: redact(error.message) }));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (["http:", "https:", "ws:", "wss:"].includes(url.protocol) && url.origin !== origin)
        report.externalRequests.push({
          phase: label,
          origin: url.origin,
          path: url.pathname,
          method: request.method(),
        });
      if (url.pathname.includes("webpack-hmr")) report.devSignals.push({ phase: label, signal: "webpack-hmr" });
    });
  });
  return context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const network = ["http:", "https:", "ws:", "wss:"].includes(url.protocol);
    if (
      network &&
      (url.origin !== origin ||
        (url.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method())))
    ) {
      report.blockedRequests.push({ phase: label, origin: url.origin, path: url.pathname, method: request.method() });
      await route.abort("blockedbyclient");
    } else await route.continue();
  });
}

// Executed before application code, without changing records or application event handlers.
function installMetrics() {
  const metrics = { lcp: null, cls: 0, layoutShifts: [], longTasks: [] };
  window.shivaLabMetrics = metrics;
  let windowStart = 0;
  let previousShift = 0;
  let sessionValue = 0;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        metrics.lcp = {
          valueMs: entry.startTime,
          renderTimeMs: entry.renderTime,
          loadTimeMs: entry.loadTime,
          size: entry.size,
          elementTag: entry.element?.tagName ?? null,
          elementId: entry.element?.id ?? null,
        };
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        if (sessionValue > 0 && entry.startTime - previousShift < 1000 && entry.startTime - windowStart < 5000)
          sessionValue += entry.value;
        else {
          windowStart = entry.startTime;
          sessionValue = entry.value;
        }
        previousShift = entry.startTime;
        metrics.cls = Math.max(metrics.cls, sessionValue);
        metrics.layoutShifts.push({ value: entry.value, startTimeMs: entry.startTime });
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        metrics.longTasks.push({ startTimeMs: entry.startTime, durationMs: entry.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch (error) {
    metrics.observerError = String(error);
  }
}

const browser = await chromium.launch({
  executablePath: process.env.SHIVA_CHROMIUM_PATH ?? "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
report.environment.browser = browser.version();
const baseContext = {
  storageState: storagePath,
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "no-preference",
  locale: "en-IN",
  timezoneId: "Asia/Kolkata",
};
async function contextFor(label, mobile = false) {
  const context = await browser.newContext({
    ...baseContext,
    ...(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}),
  });
  context.setDefaultTimeout(15000);
  await monitor(context, label);
  return context;
}
async function ensureAccount(context) {
  const response = await context.request.get(`${origin}/api/auth/session`);
  assert(response.ok(), "Verification host session is unavailable.");
  const session = await response.json();
  assert.equal(session.user?.name, "shiva-verification", "Only the isolated synthetic session may be measured.");
}
async function memorySnapshot(phase) {
  const entry = {
    phase,
    capturedAt: new Date().toISOString(),
    harnessRssMiB: round(process.memoryUsage().rss / 1024 ** 2),
  };
  try {
    const { stdout } = await execFileAsync("ps", ["-eo", "pid=,ppid=,rss=,comm="], { maxBuffer: 1024 * 1024 });
    const processes = stdout
      .trim()
      .split("\n")
      .map((line) => {
        const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
        return match
          ? { pid: Number(match[1]), ppid: Number(match[2]), rssKiB: Number(match[3]), command: match[4] }
          : null;
      })
      .filter(Boolean);
    const descendants = (pid) => {
      const ids = new Set([pid]);
      let added = true;
      while (added) {
        added = false;
        for (const item of processes)
          if (ids.has(item.ppid) && !ids.has(item.pid)) {
            ids.add(item.pid);
            added = true;
          }
      }
      return processes.filter((item) => ids.has(item.pid));
    };
    const browserProcesses = descendants(process.pid).filter((item) => /chrom(?:e|ium)|crashpad/.test(item.command));
    entry.browserProcessCount = browserProcesses.length;
    entry.browserWholeTreeRssMiB = round(browserProcesses.reduce((sum, item) => sum + item.rssKiB, 0) / 1024);
    const appPid = Number(process.env.SHIVA_VERIFY_APP_PID);
    if (Number.isSafeInteger(appPid) && appPid > 0) {
      const appProcesses = descendants(appPid);
      entry.applicationProcessCount = appProcesses.length;
      entry.applicationTreeRssMiB = round(appProcesses.reduce((sum, item) => sum + item.rssKiB, 0) / 1024);
    }
  } catch (error) {
    entry.unavailable = redact(error.message);
  }
  report.memory.push(entry);
}

async function coldLoad(index, mobile = false) {
  const label = `${mobile ? "mobile-approximation" : "desktop"}-cold-${index}`;
  const context = await contextFor(label, mobile);
  const row = { index, cache: "CDP disabled; new browser context", lcp: null, cls: null, failure: null };
  try {
    await context.addInitScript(installMetrics);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    if (mobile) {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 150,
        downloadThroughput: 4_000_000 / 8,
        uploadThroughput: 1_000_000 / 8,
        connectionType: "cellular4g",
      });
    }
    const resourceTypes = new Map();
    let scriptTransferBytes = 0;
    let allTransferBytes = 0;
    cdp.on("Network.responseReceived", ({ requestId, type }) => resourceTypes.set(requestId, type));
    cdp.on("Network.loadingFinished", ({ requestId, encodedDataLength }) => {
      allTransferBytes += encodedDataLength;
      if (resourceTypes.get(requestId) === "Script") scriptTransferBytes += encodedDataLength;
    });
    const started = performance.now();
    const response = await page.goto(`${origin}/shiva`, { waitUntil: "domcontentloaded", timeout: 60000 });
    assert(response?.ok(), "Home document did not load successfully.");
    const html = await response.text();
    assert(
      !/react-refresh|_next\/static\/development\/|__next_dev_client__/.test(html),
      "Development scripts detected: production measurements refused.",
    );
    await expect(page.getByRole("heading", { name: "Today, at a glance", exact: true })).toBeVisible({
      timeout: 60000,
    });
    row.usefulHeadingWallMs = round(performance.now() - started);
    await page.evaluate(() => document.fonts.ready);
    try {
      await page.waitForLoadState("networkidle", { timeout: 10000 });
      row.networkSettled = true;
    } catch {
      row.networkSettled = false;
    }
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const metrics = await page.evaluate(() => ({
      ...window.shivaLabMetrics,
      resources: performance
        .getEntriesByType("resource")
        .filter((entry) => entry.initiatorType === "script" || /\.js(?:$|\?)/.test(entry.name))
        .map((entry) => ({ decodedBodySize: entry.decodedBodySize, encodedBodySize: entry.encodedBodySize })),
    }));
    assert(!metrics.observerError, "Browser metric observers were unavailable.");
    assert(metrics.lcp !== null, "No LCP candidate was observed.");
    row.lcp = metrics.lcp;
    row.cls = metrics.cls;
    row.layoutShifts = metrics.layoutShifts;
    row.longTasks = metrics.longTasks;
    row.scriptTransferBytes = scriptTransferBytes;
    row.allTransferBytes = allTransferBytes;
    row.decodedScriptBytes = metrics.resources.reduce((sum, resource) => sum + resource.decodedBodySize, 0);
    row.effects = await page.locator("#shiva-theme-root").getAttribute("data-effects");
    row.viewport = page.viewportSize();
    if (index === 10) await memorySnapshot(`${label}-one-active-tab`);
  } catch (error) {
    row.failure = redact(error.message);
    report.failures.push({ phase: label, error: row.failure });
  } finally {
    await context.close();
  }
  (mobile ? report.mobileApproximation.coldLoads : report.desktop.coldLoads).push(row);
  await flush();
  console.log(`${label}: ${row.failure ? "FAILED" : `LCP ${Math.round(row.lcp.valueMs)} ms, CLS ${round(row.cls)}`}`);
}

async function activation(page, target, condition) {
  const wallStart = performance.now();
  await page.evaluate((criteria) => {
    window.shivaLabAction = null;
    let started = null;
    let initialOpacity = 0;
    document.addEventListener(
      "click",
      () => {
        started = performance.now();
        const initialDialog = document.querySelector('[role="dialog"]');
        initialOpacity = initialDialog ? Number(getComputedStyle(initialDialog).opacity) : 0;
      },
      { capture: true, once: true },
    );
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- Playwright serializes this callback into the browser; Node helpers are unavailable there.
    const visible = (element) =>
      Boolean(
        element &&
        element.getBoundingClientRect().width > 0 &&
        element.getBoundingClientRect().height > 0 &&
        getComputedStyle(element).visibility !== "hidden" &&
        Number(getComputedStyle(element).opacity) > 0,
      );
    function ready() {
      if (criteria.kind === "heading")
        return (
          [...document.querySelectorAll("h1,h2")].some(
            (element) => element.textContent.trim() === criteria.value && visible(element),
          ) &&
          (criteria.value !== "Shopping" ||
            !document.querySelector(".shiva-shopping-content")?.textContent.includes("Loading your shopping list"))
        );
      if (criteria.kind === "modal-open") return visible(document.querySelector('[role="dialog"]'));
      if (criteria.kind === "modal-close") {
        const dialog = document.querySelector('[role="dialog"]');
        return !visible(dialog) || Number(getComputedStyle(dialog).opacity) < initialOpacity - 0.01;
      }
      return (
        getComputedStyle(document.querySelector("#shiva-theme-root")).getPropertyValue("--shiva-bg").trim() ===
        criteria.value
      );
    }
    function inspect() {
      if (started !== null && ready())
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            window.shivaLabAction = { feedbackMs: performance.now() - started };
          }),
        );
      else requestAnimationFrame(inspect);
    }
    requestAnimationFrame(inspect);
  }, condition);
  await target.click();
  await page.waitForFunction(() => window.shivaLabAction !== null, null, { polling: "raf", timeout: 15000 });
  return { ...(await page.evaluate(() => window.shivaLabAction)), wallMs: round(performance.now() - wallStart) };
}

let warmContext;
try {
  const guard = await contextFor("guard");
  try {
    await ensureAccount(guard);
  } finally {
    await guard.close();
  }
  await memorySnapshot("browser-started");
  for (let index = 1; index <= 10; index += 1) await coldLoad(index);
  await memorySnapshot("after-ten-cold-loads");
  warmContext = await contextFor("warm-interactions");
  const page = await warmContext.newPage();
  const routes = [
    { route: "/shiva/shopping", heading: "Shopping" },
    { route: "/shiva/settings/appearance", heading: "Appearance" },
    { route: "/shiva", heading: "Today, at a glance" },
  ];
  await page.goto(`${origin}/shiva`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Today, at a glance", exact: true })).toBeVisible();
  for (const destination of routes) {
    const started = performance.now();
    await page.locator(`.shiva-sidebar .shiva-nav-link[href="${destination.route}"]`).click();
    await expect(page.getByRole("heading", { name: destination.heading, exact: true })).toBeVisible();
    if (destination.route === "/shiva/shopping") {
      await expect(page.getByText("Loading your shopping list…", { exact: true })).toHaveCount(0);
      await expect.poll(() => page.locator(".shiva-shopping-metric strong").first().innerText()).not.toBe("—");
      report.dataset = await page.evaluate(() => {
        const metrics = [...document.querySelectorAll(".shiva-shopping-metric strong")];
        const active = Number(metrics[0]?.textContent);
        const purchased = Number(metrics[1]?.textContent);
        return {
          owner: "isolated synthetic verification account",
          shoppingTotalFromReadOnlySummary: active + purchased,
          activeShopping: active,
          purchasedShopping: purchased,
          renderedShoppingRows: document.querySelectorAll(".shiva-shopping-row").length,
        };
      });
    }
    report.desktop.warmup.push({ route: destination.route, wallMs: round(performance.now() - started) });
  }
  for (let cycle = 1; cycle <= 50; cycle += 1) {
    for (const destination of routes) {
      const label = `navigation-${cycle}-${destination.heading}`;
      try {
        const measurement = await activation(
          page,
          page.locator(`.shiva-sidebar .shiva-nav-link[href="${destination.route}"]`),
          {
            kind: "heading",
            value: destination.heading,
          },
        );
        report.desktop.navigation.push({ cycle, route: destination.route, ...measurement, failure: null });
      } catch (error) {
        const failure = redact(error.message);
        report.desktop.navigation.push({ cycle, route: destination.route, failure });
        report.failures.push({ phase: label, error: failure });
        throw error;
      }
    }
    if (cycle % 10 === 0) {
      await flush();
      console.log(`Cached navigation: ${cycle}/50 cycles`);
    }
  }
  await memorySnapshot("after-150-cached-navigations");
  await page.locator('.shiva-sidebar .shiva-nav-link[href="/shiva/shopping"]').click();
  await expect(page.getByRole("heading", { name: "Shopping", exact: true })).toBeVisible();
  for (let index = 1; index <= 50; index += 1) {
    const opened = await activation(page, page.getByRole("button", { name: "Add item", exact: true }), {
      kind: "modal-open",
    });
    report.desktop.modalOpen.push({ index, ...opened });
    const closed = await activation(
      page,
      page
        .getByRole("dialog", { name: "Add shopping item", exact: true })
        .getByRole("button", { name: "Cancel", exact: true }),
      { kind: "modal-close" },
    );
    const settlingStarted = performance.now();
    await expect(page.getByRole("dialog", { name: "Add shopping item", exact: true })).toBeHidden();
    closed.settledAfterFeedbackWallMs = round(performance.now() - settlingStarted);
    report.desktop.modalClose.push({ index, ...closed });
    if (index % 10 === 0) {
      await flush();
      console.log(`Modal feedback: ${index}/50 open/cancel pairs`);
    }
  }
  await page.locator('.shiva-sidebar .shiva-nav-link[href="/shiva/settings/appearance"]').click();
  await expect(page.getByRole("heading", { name: "Appearance", exact: true })).toBeVisible();
  const initialThemeName = await page.getByLabel("Theme name", { exact: true }).inputValue();
  const initialBackground = await page
    .locator("#shiva-theme-root")
    .evaluate((element) => getComputedStyle(element).getPropertyValue("--shiva-bg").trim());
  await page.getByRole("button", { name: "Preview Graphite", exact: true }).click();
  for (let index = 1; index <= 50; index += 1) {
    const name = index % 2 ? "Midnight Glass" : "Graphite";
    const measurement = await activation(page, page.getByRole("button", { name: `Preview ${name}`, exact: true }), {
      kind: "theme",
      value: name === "Graphite" ? "#14171c" : "#0c111b",
    });
    report.desktop.themePreview.push({ index, preset: name, ...measurement });
  }
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });
  if (await cancel.isEnabled()) await cancel.click();
  await expect(page.getByLabel("Theme name", { exact: true })).toHaveValue(initialThemeName);
  await expect
    .poll(() =>
      page
        .locator("#shiva-theme-root")
        .evaluate((element) => getComputedStyle(element).getPropertyValue("--shiva-bg").trim()),
    )
    .toBe(initialBackground);
  await memorySnapshot("after-modal-and-theme-loops");
  await warmContext.close();
  warmContext = null;
  if (report.mobileApproximation.requested) {
    report.mobileApproximation.status =
      "Running constrained Chromium simulation; actual Android qualification remains pending";
    for (let index = 1; index <= 10; index += 1) await coldLoad(index, true);
    report.mobileApproximation.status =
      "Completed constrained Chromium simulation; actual Android qualification remains pending";
  }
  assert.equal(report.devSignals.length, 0, "Development runtime detected.");
  assert.equal(report.blockedRequests.length, 0, "Unexpected external requests or API writes were attempted.");
  assert.equal(report.externalRequests.length, 0, "Unexpected external browser destinations were observed.");
  assert.equal(report.pageErrors.length, 0, "Browser runtime errors were observed.");
  report.completed = report.failures.length === 0;
  if (!report.completed) process.exitCode = 1;
} catch (error) {
  report.failures.push({ phase: "suite", error: redact(error.message) });
  process.exitCode = 1;
} finally {
  await warmContext?.close().catch(() => undefined);
  await memorySnapshot("before-browser-close");
  await browser.close();
  const summarizeCold = (rows) => ({
    attempted: rows.length,
    failed: rows.filter((row) => row.failure !== null).length,
    lcpMs: distribution(rows.map((row) => row.lcp?.valueMs)),
    cls: distribution(
      rows.map((row) => row.cls),
      4,
    ),
    scriptTransferBytes: distribution(rows.map((row) => row.scriptTransferBytes)),
    outliers: rows
      .filter((row) => row.failure !== null || row.lcp?.valueMs > 2500 || row.cls > 0.1)
      .map((row) => ({ index: row.index, lcpMs: row.lcp?.valueMs ?? null, cls: row.cls, failure: row.failure })),
  });
  const summarizeActions = (rows, threshold) => ({
    attempted: rows.length,
    feedbackMs: distribution(rows.map((row) => row.feedbackMs)),
    automationWallMs: distribution(rows.map((row) => row.wallMs)),
    budgetMs: threshold,
    outliers: rows.filter((row) => row.failure || row.feedbackMs > threshold),
  });
  report.desktop.summary = {
    cold: summarizeCold(report.desktop.coldLoads),
    navigation: {
      ...summarizeActions(report.desktop.navigation, 500),
      byRoute: Object.fromEntries(
        [...new Set(report.desktop.navigation.map((row) => row.route))].map((route) => [
          route,
          summarizeActions(
            report.desktop.navigation.filter((row) => row.route === route),
            500,
          ),
        ]),
      ),
    },
    modalOpen: summarizeActions(report.desktop.modalOpen, 100),
    modalClose: {
      ...summarizeActions(report.desktop.modalClose, 100),
      settlingAfterFeedbackWallMs: distribution(report.desktop.modalClose.map((row) => row.settledAfterFeedbackWallMs)),
    },
    themePreview: summarizeActions(report.desktop.themePreview, 100),
  };
  report.mobileApproximation.summary = summarizeCold(report.mobileApproximation.coldLoads);
  report.finishedAt = new Date().toISOString();
  await flush();
  console.log(`Report: ${path.relative(root, artifact("performance-browser.json"))}`);
}
