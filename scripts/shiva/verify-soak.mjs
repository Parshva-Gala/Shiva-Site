#!/usr/bin/env node
// SHIVA, Apache-2.0. Linux-only, localhost, synthetic-account qualification.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, readFile, readdir, readlink, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, expect } from "@playwright/test";

import {
  validateRedisDockerInspection,
  validateRedisNamespaceProcess,
  verificationRedisContainer,
} from "./redis-attestation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const allowed = new Set(["--isolated-verification", "--minutes", "--idle", "--allow-development"]);
for (let index = 0; index < args.length; index += 1) {
  assert(
    allowed.has(args[index]),
    "Unknown option; use --isolated-verification [--minutes 1..1440] [--idle] [--allow-development].",
  );
  if (args[index] === "--minutes") index += 1;
}
assert(args.includes("--isolated-verification"), "Require --isolated-verification; never monitor a personal instance.");
assert.equal(
  process.platform,
  "linux",
  "This /proc resource probe requires Linux; Windows measurements remain a separate gate.",
);
const minutes = args.includes("--minutes") ? Number(args[args.indexOf("--minutes") + 1]) : 480;
assert(Number.isFinite(minutes) && minutes >= 1 && minutes <= 1440, "--minutes must be between 1 and 1440.");
const idle = args.includes("--idle");
const origin = process.env.SHIVA_VERIFY_ORIGIN ?? "http://127.0.0.1:3000";
assert.equal(origin, "http://127.0.0.1:3000", "Only the fixed loopback verification instance is allowed.");
const fixtureDatabase = path.join(root, "artifacts/verification.sqlite");
assert.equal(
  await realpath(fixtureDatabase),
  fixtureDatabase,
  "Verification database must be the existing isolated fixture, without symlinks.",
);
const privateFile = async (name) => {
  const filename = path.join(root, "artifacts", name);
  assert.equal(await realpath(filename), filename, "Private verification artifacts must not be symlinks.");
  assert.equal(
    (await stat(filename)).mode & 0o077,
    0,
    "Private verification artifacts must have owner-only permissions.",
  );
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") throw error;
    // oxlint-disable-next-line eslint/preserve-caught-error -- a JSON parser cause can contain private credential bytes
    throw new Error("The private verification artifact is invalid; its contents were not printed.");
  }
};
const credentials = await privateFile("verification-credentials.json");
assert(credentials.username === "shiva-verification", "Only the isolated synthetic account is allowed.");
assert(
  typeof credentials.password === "string" && credentials.password.length >= 20,
  "The private fixture credentials are invalid.",
);

