// SHIVA extension, Apache-2.0. Synthetic localhost API measurements and bounded browser qualification.
// Run after browser verification releases the isolated account:
// node scripts/shiva/verify-performance.mjs --isolated-verification
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const origin = "http://127.0.0.1:3000";
assert.deepEqual(
  process.argv.slice(2),
  ["--isolated-verification"],
  "Require --isolated-verification; never run against personal data.",
);
assert.equal(
  process.env.SHIVA_VERIFY_ORIGIN ?? origin,
  origin,
  "Only the fixed localhost verification instance is allowed.",
);
if (process.env.DB_URL) {
  assert.equal(
    path.resolve(process.env.DB_URL),
    path.join(root, "artifacts/verification.sqlite"),
    "DB_URL must point to the isolated verification database.",
  );
}
async function readPrivateJSON(filename) {
  try {
    return JSON.parse(await readFile(path.join(root, "artifacts", filename), "utf8"));
  } catch {
    // JSON parse errors can echo private input, so never expose the underlying error.
    throw new Error("Private verification files are missing or invalid. Run isolated browser verification first.");
  }
}
const credentials = await readPrivateJSON("verification-credentials.json");
assert(credentials.username === "shiva-verification", "Only the synthetic verification account is allowed.");
assert.equal(typeof credentials.password, "string", "Verification credentials are required.");
assert(credentials.password.length > 20, "Require the generated verification credentials.");
const storage = await readPrivateJSON("verification-storage.json");
assert(Array.isArray(storage.cookies), "The private browser storage file must contain session cookies.");
const cookies = storage.cookies.filter(
  (cookie) => cookie.domain === "127.0.0.1" && (cookie.expires < 0 || cookie.expires > Date.now() / 1000),
);
assert(cookies.length > 0, "Run isolated browser authentication before this measurement.");
const cookieHeader = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
const secrets = [credentials.username, credentials.password, cookieHeader, ...cookies.map(({ value }) => value)];
const require = createRequire(path.join(root, "apps/nextjs/package.json"));
const { createTRPCClient, httpLink } = await import(require.resolve("@trpc/client"));
const { default: superjson } = await import(require.resolve("superjson"));
const prefix = `SHIVA Performance ${randomBytes(6).toString("hex")}`;
const reportPath = path.join(root, "artifacts/performance-api.json");
const report = {
  startedAt: new Date().toISOString(),
  origin,
  fixturePrefix: prefix,
  environment: {
    platform: os.platform(),
    architecture: os.arch(),
    node: process.version,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    logicalCpus: os.availableParallelism(),
    machineMemoryBytes: os.totalmem(),
    sourceCommit:
      spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout?.trim() ?? "unavailable",
    sourceHasChanges: Boolean(
      spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).stdout?.trim(),
    ),
  },
  method: {
    workload:
      "Sequential authenticated non-batched tRPC HTTP calls to the production instance started by the operator.",
    serverMode:
      "Not detectable from the API; the operator must start a built next start instance. This script does not certify production mode independently.",
    latency:
      "Complete localhost client request, authentication, database work, response-body capture and SuperJSON decode; server-only time is not isolated.",
    payload: "Decoded HTTP response bytes captured from a cloned response; not compressed wire bytes.",
    percentiles:
      "Nearest rank; 50 measured calls after five warm-ups per read flow. p99 for 50 reads is descriptive, not a reliable tail estimate. Durable-update flow contains 1,000 consecutive operations.",
    data: "200 then 2,000 synthetic records, ten categories, five stages, three priorities, four currencies, unknown estimates and 4,800-character notes. Browser persistence fixtures remain untouched.",
    settings:
      "Read only. recoveryWarning is explicitly removed from the preserved settings snapshot; settings are not mutated.",
    browser:
      "Separate from API samples: one cold context at 2,000 records, useful first-page load, sequential Next-page navigation through the last page, desktop/narrow overflow checks and screenshots. No UI writes or field-web-vitals claims.",
  },
  profiles: [],
  measurements: {},
  failures: [],
  cleanup: { attempted: false, complete: false, remainingSyntheticRecords: null },
  settingsPreserved: false,
  qualificationComplete: false,
  unmeasuredReleaseGates: [
    "Windows laptop performance",
    "Android device performance",
    "Cold load/LCP/CLS/INP",
    "Browser rendering traces and representative-device navigation",
    "Server-only latency",
    "Application/browser/Docker resource attribution",
    "Eight-hour soak",
    "Comparable unmodified upstream baseline",
  ],
  passed: false,
};
const measurements = new Map();
const created = new Map();
let activeMeasurement = null;
let interrupted = false;
let originalSettings;
let baselineSummary;
process.once("SIGINT", () => {
  interrupted = true;
});
process.once("SIGTERM", () => {
  interrupted = true;
});

