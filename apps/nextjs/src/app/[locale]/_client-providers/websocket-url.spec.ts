import { describe, expect, test } from "vitest";

import { getWebsocketUrl } from "./websocket-url";

describe("WebSocket URL for source and proxy startup", () => {
  test("preserves the session-cookie hostname during loopback source startup", () => {
    expect(
      getWebsocketUrl({
        location: { protocol: "http:", hostname: "127.0.0.1", port: "3000" },
        development: false,
        localSourceMode: true,
      }),
    ).toBe("ws://127.0.0.1:3001/websockets");
  });

  test("preserves same-origin secure proxy hosting without the source flag", () => {
    expect(
      getWebsocketUrl({
        location: { protocol: "https:", hostname: "dashboard.example.com", port: "" },
        development: false,
        localSourceMode: false,
      }),
    ).toBe("wss://dashboard.example.com/websockets");
  });

  test("source mode cannot redirect a remote deployment to its loopback service", () => {
    expect(
      getWebsocketUrl({
        location: { protocol: "https:", hostname: "dashboard.example.com", port: "8443" },
        development: false,
        localSourceMode: true,
      }),
    ).toBe("wss://dashboard.example.com:8443/websockets");
  });
});