class SocketOwnerUnavailableError extends Error {}
async function listeningPid(port) {
  const rows = (await readFile("/proc/net/tcp", "utf8"))
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/));
  const socket = rows.find(
    (fields) => fields[1]?.endsWith(`:${port.toString(16).toUpperCase().padStart(4, "0")}`) && fields[3] === "0A",
  );
  assert(socket, "The verification application must already be running on loopback.");
  assert(socket[1].startsWith("0100007F:"), "The verification service must bind only to 127.0.0.1.");
  for (const pid of (await readdir("/proc")).filter((entry) => /^\d+$/.test(entry))) {
    try {
      for (const fd of await readdir(`/proc/${pid}/fd`)) {
        if ((await readlink(`/proc/${pid}/fd/${fd}`).catch(() => "")) === `socket:[${socket[9]}]`) return Number(pid);
      }
    } catch {
      /* Other users' /proc entries are not inspected. */
    }
  }
  throw new SocketOwnerUnavailableError("The local service process could not be verified.");
}
const appPid = await listeningPid(3000);
assert.equal(
  path.basename(await readlink(`/proc/${appPid}/exe`)),
  "node",
  "The fixture listener must be the Node application.",
);
// Read only for assertions. Never emit environment values, command arguments or cookies.
const environment = new Map(
  (await readFile(`/proc/${appPid}/environ`, "utf8"))
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("=");
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
);
assert(
  path.resolve(environment.get("DB_URL") ?? ".") === fixtureDatabase,
  "The running server must use artifacts/verification.sqlite.",
);
const production = environment.get("NODE_ENV") === "production";
assert(
  production || args.includes("--allow-development"),
  "Use a production server; --allow-development permits diagnostic runs only.",
);
const redisPort = Number(environment.get("REDIS_PORT") ?? "6379");
assert(
  ["127.0.0.1", "localhost"].includes(environment.get("REDIS_HOST") ?? "localhost"),
  "Resource qualification requires local Redis.",
);
const runFile = promisify(execFile);
let redisPid;
let redisAttribution = { method: "Linux loopback socket inode and /proc executable", fdInspectionAvailable: true };
try {
  redisPid = await listeningPid(redisPort);
  assert(
    path.basename(await readlink(`/proc/${redisPid}/exe`)).startsWith("redis-server"),
    "The local Redis listener could not be verified.",
  );
} catch (error) {
  assert(
    error instanceof SocketOwnerUnavailableError || ["EACCES", "EPERM"].includes(error.code),
    "Redis identity verification failed; Docker fallback cannot bypass an identity mismatch.",
  );
  const inspected = JSON.parse(
    (await runFile("docker", ["inspect", verificationRedisContainer], { maxBuffer: 1024 * 1024 })).stdout,
  );
  assert(
    Array.isArray(inspected) && inspected.length === 1,
    "Redis Docker inspection must identify one exact container.",
  );
  const identity = validateRedisDockerInspection(inspected[0], redisPort);
  redisPid = identity.pid;
  const [status, comm, info] = await Promise.all([
    readFile(`/proc/${redisPid}/status`, "utf8"),
    readFile(`/proc/${redisPid}/comm`, "utf8"),
    runFile("docker", ["exec", verificationRedisContainer, "redis-cli", "--raw", "INFO", "server"], {
      maxBuffer: 64 * 1024,
    }).then((result) => result.stdout),
  ]);
  const namespacePid = validateRedisNamespaceProcess(status, comm, info, redisPid);
  redisAttribution = {
    ...identity,
    namespacePid,
    method:
      "Read-only Docker name/image/compose-label/PID/sole-loopback-binding attestation plus Redis INFO namespace PID and readable /proc comm/stat/status",
    fdInspectionAvailable: false,
    limitation:
      "Redis exe/fd symlinks are unavailable to this UID; Redis-owned external sockets cannot be inspected. Application socket snapshots remain active.",
  };
}
const redisStartTime = (await readFile(`/proc/${redisPid}/stat`, "utf8")).split(") ").at(-1).split(/\s+/)[19];
const ticksPerSecond = Number((await promisify(execFile)("getconf", ["CLK_TCK"])).stdout.trim());
assert(Number.isFinite(ticksPerSecond) && ticksPerSecond > 0, "The Linux CPU clock rate is unavailable.");
let quotaCores = null;
try {
  const [quota, period] = (await readFile("/sys/fs/cgroup/cpu.max", "utf8")).trim().split(/\s+/);
  if (quota !== "max") quotaCores = Number(quota) / Number(period);
} catch {
  /* Report cpuset capacity when cgroup CPU quota is unavailable. */
}
const capacityCores = Math.min(os.availableParallelism(), quotaCores ?? Infinity);
assert(capacityCores > 0, "CPU capacity could not be determined.");
const output = path.join(root, "artifacts/soak");
await mkdir(output, { recursive: true, mode: 0o700 });
await chmod(output, 0o700);
const reportFile = path.join(
  output,
  `${idle ? "idle" : "cycle"}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.json`,
);
const report = {
  startedAt: new Date().toISOString(),
  requestedMinutes: minutes,
  mode: idle ? "idle" : "cycles",
  production,
  environment: {
    platform: process.platform,
    node: process.version,
    availableCores: os.availableParallelism(),
    quotaCores,
    capacityCores,
    ticksPerSecond,
  },
  redisAttribution,
  method: {
    sampleSeconds: 15,
    cycleSeconds: idle ? null : 60,
    memory:
      "Summed /proc RSS; shared pages may be counted more than once. Chromium process-tree RSS is separate, not tab JS heap or Windows/WSL overhead.",
    cpu: "Delta process utime+stime / CLK_TCK / elapsed wall time; normalized to the smaller of cpuset cores and cgroup quota.",
    network:
      "Browser HTTP/WebSocket origin interception, explicit read-only API probes, and application established TCP socket snapshots every 15 seconds; Redis snapshots only when its fd directory is readable (see redisAttribution). Short-lived server requests and UDP/DNS packets can occur between snapshots and are not a packet-capture guarantee.",
    qualification:
      "Short runs are diagnostics only; this script does not establish field metrics, Windows or Android performance.",
    browserProfile:
      "Headless 1440x1000 Chromium, blocked service workers, guarded network interception (HTTP cache disabled by Playwright). In-app route caches can still warm. Timing distributions describe this controlled soak profile, not a normal browser field session.",
  },
  resources: {
    samples: 0,
    appRedisPeakMiB: 0,
    browserPeakMiB: 0,
    appCpuCapacityPercentMax: 0,
    appCpuCapacityPercentMean: 0,
  },
  counters: {
    cycles: 0,
    healthSuccess: 0,
    apiSuccess: 0,
    browserRequests: 0,
    blockedExternal: 0,
    blockedMutations: 0,
    pageErrors: 0,
    consoleErrors: 0,
    externalServerSocketSnapshots: 0,
  },
  minuteBuckets: [],
  timings: {},
  failure: null,
  completed: false,
  eightHourSessionCompleted: false,
};
const timingSamples = new Map();
const cpuPrevious = new Map();
let previousSampleTime = performance.now();
let cpuSum = 0;
let cpuSamples = 0;
let browser;
let context;
let authenticated = false;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    interrupted = true;
  });
