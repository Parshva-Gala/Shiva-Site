// SHIVA, Apache-2.0. Read-only metadata proof for the exact local verification Redis container.
import assert from "node:assert/strict";

export const verificationRedisContainer = "shiva-local-redis-1";
export function validateRedisDockerInspection(container, port = 6379) {
  assert(port === 6379, "Docker Redis attestation only supports the fixed verification port.");
  assert(container?.Name === `/${verificationRedisContainer}`, "Redis container identity mismatch.");
  assert(
    container?.State?.Running === true && container?.State?.Status === "running",
    "Redis container is not running.",
  );
  assert(Number.isSafeInteger(container.State.Pid) && container.State.Pid > 0, "Redis container PID is invalid.");
  assert(container?.Config?.Image === "redis:8.2.2-alpine", "Redis container image mismatch.");
  assert(
    container?.Config?.Labels?.["com.docker.compose.project"] === "shiva-local",
    "Redis compose project mismatch.",
  );
  assert(container?.Config?.Labels?.["com.docker.compose.service"] === "redis", "Redis compose service mismatch.");
  assert(
    JSON.stringify(container.Config.Cmd) === JSON.stringify(["redis-server", "--save", "", "--appendonly", "no"]),
    "Redis container command mismatch.",
  );
  for (const ports of [container?.NetworkSettings?.Ports, container?.HostConfig?.PortBindings]) {
    assert(
      ports && Object.keys(ports).length === 1 && Object.keys(ports)[0] === "6379/tcp",
      "Redis container must expose only the expected TCP port.",
    );
    const binding = ports["6379/tcp"];
    assert(
      Array.isArray(binding) &&
        binding.length === 1 &&
        binding[0]?.HostIp === "127.0.0.1" &&
        binding[0]?.HostPort === "6379",
      "Redis binding must be exclusively IPv4 loopback.",
    );
  }
  assert(/^sha256:[a-f0-9]{64}$/.test(container.Image ?? ""), "Redis image identity is invalid.");
  assert(/^[a-f0-9]{64}$/.test(container.Id ?? ""), "Redis container ID is invalid.");
  return {
    pid: container.State.Pid,
    container: verificationRedisContainer,
    image: "redis:8.2.2-alpine",
    project: "shiva-local",
    service: "redis",
  };
}

export function validateRedisNamespaceProcess(status, comm, info, hostPid) {
  assert(comm.trim() === "redis-server", "The attested Redis host process name changed.");
  const namespacePids = status
    .match(/^NSpid:\s+(.+)$/m)?.[1]
    ?.trim()
    .split(/\s+/)
    .map(Number);
  assert(
    namespacePids?.length >= 2 && namespacePids[0] === hostPid,
    "Redis PID namespace identity could not be verified.",
  );
  const infoPid = Number(info.match(/^process_id:(\d+)\r?$/m)?.[1]);
  assert(
    Number.isSafeInteger(infoPid) && infoPid > 0 && infoPid === namespacePids.at(-1),
    "Redis INFO PID does not match the attested container namespace.",
  );
  return infoPid;
}
