import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { OnboardingWordmark } from "./onboarding-wordmark";

afterEach(() => vi.unstubAllEnvs());

describe("fresh onboarding wordmark privacy", () => {
  test("renders the local SHIVA asset without CDN requests for an unconfigured local welcome", () => {
    vi.stubEnv("SHIVA_LOCAL_WEBSOCKET", "true");
    const html = renderToStaticMarkup(<OnboardingWordmark large />);
    expect(html).toContain('src="/shiva/logo.svg"');
    expect(html).toContain('aria-label="SHIVA"');
    expect(html).not.toContain("cdn.jsdelivr.net");
  });

  test("keeps explicit saved branding in local source mode", () => {
    vi.stubEnv("SHIVA_LOCAL_WEBSOCKET", "true");
    const html = renderToStaticMarkup(
      <OnboardingWordmark appName="Personal" logoImageUrl="/personal.svg" showAppName showAppLogo />,
    );
    expect(html).toContain('src="/personal.svg"');
    expect(html).toContain("<span>Personal</span>");
    expect(html).not.toContain("SHIVA");
  });

  test("respects saved logo and name visibility choices", () => {
    vi.stubEnv("SHIVA_LOCAL_WEBSOCKET", "true");
    expect(
      renderToStaticMarkup(<OnboardingWordmark appName="Personal" showAppName={false} showAppLogo={false} />),
    ).toBe("");
  });

  test("preserves upstream welcome behavior outside local source mode", () => {
    vi.stubEnv("SHIVA_LOCAL_WEBSOCKET", undefined);
    const html = renderToStaticMarkup(<OnboardingWordmark large />);
    expect(html).toContain("cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/homarr-wordmark-light.svg");
    expect(html).toContain('alt="Homarr"');
    expect(html).not.toContain("SHIVA");
  });
});