function safeError(error) {
  let message = String(error?.message ?? "Verification failed").slice(0, 500);
  for (const secret of secrets) if (secret) message = message.replaceAll(secret, "[redacted]");
  return { code: String(error?.data?.code ?? error?.code ?? "VERIFICATION_FAILED").slice(0, 60), message };
}
function percentile(sorted, fraction) {
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
}
function aggregate(samples) {
  const latencies = samples.map((sample) => sample.elapsedMs).toSorted((a, b) => a - b);
  const bytes = samples.map((sample) => sample.responseBytes).toSorted((a, b) => a - b);
  return {
    operations: samples.length,
    failures: samples.filter((sample) => !sample.success).length,
    milliseconds: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      p99: percentile(latencies, 0.99),
      max: latencies.at(-1) ?? null,
    },
    decodedResponseBytes: { p50: percentile(bytes, 0.5), p95: percentile(bytes, 0.95), max: bytes.at(-1) ?? null },
    slowerThan300Ms: latencies.filter((value) => value > 300).length,
    slowerThan500Ms: latencies.filter((value) => value > 500).length,
    slowerThan1000Ms: latencies.filter((value) => value > 1000).length,
    samples,
  };
}
async function flush() {
  report.measurements = Object.fromEntries([...measurements].map(([name, samples]) => [name, aggregate(samples)]));
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  await chmod(reportPath, 0o600);
}
async function measure(label, operation) {
  const sample = { elapsedMs: 0, responseBytes: 0, httpStatus: null, success: false };
  activeMeasurement = sample;
  const started = performance.now();
  try {
    const result = await operation();
    sample.success = true;
    return result;
  } finally {
    sample.elapsedMs = Math.round((performance.now() - started) * 1000) / 1000;
    activeMeasurement = null;
    if (!measurements.has(label)) measurements.set(label, []);
    measurements.get(label).push(sample);
  }
}
const client = createTRPCClient({
  links: [
    httpLink({
      url: `${origin}/api/trpc`,
      transformer: superjson,
      headers: { cookie: cookieHeader, "x-trpc-source": "shiva-isolated-performance" },
      fetch: async (url, init) => {
        const target = new URL(typeof url === "string" ? url : url.url);
        assert.equal(target.origin, origin, "Verification requests must remain on localhost.");
        assert(target.pathname.startsWith("/api/trpc/"), "Only the local tRPC endpoint is allowed.");
        const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) });
        const body = await response.clone().arrayBuffer();
        if (activeMeasurement) {
          activeMeasurement.responseBytes += body.byteLength;
          activeMeasurement.httpStatus = response.status;
        }
        return response;
      },
    }),
  ],
});
const stages = ["considering", "researching", "shortlisted", "budgeted", "purchased"];
const currencies = ["INR", "USD", "EUR", "GBP"];
function fixture(index) {
  return {
    name: `${prefix} Item ${String(index + 1).padStart(4, "0")}`,
    category: `Performance ${String(index % 10).padStart(2, "0")}`,
    priority: ["high", "medium", "low"][index % 3],
    estimatedPrice: index % 11 === 0 ? null : (125010 + index * 31) / 100,
    currency: currencies[index % currencies.length],
    stage: stages[index % stages.length],
    notes: "Synthetic performance fixture; no personal records or real purchase prices. ".repeat(70).slice(0, 4800),
    url: "https://example.invalid/shiva-synthetic-product",
  };
}
function assertBounded(result) {
  assert(result.items.length <= 30, "Shopping list must contain at most the requested 30 rows.");
  for (const item of result.items)
    assert(!Object.hasOwn(item, "notes"), "Long notes must not appear in list responses.");
}
async function reads(label, operation, verify) {
  for (let index = 0; index < 5; index += 1) verify(await operation());
  for (let index = 0; index < 50; index += 1) {
    assert(!interrupted, "Verification interrupted; cleaning synthetic fixtures.");
    verify(await measure(label, operation));
  }
}
async function profile(size) {
  const summary = await client.shiva.shoppingSummary.query();
  assert.equal(
    summary.total,
    baselineSummary.total + size,
    "The profile must contain precisely the newly seeded synthetic volume plus the pre-existing browser fixtures.",
  );
  report.profiles.push({
    syntheticRecords: size,
    totalAccountRecords: summary.total,
    baselineBrowserFixtures: baselineSummary.total,
  });
  await reads(
    `records-${size}/list-first-page`,
    () => client.shiva.shoppingList.query({ limit: 30, offset: 0 }),
    (result) => {
      assertBounded(result);
      assert.equal(result.total, summary.total);
    },
  );
  await reads(
    `records-${size}/list-last-page`,
    () => client.shiva.shoppingList.query({ limit: 30, offset: Math.floor((summary.total - 1) / 30) * 30 }),
    assertBounded,
  );
  const filter = {
    limit: 30,
    offset: 0,
    search: prefix,
    category: "Performance 03",
    stage: "budgeted",
    priority: "high",
  };
  const matches = [...created.values()].filter(
    (record) =>
      record.data.category === filter.category &&
      record.data.stage === filter.stage &&
      record.data.priority === filter.priority,
  ).length;
  await reads(
    `records-${size}/filtered-search`,
    () => client.shiva.shoppingList.query(filter),
    (result) => {
      assertBounded(result);
      assert.equal(result.total, matches);
      assert(
        result.items.every((item) => item.name.startsWith(prefix)),
        "Filtered fixtures must stay isolated.",
      );
    },
  );
  await reads(
    `records-${size}/summary`,
    () => client.shiva.shoppingSummary.query(),
    (result) => assert.equal(result.total, summary.total),
  );
  const detailId = created.keys().next().value;
  await reads(
    `records-${size}/deliberate-detail`,
    () => client.shiva.shoppingDetail.query({ id: detailId }),
    (result) => assert.equal(result.notes.length, 4800),
  );
  await flush();
  console.log(`Measured bounded list, filtered search, summary and detail with ${size} synthetic records.`);
}
async function browserQualification(size) {
  const requireRoot = createRequire(path.join(root, "package.json"));
  const { chromium, expect } = requireRoot("@playwright/test");
  const total = baselineSummary.total + size;
  const pages = Math.ceil(total / 30);
  const result = {
    syntheticRecords: size,
    totalAccountRecords: total,
    firstPageUsefulContentMs: null,
    renderedRows: {},
    viewportChecks: [],
    screenshots: [],
    pageNavigation: null,
    pageErrors: [],
    consoleErrors: [],
    externalOrigins: [],
    passed: false,
  };
  report.browser = result;
  const browser = await chromium.launch({
    executablePath: process.env.SHIVA_CHROMIUM_PATH ?? "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({
      storageState: path.join(root, "artifacts/verification-storage.json"),
      viewport: { width: 1440, height: 1000 },
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
    });
    context.setDefaultTimeout(15_000);
    const page = await context.newPage();
    const externalOrigins = new Set();
    page.on("pageerror", (error) => result.pageErrors.push(safeError(error).message));
    page.on("console", (message) => {
      if (message.type() === "error") result.consoleErrors.push(safeError(new Error(message.text())).message);
    });
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (["http:", "https:", "ws:", "wss:"].includes(url.protocol) && url.origin !== origin)
        externalOrigins.add(url.origin);
    });
    const rows = page.locator(".shiva-shopping-row");
    const metadata = page.locator(".shiva-shopping-list-meta");
    const pager = page.getByRole("navigation", { name: "Shopping pages", exact: true });
    async function screenshot(filename) {
      await page.screenshot({ path: path.join(root, "artifacts", filename), fullPage: true, animations: "disabled" });
      result.screenshots.push(`artifacts/${filename}`);
    }
    async function checkViewport(width, height) {
      await page.setViewportSize({ width, height });
      await expect(page.getByRole("heading", { name: "Shopping", exact: true })).toBeVisible();
      const bounds = await page.evaluate(() => {
        const rowBounds = [...document.querySelectorAll(".shiva-shopping-row")].map((row) =>
          row.getBoundingClientRect(),
        );
        return {
          viewportWidth: window.innerWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          renderedRows: rowBounds.length,
          rowsOutsideViewport: rowBounds.filter(({ left, right }) => left < -1 || right > window.innerWidth + 1).length,
        };
      });
      result.viewportChecks.push({ width, height, ...bounds });
      assert(bounds.documentScrollWidth <= width + 1, `Shopping must not overflow horizontally at ${width}px.`);
      assert.equal(bounds.rowsOutsideViewport, 0, `Shopping cards must fit within the ${width}px viewport.`);
      assert(bounds.renderedRows <= 30, "The browser must render at most one bounded page.");
    }
    const loadStarted = performance.now();
    await page.goto(`${origin}/shiva/shopping`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Shopping", exact: true })).toBeVisible();
    await expect(rows).toHaveCount(Math.min(30, total));
    await expect(metadata).toContainText(`1–${Math.min(30, total)} of ${total} items`);
    result.firstPageUsefulContentMs = Math.round((performance.now() - loadStarted) * 1000) / 1000;
    result.renderedRows.firstPage = await rows.count();
    await checkViewport(1440, 1000);
    await screenshot("performance-shopping-2000.png");
    await checkViewport(390, 844);
    await screenshot("performance-shopping-2000-mobile.png");
    await checkViewport(1440, 1000);
    const navigationSamples = [];
    for (let destination = 2; destination <= pages; destination += 1) {
      assert(!interrupted, "Verification interrupted; cleaning synthetic fixtures.");
      const next = pager.getByRole("button", { name: "Next", exact: true });
      await expect(next).toBeEnabled();
      const started = performance.now();
      await next.click();
      await expect(pager.getByText(`Page ${destination} of ${pages}`, { exact: true })).toBeVisible();
      await expect(rows).toHaveCount(Math.min(30, total - (destination - 1) * 30));
      await expect(metadata).toContainText(
        `${(destination - 1) * 30 + 1}–${Math.min(destination * 30, total)} of ${total} items`,
      );
      navigationSamples.push(Math.round((performance.now() - started) * 1000) / 1000);
    }
    await expect(pager.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    result.renderedRows.lastPage = await rows.count();
    result.lastPage = pages;
    const sorted = navigationSamples.toSorted((a, b) => a - b);
    result.pageNavigation = {
      description:
        "Sequential uncached Next-page activations through the final page; includes Playwright actionability and rendering waits, not cached module navigation or INP.",
      operations: navigationSamples.length,
      milliseconds: {
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: sorted.at(-1),
      },
      samples: navigationSamples,
    };
    await screenshot("performance-shopping-2000-last-page.png");
    result.externalOrigins = [...externalOrigins];
    assert.equal(result.pageErrors.length, 0, "Browser qualification must not raise page errors.");
    assert.equal(result.consoleErrors.length, 0, "Browser qualification must not raise console errors.");
    assert.equal(result.externalOrigins.length, 0, "Synthetic Shopping must not call external providers.");
    result.passed = true;
    console.log(`Verified desktop/narrow Shopping and last-page navigation with ${size} synthetic records.`);
  } finally {
    await browser.close();
    await flush();
  }
}
async function cleanup() {
  report.cleanup.attempted = true;
  // Exact unique run prefix, not the generic SHIVA Verification browser fixtures.
  // Querying again also catches a create acknowledged by the DB whose HTTP response was lost.
  try {
    for (;;) {
      const result = await client.shiva.shoppingList.query({ limit: 100, offset: 0, search: prefix });
      if (result.items.length === 0) break;
      for (const item of result.items) {
        assert(item.name.startsWith(`${prefix} Item `), "Refuse to clean any record outside this synthetic run.");
        await measure("cleanup/delete", () => client.shiva.shoppingDelete.mutate({ id: item.id }));
        created.delete(item.id);
      }
    }
    const remaining = await client.shiva.shoppingList.query({ limit: 1, offset: 0, search: prefix });
    report.cleanup.remainingSyntheticRecords = remaining.total;
    report.cleanup.complete = remaining.total === 0;
    if (baselineSummary)
      assert.deepEqual(
        await client.shiva.shoppingSummary.query(),
        baselineSummary,
        "Browser persistence fixtures and original aggregate values must survive cleanup.",
      );
    if (originalSettings) {
      const { recoveryWarning: _warning, ...saved } = await client.shiva.settings.query();
      assert.deepEqual(
        saved,
        originalSettings,
        "Original theme, layouts, privacy, presets and revision must remain unchanged.",
      );
      report.settingsPreserved = true;
    }
  } catch (error) {
    report.failures.push({ phase: "cleanup", ...safeError(error) });
  }
}

