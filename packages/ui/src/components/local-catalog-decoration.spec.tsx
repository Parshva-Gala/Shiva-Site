import { renderToStaticMarkup } from "react-dom/server";
import { MantineProvider } from "@mantine/core";
import { afterEach, describe, expect, test, vi } from "vitest";

import { IntegrationAvatar } from "./integration-avatar";
import { IntegrationMarquee } from "./integration-marquee";
import { LanguageCombobox } from "./language-combobox";

afterEach(() => vi.unstubAllEnvs());

const renderCatalogDecoration = () =>
  renderToStaticMarkup(
    <MantineProvider>
      <IntegrationAvatar kind="sonarr" size="sm" />
      <IntegrationMarquee />
      <LanguageCombobox label="Language" value="en" onChange={() => undefined} />
    </MantineProvider>,
  );

describe("local catalog decoration privacy", () => {
  test("does not render remote image sources for integration or language catalog options", () => {
    vi.stubEnv("SHIVA_LOCAL_WEBSOCKET", "true");
    const html = renderCatalogDecoration();
    expect(html).not.toContain('src="https://');
    expect(html).not.toContain("cdn.jsdelivr.net");
    expect(html).toContain("tabler-icon-plug-connected");
    expect(html).toContain("tabler-icon-language");
    expect(html).toContain("Crowdin");
    expect(html).toContain("English (US)");
  });

  test("preserves upstream integration and custom language images outside local source mode", () => {
    vi.stubEnv("SHIVA_LOCAL_WEBSOCKET", undefined);
    const html = renderCatalogDecoration();
    expect(html).toContain("cdn.jsdelivr.net");
    expect(html).toContain("sonarr.svg");
    expect(html).toContain("crowdin.svg");
    expect(html).toContain("radarr.svg");
    expect(html).toContain("Crowdin");
  });
});
