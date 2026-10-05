#!/usr/bin/env node
// SHIVA local startup wrapper. Keep secrets in .env and bind services to loopback.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const action = process.argv[2];
const supportedActions = new Set(["init", "dev", "build", "start"]);

function checkNodeVersion() {
  const current = process.versions.node.split(".").map(Number);
  const minimum = [24, 18, 0];
  for (let index = 0; index < minimum.length; index++) {
    if (current[index] > minimum[index]) return;
    if (current[index] < minimum[index]) {
      throw new Error("SHIVA requires Node.js 24.18.0 or newer. Check node --version.");
    }
  }
}

function initialize() {
  if (existsSync(envPath)) {
    console.log("Existing .env preserved. No configuration or secrets were changed.");
    return;
  }

  const dbDirectory = join(root, "data", "db");
  mkdirSync(dbDirectory, { recursive: true });
  // Forward slashes avoid dotenv escape processing on Windows paths.
  const dbUrl = join(dbDirectory, "db.sqlite").replaceAll("\\", "/");
  const content = [
    "# Generated locally by scripts/shiva.mjs. Do not commit or share this file.",
    `AUTH_SECRET=${randomBytes(32).toString("hex")}`,
    `SECRET_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`,
    "AUTH_PROVIDERS=credentials",
    "DB_DRIVER=better-sqlite3",
    `DB_URL=${JSON.stringify(dbUrl)}`,
    "BASE_URL=http://127.0.0.1:3000",
    "REDIS_IS_EXTERNAL=true",
    "REDIS_HOST=127.0.0.1",
    "REDIS_PORT=6379",
    "LOG_LEVEL=info",
    "NO_EXTERNAL_CONNECTION=true",
    "ENABLE_DOCKER=false",
    "ENABLE_KUBERNETES=false",
    "UNSAFE_ENABLE_MOCK_INTEGRATION=false",
    "DEMO_MODE=false",
    "TURBO_TELEMETRY_DISABLED=1",
    "NEXT_TELEMETRY_DISABLED=1",
    "SHIVA_WEBSOCKET_HOST=127.0.0.1",
    "TZ=Asia/Kolkata",
    "",
  ].join("\n");
  // Exclusive create also prevents overwriting a file created concurrently.
  try {
    writeFileSync(envPath, content, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code === "EEXIST") {
      console.log("Existing .env preserved. No configuration or secrets were changed.");
      return;
    }
    throw error;
  }
  console.log("Created local .env with fresh secrets and an absolute data/db/db.sqlite path.");
  console.log("Apply SQLite migrations and start localhost Redis before running SHIVA.");
}

function pnpmCommand() {
  if (process.platform !== "win32") return { executable: "pnpm", prefix: [] };

  // .cmd requires a shell on Windows. Run the npm/Corepack JavaScript entrypoint
  // directly instead, keeping every argument separate from executable code.
  const directories = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  if (process.env.PNPM_HOME) directories.unshift(process.env.PNPM_HOME);
  directories.push(dirname(process.execPath));
  for (const directory of directories) {
    const executable = join(directory, "pnpm.exe");
    if (existsSync(executable)) return { executable, prefix: [] };
    for (const relative of ["node_modules/pnpm/bin/pnpm.cjs", "node_modules/corepack/dist/pnpm.js"]) {
      const entrypoint = join(directory, relative);
      if (existsSync(entrypoint)) return { executable: process.execPath, prefix: [entrypoint] };
    }
  }
  throw new Error("pnpm was not found. Install it with npm install --global pnpm@11.15.1, then reopen PowerShell.");
}

function buildNodeOptions() {
  const options = process.env.NODE_OPTIONS ?? "";
  const hasHeapLimit = /(?:^|\s|")--max[-_]old[-_]space[-_]size(?:[-_]percentage)?(?:=|\s|"|$)/u.test(options);
  return hasHeapLimit ? options : `${options} --max-old-space-size=6144`.trim();
}

function run() {
  if (!existsSync(envPath)) throw new Error("Missing .env. Run node scripts/shiva.mjs init first.");
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const command = pnpmCommand();
  const nextArguments = [action];
  // The full upstream graph can exhaust a 16 GB machine under Turbopack.
  // Use Next's supported webpack backend for this local source build.
  if (action === "build") nextArguments.push("--webpack");
  if (action === "dev" || action === "start") nextArguments.push("--hostname", "127.0.0.1", "--port", "3000");

  const child = spawn(
    command.executable,
    [
      ...command.prefix,
      "--dir",
      join(root, "apps", "nextjs"),
      "exec",
      "dotenv",
      "-e",
      envPath,
      "--",
      "next",
      ...nextArguments,
    ],
    {
      cwd: root,
      shell: false,
      stdio: "inherit",
      env: {
        ...process.env,
        HOMARR_VERSION: packageJson.version,
        SHIVA_WEBSOCKET_HOST: "127.0.0.1",
        SHIVA_LOCAL_WEBSOCKET: "true",
        TURBO_TELEMETRY_DISABLED: "1",
        NEXT_TELEMETRY_DISABLED: "1",
        ...(action === "build" ? { CI: "true", NODE_OPTIONS: buildNodeOptions() } : {}),
      },
    },
  );
  child.on("error", (error) => {
    console.error(`Could not run pnpm (${error.code ?? "startup error"}). Check installation and PATH.`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
}

try {
  if (!supportedActions.has(action) || process.argv.length > 3) {
    throw new Error("Usage: node scripts/shiva.mjs <init|dev|build|start>");
  }
  checkNodeVersion();
  if (action === "init") initialize();
  else run();
} catch (error) {
  console.error(error instanceof Error ? error.message : "SHIVA startup failed.");
  process.exitCode = 1;
}