const flush = async () => {
  for (const [name, values] of timingSamples) {
    const sorted = values.toSorted((a, b) => a - b);
    report.timings[name] = {
      count: values.length,
      p50Ms: sorted[Math.floor((sorted.length - 1) * 0.5)],
      p95Ms: sorted[Math.floor((sorted.length - 1) * 0.95)],
      maxMs: sorted.at(-1),
    };
  }
  await writeFile(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 });
};
const timed = async (name, action) => {
  const started = performance.now();
  const result = await action();
  const values = timingSamples.get(name) ?? [];
  if (values.length < 2048) values.push(Math.round(performance.now() - started));
  timingSamples.set(name, values);
  return result;
};
function sameOrigin(url) {
  const target = new URL(url);
  return (
    target.origin === origin ||
    (target.protocol === "ws:" && target.hostname === "127.0.0.1" && ["3000", "3001"].includes(target.port))
  );
}
async function processRows() {
  const rows = [];
  await Promise.all(
    (await readdir("/proc"))
      .filter((entry) => /^\d+$/.test(entry))
      .map(async (pid) => {
        try {
          const fields = (await readFile(`/proc/${pid}/stat`, "utf8")).split(") ").at(-1).split(/\s+/);
          let executable;
          try {
            executable = path.basename(await readlink(`/proc/${pid}/exe`));
          } catch (error) {
            if (
              Number(pid) !== redisPid ||
              redisAttribution.fdInspectionAvailable ||
              !["EACCES", "EPERM"].includes(error.code)
            )
              throw error;
            assert(
              (await readFile(`/proc/${pid}/comm`, "utf8")).trim() === "redis-server" && fields[19] === redisStartTime,
              "The attested Redis process changed.",
            );
            executable = "redis-server";
          }
          rows.push({
            pid: Number(pid),
            parent: Number(fields[1]),
            start: fields[19],
            ticks: Number(fields[11]) + Number(fields[12]),
            rssMiB:
              Number((await readFile(`/proc/${pid}/status`, "utf8")).match(/^VmRSS:\s+(\d+)/m)?.[1] ?? "0") / 1024,
            executable,
          });
        } catch {
          /* A process can exit between reads. */
        }
      }),
  );
  return rows;
}
function descendsFrom(row, ancestor, rows) {
  const visited = new Set();
  while (row && !visited.has(row.pid)) {
    if (row.pid === ancestor) return true;
    visited.add(row.pid);
    row = rows.find((candidate) => candidate.pid === row.parent);
  }
  return false;
}
async function sampleResources(elapsedMinutes) {
  const rows = await processRows();
  assert(
    rows.some((row) => row.pid === appPid),
    "The application process exited during monitoring.",
  );
  assert(
    rows.some((row) => row.pid === redisPid),
    "Redis exited during monitoring.",
  );
  const appRows = rows.filter(
    (row) => row.pid === redisPid || (row.executable === "node" && descendsFrom(row, appPid, rows)),
  );
  const browserRows = rows.filter(
    (row) => /^(chromium|chrome)/.test(row.executable) && descendsFrom(row, process.pid, rows),
  );
  // Select socket ownership, then inspect only addresses; never inspect HTTP bodies or emit endpoints.
  const socketIds = new Set();
  await Promise.all(
    appRows.map(async (row) => {
      try {
        for (const fd of await readdir(`/proc/${row.pid}/fd`)) {
          const link = await readlink(`/proc/${row.pid}/fd/${fd}`).catch(() => "");
          const inode = /^socket:\[(\d+)\]$/.exec(link)?.[1];
          if (inode) socketIds.add(inode);
        }
      } catch {
        /* A worker can exit during the sample. */
      }
    }),
  );
  const socketRows = (
    await Promise.all(
      ["tcp", "tcp6"].map(async (protocol) => {
        try {
          return (await readFile(`/proc/net/${protocol}`, "utf8"))
            .trim()
            .split("\n")
            .slice(1)
            .map((line) => line.trim().split(/\s+/));
        } catch {
          return [];
        }
      }),
    )
  ).flat();
  const externalSocket = socketRows.some((fields) => {
    if (fields[3] !== "01" || !socketIds.has(fields[9])) return false;
    const address = fields[2].split(":")[0];
    return !(
      /^[0-9A-F]{6}7F$/.test(address) ||
      address === "00000000000000000000000001000000" ||
      /^0000000000000000FFFF0000[0-9A-F]{6}7F$/.test(address)
    );
  });
  if (externalSocket) report.counters.externalServerSocketSnapshots += 1;
  assert(!externalSocket, "An application or Redis external TCP connection was observed.");
  const now = performance.now();
  let deltaTicks = 0;
  for (const row of appRows) {
    const key = `${row.pid}:${row.start}`;
    const previous = cpuPrevious.get(key);
    if (previous !== undefined) deltaTicks += Math.max(0, row.ticks - previous);
    cpuPrevious.set(key, row.ticks);
  }
  const activeKeys = new Set(appRows.map((row) => `${row.pid}:${row.start}`));
  for (const key of cpuPrevious.keys()) if (!activeKeys.has(key)) cpuPrevious.delete(key);
  const cpu = (deltaTicks / ticksPerSecond / ((now - previousSampleTime) / 1000) / capacityCores) * 100;
  const hasPrevious = report.resources.samples > 0;
  previousSampleTime = now;
  if (hasPrevious) {
    cpuSum += cpu;
    cpuSamples += 1;
  }
  const appMemory = appRows.reduce((total, row) => total + row.rssMiB, 0);
  const browserMemory = browserRows.reduce((total, row) => total + row.rssMiB, 0);
  report.resources.samples += 1;
  report.resources.appRedisPeakMiB = Math.max(report.resources.appRedisPeakMiB, appMemory);
  report.resources.browserPeakMiB = Math.max(report.resources.browserPeakMiB, browserMemory);
  report.resources.appCpuCapacityPercentMax = Math.max(report.resources.appCpuCapacityPercentMax, cpu);
  report.resources.appCpuCapacityPercentMean = cpuSamples ? cpuSum / cpuSamples : 0;
  const minute = Math.floor(elapsedMinutes);
  const last = report.minuteBuckets.at(-1);
  if (!last || last.minute !== minute) {
    // Keep a bounded, decimated trend history rather than an unbounded event log.
    if (report.minuteBuckets.length >= 512)
      report.minuteBuckets = report.minuteBuckets.filter((_, index) => index % 2 === 0);
    report.minuteBuckets.push({ minute, appRedisMiB: appMemory, browserMiB: browserMemory, cpuCapacityPercent: cpu });
  }
}
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function readApi(procedure) {
  const response = await context.request.get(`${origin}/api/trpc/shiva.${procedure}`, {
    timeout: 15000,
    maxRedirects: 0,
  });
  assert(response.ok(), "A protected read-only SHIVA API probe failed.");
  const bytes = await response.body();
  assert(bytes.byteLength <= 64 * 1024, "A bounded API probe exceeded its response budget.");
  const json = JSON.parse(bytes.toString("utf8"));
  assert(json.result?.data?.json, "A protected API probe returned an unexpected envelope.");
  report.counters.apiSuccess += 1;
  return json.result.data.json;
}
async function cycle(page) {
  const open = async (route) => {
    const link = page.locator(`.shiva-sidebar .shiva-nav-link[href="${route}"]`);
    assert.equal(await link.count(), 1, "Each tested route must have one intended sidebar navigation link.");
    if (await link.isVisible()) await link.click();
    else await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#shiva-theme-root")).toBeVisible();
    const heading = {
      "/shiva/shopping": { name: "Shopping", level: 1 },
      "/shiva/settings/appearance": { name: "Appearance", level: 2 },
      "/shiva": { name: "Today, at a glance", level: 1 },
    }[route];
    await expect(page.getByRole("heading", { ...heading, exact: true })).toBeVisible();
  };
  await timed("shoppingNavigation", () => open("/shiva/shopping"));
  await timed("dialogOpenCancel", async () => {
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add shopping item", exact: true });
    await expect(dialog).toBeVisible();
    // Match the verified accessible name; Mantine's required marker is present in label text.
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Unsaved soak fixture");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
  });
  await timed("appearanceNavigation", () => open("/shiva/settings/appearance"));
  await timed("previewCancel", async () => {
    const originalName = await page.getByLabel("Theme name", { exact: true }).inputValue();
    const name = ["Graphite", "Ivory", "Midnight Glass"][report.counters.cycles % 3];
    await page.getByRole("button", { name: `Preview ${name}`, exact: true }).click();
    await expect(page.getByLabel("Theme name", { exact: true })).toHaveValue(name);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByLabel("Theme name", { exact: true })).toHaveValue(originalName);
  });
  await timed("homeNavigation", () => open("/shiva"));
  report.counters.cycles += 1;
}

