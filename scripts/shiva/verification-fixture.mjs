// SHIVA extension, Apache-2.0. Shared guards for private, synthetic localhost verification.
import assert from "node:assert/strict";
import { readFile, readdir, readlink, realpath, stat } from "node:fs/promises";
import path from "node:path";

export function assertVerificationCredentials(value) {
  assert(value && typeof value === "object" && !Array.isArray(value), "Private verification credentials are invalid.");
  assert(value.username === "shiva-verification", "Only the synthetic verification account is allowed.");
  assert(
    typeof value.password === "string" && value.password.length >= 40,
    "Require the generated private verification password.",
  );
  return value;
}

export async function readVerificationCredentials(root) {
  const filename = path.join(root, "artifacts/verification-credentials.json");
  assert((await realpath(filename)) === filename, "Private verification credentials must not be a symlink.");
  if (process.platform !== "win32") {
    assert(((await stat(filename)).mode & 0o077) === 0, "Verification credentials must have owner-only permissions.");
  }
  let value;
  try {
    value = JSON.parse(await readFile(filename, "utf8"));
  } catch {
    // JSON parser errors can include private input. Do not attach their causes or echo their messages.
    throw new Error("Private verification credentials are missing or invalid; contents were not printed.");
  }
  return assertVerificationCredentials(value);
}

export async function assertVerificationRuntime(root) {
  if (process.platform !== "linux") {
    return {
      checked: false,
      scope: "Linux process identity probe unavailable; synthetic session guard still applies.",
    };
  }
  const rows = (await readFile("/proc/net/tcp", "utf8"))
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(/\s+/));
  const listeners = rows.filter((row) => row[1]?.endsWith(":0BB8") && row[3] === "0A");
  assert(
    listeners.length === 1 && listeners[0][1] === "0100007F:0BB8",
    "The fixture must listen only on 127.0.0.1:3000.",
  );
  const socket = `socket:[${listeners[0][9]}]`;
  let listenerPid;
  for (const pid of (await readdir("/proc")).filter((entry) => /^\d+$/.test(entry))) {
    let descriptors;
    try {
      descriptors = await readdir(`/proc/${pid}/fd`);
    } catch {
      continue;
    }
    for (const descriptor of descriptors) {
      if ((await readlink(`/proc/${pid}/fd/${descriptor}`).catch(() => "")) === socket) {
        listenerPid = pid;
        break;
      }
    }
    if (listenerPid) break;
  }
  assert(listenerPid, "The localhost fixture process could not be identified.");
  assert(
    ["node", "nodejs"].includes(path.basename(await readlink(`/proc/${listenerPid}/exe`))),
    "The fixture listener must be Node.",
  );
  // Read process environment only for identity assertions. Never expose values, command lines, or cookies.
  const environment = new Map(
    (await readFile(`/proc/${listenerPid}/environ`, "utf8"))
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("=");
        return [entry.slice(0, separator), entry.slice(separator + 1)];
      }),
  );
  const database = path.join(root, "artifacts/verification.sqlite");
  assert(
    path.resolve(environment.get("DB_URL") ?? ".") === database,
    "The running server must use the isolated verification database.",
  );
  assert((await realpath(database)) === database, "The fixture database must not be a symlink.");
  assert(environment.get("NODE_ENV") === "production", "Use the built production verification instance.");
  return { checked: true, loopbackOnly: true, isolatedDatabase: true, production: true };
}
