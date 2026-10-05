import type { PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { useConfirmModal } from "@homarr/modals";
import { useRegisterSpotlightContextActions } from "@homarr/spotlight";

import { HostFeatureProviders } from "./host-features";
import { isShivaRoute } from "./native-route";
import { RouteFeatureProviders } from "./route-features";

const { route } = vi.hoisted(() => ({ route: { pathname: "/shiva" as string | null } }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("next/dynamic", () => ({
  default:
    () =>
    ({ children, availability }: PropsWithChildren<{ availability: string }>) => (
      <section data-lazy-host={availability}>{children}</section>
    ),
}));
vi.mock("~/components/assistant/assistant-gate", () => ({
  AssistantGate: ({ children, availability }: PropsWithChildren<{ availability: string }>) => (
    <section data-assistant={availability}>{children}</section>
  ),
}));

beforeEach(() => {
  route.pathname = "/shiva";
});

const HostConsumer = () => {
  const { openConfirmModal } = useConfirmModal();
  useRegisterSpotlightContextActions("provider-regression", [], []);
  expect(openConfirmModal).toBeTypeOf("function");
  return <main>Host contexts available</main>;
};

describe("native provider boundary", () => {
  test("recognizes only the native route segment, including supported locale prefixes", () => {
    for (const pathname of ["/shiva", "/shiva/shopping", "/en/shiva", "/de-CH/shiva/settings/appearance"])
      expect(isShivaRoute(pathname), pathname).toBe(true);
    for (const pathname of ["/", "/shiva-tools", "/boards/shiva", "/en/manage/shiva", "/unknown/shiva"])
      expect(isShivaRoute(pathname), pathname).toBe(false);
    expect(isShivaRoute(null)).toBe(false);
  });

  test("renders native children without legacy feature providers", () => {
    const html = renderToStaticMarkup(
      <RouteFeatureProviders availability="unconfigured">
        <main>Native dashboard</main>
      </RouteFeatureProviders>,
    );
    expect(html).toBe("<main>Native dashboard</main>");
  });

  test("preserves host children and assistant availability on host routes", () => {
    for (const pathname of ["/en/boards/personal", "/manage", "/auth/login", "/onboarding"]) {
      route.pathname = pathname;
      const html = renderToStaticMarkup(
        <RouteFeatureProviders availability="enabled">
          <main>Host dashboard</main>
        </RouteFeatureProviders>,
      );
      expect(html, pathname).toContain('data-lazy-host="enabled"');
      expect(html, pathname).toContain("Host dashboard");
    }
  });

  test("retains actual host modal and Spotlight contexts in the existing provider order", () => {
    const html = renderToStaticMarkup(
      <HostFeatureProviders availability="unconfigured">
        <HostConsumer />
      </HostFeatureProviders>,
    );
    expect(html).toContain('data-assistant="unconfigured"');
    expect(html).toContain("Host contexts available");
  });
});