try {
  let storage;
  try {
    storage = await privateFile("verification-storage.json");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (storage) {
    assert(
      storage.cookies.every((cookie) => ["127.0.0.1", ".127.0.0.1"].includes(cookie.domain)),
      "Stored session must belong only to the local fixture.",
    );
    assert(
      storage.origins.every((entry) => entry.origin === origin),
      "Stored browser data must belong only to the local fixture.",
    );
  }
  browser = await chromium.launch({
    executablePath: process.env.SHIVA_CHROMIUM_PATH ?? "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  context = await browser.newContext({
    ...(storage ? { storageState: storage } : {}),
    viewport: { width: 1440, height: 1000 },
    timezoneId: "Asia/Kolkata",
    locale: "en-IN",
    serviceWorkers: "block",
  });
  context.setDefaultTimeout(15000);
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (!sameOrigin(request.url())) {
      report.counters.blockedExternal += 1;
      await route.abort();
      return;
    }
    report.counters.browserRequests += 1;
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method()) &&
      (authenticated || !new URL(request.url()).pathname.startsWith("/api/auth/"))
    ) {
      report.counters.blockedMutations += 1;
      await route.abort();
      return;
    }
    await route.continue();
  });
  await context.routeWebSocket("**/*", (socket) => {
    if (sameOrigin(socket.url())) socket.connectToServer();
    else {
      report.counters.blockedExternal += 1;
      socket.close();
    }
  });
  const page = await context.newPage();
  page.on("pageerror", () => {
    report.counters.pageErrors += 1;
  });
  page.on("console", (message) => {
    if (message.type() === "error") report.counters.consoleErrors += 1;
  });
  const session = await context.request.get(`${origin}/api/auth/session`, { maxRedirects: 0 });
  if (!session.ok() || (await session.json()).user?.name !== credentials.username) {
    await page.goto(`${origin}/auth/login?callbackUrl=%2Fshiva`, { waitUntil: "domcontentloaded" });
    await page.locator("#username").fill(credentials.username);
    await page.locator("#password").fill(credentials.password);
    await page.locator('button[type="submit"][value="credentials"]').click();
  } else await page.goto(`${origin}/shiva`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#shiva-theme-root")).toBeVisible({ timeout: 60000 });
  const verifiedSession = await context.request.get(`${origin}/api/auth/session`, { maxRedirects: 0 });
  assert(
    (await verifiedSession.json()).user?.name === credentials.username,
    "Only the synthetic verification account can run this monitor.",
  );
  authenticated = true;
  const initialSettings = digest(await readApi("settings"));
  const initialSummary = await readApi("shoppingSummary");
  const initialSummaryDigest = digest(initialSummary);
  report.syntheticShoppingCount = initialSummary.total;
  const started = performance.now();
  const deadline = started + minutes * 60_000;
  let nextCycle = started;
  while (performance.now() < deadline) {
    if (interrupted) break;
    if (!idle && performance.now() >= nextCycle) {
      await cycle(page);
      nextCycle += 60_000;
    }
    const health = await context.request.get(`${origin}/api/health/ready`, { timeout: 15000, maxRedirects: 0 });
    assert.equal(health.status(), 200, "The local readiness probe failed.");
    report.counters.healthSuccess += 1;
    assert.equal(
      digest(await readApi("settings")),
      initialSettings,
      "Appearance changed during a preview/cancel-only monitor.",
    );
    assert.equal(
      digest(await readApi("shoppingSummary")),
      initialSummaryDigest,
      "Shopping counters changed during the read-only monitor.",
    );
    assert.equal(report.counters.blockedExternal, 0, "An external browser connection was attempted.");
    assert.equal(
      report.counters.blockedMutations,
      0,
      "The UI attempted a persisted mutation during preview/cancel-only monitoring.",
    );
    assert.equal(report.counters.pageErrors, 0, "A browser runtime exception occurred.");
    await sampleResources((performance.now() - started) / 60_000);
    report.elapsedMinutes = (performance.now() - started) / 60_000;
    await flush();
    await new Promise((resolve) => setTimeout(resolve, Math.min(15000, Math.max(0, deadline - performance.now()))));
  }
  report.elapsedMinutes = (performance.now() - started) / 60_000;
  report.initialFinalRecordsUnchanged =
    digest(await readApi("settings")) === initialSettings &&
    digest(await readApi("shoppingSummary")) === initialSummaryDigest;
  assert(report.initialFinalRecordsUnchanged, "Persisted verification records changed during monitoring.");
  report.completed = !interrupted;
  if (interrupted) process.exitCode = 130;
  report.eightHourSessionCompleted = !idle && production && report.completed && report.elapsedMinutes >= 480;
  report.resourceObservations = {
    applicationPeakWithin2GiB: report.resources.appRedisPeakMiB <= 2048,
    idleMeanCpuWithin2Percent: idle && minutes >= 5 ? report.resources.appCpuCapacityPercentMean <= 2 : null,
    browserProcessTreeWithin500MiB: report.resources.browserPeakMiB <= 500,
  };
} catch (error) {
  report.completed = false;
  report.eightHourSessionCompleted = false;
  // Never serialize arbitrary API, browser, environment or credential-bearing error text.
  report.failure = {
    type: error?.name ?? "Error",
    message:
      "Verification stopped; inspect the fixed guards, local readiness, UI assertions and bounded counters. No raw credentials or page content were recorded.",
  };
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await browser?.close();
  await flush();
  console.log(`Private ${report.completed ? "completed" : "incomplete"} report: ${path.relative(root, reportFile)}`);
  console.log(
    report.eightHourSessionCompleted
      ? "Eight-hour Linux session completed; review resource trends and remaining platform gates."
      : "Diagnostic duration only; the eight-hour stability gate remains unverified.",
  );
}
