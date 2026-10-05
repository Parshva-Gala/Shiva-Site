// @vitest-environment node
import { expect, test, vi } from "vitest";

vi.mock("./db/env", () => ({ dbEnv: { DRIVER: "better-sqlite3", URL: ":memory:" } }));

import { withShivaAssetOwnerLock } from "./shiva-assets";

test("serializes an owner's reference writes with deletion and releases failures without blocking other owners", async () => {
  const started = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  let secondStarted = false;
  const first = withShivaAssetOwnerLock("first-owner", async () => {
    started.resolve();
    await gate.promise;
  });
  await started.promise;
  const second = withShivaAssetOwnerLock("first-owner", () => {
    secondStarted = true;
    return Promise.resolve();
  });
  await withShivaAssetOwnerLock("another-owner", () => Promise.resolve());
  expect(secondStarted).toBe(false);
  gate.resolve();
  await Promise.all([first, second]);
  expect(secondStarted).toBe(true);
  await expect(
    withShivaAssetOwnerLock("first-owner", () => Promise.reject(new Error("failed mutation"))),
  ).rejects.toThrow("failed mutation");
  await expect(withShivaAssetOwnerLock("first-owner", () => Promise.resolve("recovered"))).resolves.toBe("recovered");
});
