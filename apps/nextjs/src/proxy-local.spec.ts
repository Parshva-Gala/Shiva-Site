// @vitest-environment node
import { NextRequest, NextResponse } from "next/server.js";
import { afterEach, describe, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function sourceConfig(local: boolean) {
  vi.stubEnv("SKIP_ENV_VALIDATION", "true");
  vi.stubEnv("SHIVA_LOCAL_WEBSOCKET", local ? "true" : "false");
  const { default: config } = await import("../next.config");
  // Next compiles this option into its request adapter and NextRequest class.
  vi.stubEnv("__NEXT_NO_MIDDLEWARE_URL_NORMALIZE", config.skipProxyUrlNormalize ? "true" : undefined);
  return config;
}

describe("Source startup locale rewrites", () => {
  test("keeps the login locale rewrite on the bound loopback origin", async () => {
    const config = await sourceConfig(true);
    expect(config.skipProxyUrlNormalize).toBe(true);
    const origin = "http://127.0.0.1:3000";
    const request = new NextRequest(`${origin}/auth/login?callbackUrl=%2Fshiva`);
    // next-intl uses this NextResponse API with a rewrite URL derived from request.url.
    const response = NextResponse.rewrite(
      new URL(`/en${request.nextUrl.pathname}${request.nextUrl.search}`, request.url),
    );
    const rewrite = new URL(response.headers.get("x-middleware-rewrite") ?? "");
    expect(rewrite.origin).toBe(origin);
    expect(rewrite.pathname).toBe("/en/auth/login");
    expect(rewrite.searchParams.get("callbackUrl")).toBe("/shiva");
  });

  test("preserves normal URL handling for an upstream HTTPS deployment", async () => {
    const config = await sourceConfig(false);
    expect(config.skipProxyUrlNormalize).toBe(false);
    const origin = "https://dashboard.example.com";
    const request = new NextRequest(`${origin}/auth/login`);
    const response = NextResponse.rewrite(new URL(`/en${request.nextUrl.pathname}`, request.url));
    expect(new URL(response.headers.get("x-middleware-rewrite") ?? "").origin).toBe(origin);
  });
});
