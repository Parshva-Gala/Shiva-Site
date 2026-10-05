import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, test, vi } from "vitest";

import { OnboardingBackdrop } from "./onboarding-backdrop";

afterEach(() => vi.unstubAllEnvs());

const renderBackdrop = () =>
  renderToStaticMarkup(
    <MantineProvider>
      <OnboardingBackdrop />
    </MantineProvider>,
  );

describe("local source onboarding privacy", () => {
  test("does not render decorative remote images in local source mode", () => {
    vi.stubEnv("SHIVA_LOCAL_WEBSOCKET", "true");
    const html = renderBackdrop();
    expect(html).not.toContain("<img");
    expect(html).not.toContain("cdn.jsdelivr.net");
  });

  test("keeps the upstream integration backdrop outside local source mode", () => {
    vi.stubEnv("SHIVA_LOCAL_WEBSOCKET", undefined);
    const html = renderBackdrop();
    expect(html).toContain("<img");
    expect(html).toContain("cdn.jsdelivr.net");
    expect(html).toContain("aria-hidden");
  });
});