try {
  const fingerprint = createHash("sha256");
  for (const filename of [
    "packages/api/src/router/shiva.ts",
    "packages/validation/src/shiva.ts",
    "apps/nextjs/src/shiva/shopping.tsx",
  ]) {
    fingerprint.update(filename).update(await readFile(path.join(root, filename)));
  }
  report.environment.shivaSourceFingerprint = fingerprint.digest("hex");
  const sessionResponse = await fetch(`${origin}/api/auth/session`, {
    headers: { cookie: cookieHeader },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  assert(sessionResponse.ok, "A verified isolated session is required.");
  const session = await sessionResponse.json();
  assert(
    session.user?.name === credentials.username,
    "Authenticated identity must match the synthetic verification account.",
  );
  report.identityVerified = true;
  const { recoveryWarning, ...settings } = await client.shiva.settings.query();
  assert.equal(recoveryWarning, false, "Resolve corrupt verification settings before measuring.");
  originalSettings = structuredClone(settings);
  baselineSummary = await client.shiva.shoppingSummary.query();
  report.baselineRecordCount = baselineSummary.total;
  report.ordinarySettingsBytes = Buffer.byteLength(JSON.stringify(settings));
  assert(report.ordinarySettingsBytes <= 50 * 1024, "Ordinary settings must remain below 50 KiB.");
  assert(
    !(await client.shiva.shoppingList.query({ limit: 1, offset: 0, search: prefix })).total,
    "The unique synthetic run must start empty.",
  );
  for (let index = 0; index < 2000; index += 1) {
    assert(!interrupted, "Verification interrupted; cleaning synthetic fixtures.");
    const data = fixture(index);
    const record = await measure("seed/create", () => client.shiva.shoppingCreate.mutate(data));
    created.set(record.id, { id: record.id, data });
    if (index === 199) await profile(200);
    if ((index + 1) % 500 === 0) console.log(`Seeded ${index + 1} synthetic records.`);
  }
  await profile(2000);
  // Do not overlap browser rendering with timed API operations.
  try {
    await browserQualification(2000);
  } catch (error) {
    report.failures.push({ phase: "browser-qualification", ...safeError(error) });
  }
  const record = created.values().next().value;
  for (let index = 0; index < 1000; index += 1) {
    assert(!interrupted, "Verification interrupted; cleaning synthetic fixtures.");
    const data = { ...record.data, estimatedPrice: (100001 + index) / 100 };
    const saved = await measure("durable-update-1000", () =>
      client.shiva.shoppingUpdate.mutate({ id: record.id, data }),
    );
    assert.equal(
      saved.estimatedPrice,
      data.estimatedPrice,
      "A successful mutation must acknowledge the exact entered two-decimal estimate.",
    );
    record.data = data;
    if ((index + 1) % 250 === 0) console.log(`Measured ${index + 1} consecutive synthetic durable updates.`);
  }
  const durable = aggregate(measurements.get("durable-update-1000"));
  const readGroups = [...measurements].filter(([name]) => name.startsWith("records-"));
  report.gates = {
    boundedListsAndSeparateDetails: true,
    ordinarySettingsBelow50KiB: report.ordinarySettingsBytes <= 50 * 1024,
    browserQualificationAt2000Records: report.browser?.passed === true,
    localhostReadRoundTripP95Below300Ms: readGroups.every(([, samples]) => aggregate(samples).milliseconds.p95 <= 300),
    durableMutations: {
      operations: durable.operations,
      failures: durable.failures,
      p95Below500Ms: durable.milliseconds.p95 <= 500,
      p99Below1000Ms: durable.milliseconds.p99 <= 1000,
    },
  };
} catch (error) {
  report.failures.push({ phase: "measurement", ...safeError(error) });
} finally {
  if (report.identityVerified) await cleanup();
  report.finishedAt = new Date().toISOString();
  report.passed =
    report.failures.length === 0 &&
    report.cleanup.complete &&
    report.settingsPreserved &&
    report.gates?.localhostReadRoundTripP95Below300Ms === true &&
    report.gates?.durableMutations.operations === 1000 &&
    report.gates?.durableMutations.failures === 0 &&
    report.gates?.durableMutations.p95Below500Ms === true &&
    report.gates?.durableMutations.p99Below1000Ms === true;
  await flush();
}
console.log(
  `${report.passed ? "PASS" : "FAIL"} isolated API lab checks; report: artifacts/performance-api.json. Full professional-performance qualification remains pending.`,
);
if (!report.passed) {
  for (const failure of report.failures) console.error(`${failure.phase}: ${failure.code}: ${failure.message}`);
  process.exitCode = 1;
}
