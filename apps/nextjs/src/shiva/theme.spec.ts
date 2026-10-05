import { describe, expect, test } from "vitest";
import { DEFAULT_THEME, getContrastColor, mergeMantineTheme } from "@mantine/core";

import { graphiteTheme, ivoryTheme, midnightTheme } from "@homarr/validation/shiva";

import {
  getShivaAccentColors,
  getShivaControlBorder,
  getShivaReadableMix,
  getShivaReadableTheme,
  getShivaWallpaperDimming,
  shivaLuminanceThreshold,
} from "./theme";

const uploadedWallpaper = `/api/shiva/wallpaper/${"a".repeat(64)}`;
function channels(color: string) {
  return [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16));
}
function luminance(values: number[]) {
  const [red = 0, green = 0, blue = 0] = values.map((value) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}
function foregroundContrast(color: string, background: number[]) {
  const foreground = luminance(channels(color));
  const surface = luminance(background);
  return (Math.max(foreground, surface) + 0.05) / (Math.min(foreground, surface) + 0.05);
}

describe("custom palette readability", () => {
  test.each(["#808080", "#767676", graphiteTheme.accent, ivoryTheme.accent])(
    "Mantine filled controls keep readable labels at rest and on hover for %s",
    (accent) => {
      const colors = getShivaAccentColors(accent);
      const theme = mergeMantineTheme(DEFAULT_THEME, {
        primaryColor: "shiva",
        primaryShade: 6,
        colors: { shiva: colors },
        autoContrast: true,
        luminanceThreshold: shivaLuminanceThreshold,
      });
      const ink = getContrastColor({ color: "shiva", theme }) === "var(--mantine-color-black)" ? "#000000" : "#ffffff";
      for (const background of [colors[6], colors[7]])
        expect(foregroundContrast(ink, channels(background))).toBeGreaterThanOrEqual(4.5);
    },
  );
  test("protects middle-luminance text when neither preset surface has enough contrast", () => {
    const custom = {
      ...graphiteTheme,
      text: "#808080",
      background: "#000000",
      surface: "#888888",
      sidebarSurface: "#888888",
      headerSurface: "#888888",
    };
    const rendered = getShivaReadableTheme(custom, "dark");
    expect(rendered.text).toBe(custom.text);
    for (const surface of [rendered.background, rendered.surface, rendered.sidebarSurface, rendered.headerSurface])
      for (const foreground of [rendered.text, rendered.muted, rendered.accent])
        expect(foregroundContrast(foreground, channels(surface))).toBeGreaterThanOrEqual(4.5);
    expect(custom.surface).toBe("#888888");
  });

  test("keeps an input outline visible when a softened middle-gray border fails on black", () => {
    const rendered = getShivaReadableTheme(
      { ...graphiteTheme, text: "#808080", background: "#000000", surface: "#000000", border: "#000000" },
      "dark",
    );
    expect(foregroundContrast(getShivaControlBorder(rendered), channels(rendered.surface))).toBeGreaterThanOrEqual(3);
  });

  test("protects hover, input and disabled states even when black and white endpoints are both readable", () => {
    const rendered = getShivaReadableTheme(
      {
        ...graphiteTheme,
        text: "#767676",
        muted: "#767676",
        accent: "#767676",
        background: "#ffffff",
        surface: "#000000",
      },
      "dark",
    );
    for (const [target, weight] of [
      [rendered.accent, 0.12],
      [rendered.accent, 0.1],
      [rendered.background, 0.2],
      [rendered.background, 0.4],
    ] as const) {
      const surface = getShivaReadableMix(rendered, rendered.surface, target, weight);
      for (const foreground of [rendered.text, rendered.muted, rendered.accent])
        expect(foregroundContrast(foreground, channels(surface))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("uploaded wallpaper foreground readability", () => {
  test.each([graphiteTheme, ivoryTheme])(
    "protects unpaneled text in $mode mode against white and black bitmaps",
    (preset) => {
      const theme = { ...preset, wallpaper: uploadedWallpaper, dimming: 0.2 };
      const overlay = getShivaWallpaperDimming(theme);
      expect(overlay).toBeGreaterThan(0.2);
      expect(overlay).toBeLessThanOrEqual(1);
      for (const extreme of [0, 255]) {
        const background = channels(theme.background).map((channel) =>
          Math.round(extreme * (1 - overlay) + channel * overlay),
        );
        for (const foreground of [theme.text, theme.muted, theme.accent])
          expect(foregroundContrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
      }
      expect(theme.dimming).toBe(0.2);
    },
  );

  test("retains stronger requested overlays and leaves the known dark built-in wallpaper unchanged", () => {
    expect(
      getShivaWallpaperDimming({ ...graphiteTheme, wallpaper: uploadedWallpaper, dimming: 0.9 }),
    ).toBeGreaterThanOrEqual(0.9);
    expect(getShivaWallpaperDimming(midnightTheme)).toBe(midnightTheme.dimming);
    expect(getShivaWallpaperDimming(graphiteTheme)).toBe(graphiteTheme.dimming);
  });

  test.each(["light", "system"] as const)("protects the dark built-in image when %s uses an Ivory palette", (mode) => {
    const theme = { ...ivoryTheme, mode, wallpaper: midnightTheme.wallpaper, dimming: 0.2 };
    const overlay = getShivaWallpaperDimming(theme);
    const darkestBitmap = channels(theme.background).map((channel) => Math.round(channel * overlay));
    for (const foreground of [theme.text, theme.muted, theme.accent])
      expect(foregroundContrast(foreground, darkestBitmap)).toBeGreaterThanOrEqual(4.5);
    expect(theme.dimming).toBe(0.2);
  });
});
