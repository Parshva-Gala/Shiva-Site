"use client";

import type { CSSProperties, ReactNode } from "react";
import { useMemo } from "react";
import { createTheme, MantineProvider } from "@mantine/core";
import type { CSSVariablesResolver, MantineColorsTuple } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";

import { graphiteTheme, ivoryTheme, shivaThemeSchema } from "@homarr/validation/shiva";
import type { ShivaTheme } from "@homarr/validation/shiva";

// oxlint-disable-next-line import/no-unassigned-import -- Scoped component styles must be loaded for the SHIVA provider.
import "./appearance.css";

const fonts = {
  sans: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'Cascadia Code', 'SFMono-Regular', Consolas, monospace",
};

// The black/white contrast crossover; Mantine's default 0.3 can fail on middle gray.
export const shivaLuminanceThreshold = 0.179;

function rgb(color: string): [number, number, number] {
  return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
}

function mix(color: string, target: string, weight: number): string {
  const a = rgb(color);
  const b = rgb(target);
  return `#${a
    .map((value, index) =>
      Math.round(value * (1 - weight) + (b[index] ?? 0) * weight)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function luminance(color: string): number {
  const channels = rgb(color).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
}

function contrast(first: string, second: string): number {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function getShivaAccentColors(accent: string): MantineColorsTuple {
  const ink = contrast("#000000", accent) >= contrast("#ffffff", accent) ? "#000000" : "#ffffff";
  const darker = mix(accent, "#000000", 0.1);
  // Filled controls keep their original label ink while hovered.
  const hover = contrast(ink, darker) >= 4.5 ? darker : mix(accent, "#ffffff", 0.05);
  return [
    mix(accent, "#ffffff", 0.9),
    mix(accent, "#ffffff", 0.8),
    mix(accent, "#ffffff", 0.65),
    mix(accent, "#ffffff", 0.45),
    mix(accent, "#ffffff", 0.25),
    mix(accent, "#ffffff", 0.1),
    accent,
    hover,
    mix(accent, "#000000", 0.2),
    mix(accent, "#000000", 0.3),
  ];
}

/** Keep unsafe custom combinations recoverable without changing the stored preset. */
export function getShivaContrastWarnings(theme: ShivaTheme): string[] {
  if (!shivaThemeSchema.safeParse(theme).success || theme.mode === "system") return [];
  const warnings: string[] = [];
  for (const key of ["background", "surface", "sidebarSurface", "headerSurface"] as const) {
    if (contrast(theme.text, theme[key]) < 4.5) warnings.push(key);
  }
  const surfaces = [theme.background, theme.surface, theme.sidebarSurface, theme.headerSurface];
  if (surfaces.some((surface) => contrast(theme.muted, surface) < 4.5)) warnings.push("secondary text");
  if (surfaces.some((surface) => contrast(theme.accent, surface) < 4.5)) warnings.push("accent text");
  if (contrast(theme.chart, theme.surface) < 3) warnings.push("chart palette");
  return warnings;
}

export function getShivaReadableTheme(theme: ShivaTheme, mode: "light" | "dark"): ShivaTheme {
  const fallback = mode === "dark" ? graphiteTheme : ivoryTheme;
  const text = contrast(theme.text, theme.background) >= 4.5 ? theme.text : fallback.text;
  const result = { ...theme, text };
  for (const key of ["background", "surface", "sidebarSurface", "headerSurface"] as const) {
    if (contrast(text, result[key]) < 4.5) {
      // A middle-luminance text color can fail on both approximate light/dark
      // surfaces. The strongest exact black/white pole always reaches 4.5:1.
      const strongestPole = contrast(text, "#000000") >= contrast(text, "#ffffff") ? "#000000" : "#ffffff";
      result[key] = contrast(text, fallback[key]) >= 4.5 ? fallback[key] : strongestPole;
    }
  }
  const surfaces = [result.background, result.surface, result.sidebarSurface, result.headerSurface];
  if (surfaces.some((surface) => contrast(result.muted, surface) < 4.5)) result.muted = result.text;
  if (surfaces.some((surface) => contrast(result.accent, surface) < 4.5)) {
    result.accent = surfaces.every((surface) => contrast(fallback.accent, surface) >= 4.5)
      ? fallback.accent
      : result.text;
  }
  // Active/hover states also carry accent labels, including the sidebar links.
  if (
    surfaces.some(
      (surface) => contrast(result.accent, mix(surface, result.accent, mode === "dark" ? 0.12 : 0.08)) < 4.5,
    )
  ) {
    result.accent = result.text;
  }
  if (contrast(result.chart, result.surface) < 3) result.chart = result.accent;
  return result;
}

/** Two readable endpoints can still produce an unreadable intermediate color. */
export function getShivaReadableMix(theme: ShivaTheme, surface: string, target: string, weight: number): string {
  const mixed = mix(surface, target, weight);
  return [theme.text, theme.muted, theme.accent].every((foreground) => contrast(foreground, mixed) >= 4.5)
    ? mixed
    : surface;
}

export function getShivaControlBorder(theme: ShivaTheme): string {
  const input = getShivaReadableMix(theme, theme.surface, theme.background, 0.2);
  const surfaces = [theme.surface, input];
  if (surfaces.every((surface) => contrast(theme.border, surface) >= 3)) return theme.border;
  const softened = mix(theme.surface, theme.text, 0.5);
  return surfaces.every((surface) => contrast(softened, surface) >= 3) ? softened : theme.text;
}

function alphaColor(color: string, alpha: number): string {
  return `rgba(${rgb(color).join(", ")}, ${alpha})`;
}

/** Uploaded images can be any brightness; page headings are outside the protected panels. */
export function getShivaWallpaperDimming(theme: ShivaTheme): number {
  const uploaded = theme.wallpaper.startsWith("/api/shiva/wallpaper/");
  const lightPaletteOnMidnight =
    theme.wallpaper === "/shiva/midnight.svg" && luminance(theme.text) < luminance(theme.background);
  if (!uploaded && !lightPaletteOnMidnight) return theme.dimming;
  let dimming = theme.dimming;
  const foregrounds = [theme.text, theme.muted, theme.accent];
  while (
    dimming < 1 &&
    ["#ffffff", "#000000"].some((extreme) =>
      foregrounds.some((foreground) => contrast(foreground, mix(extreme, theme.background, dimming)) < 4.5),
    )
  )
    dimming = Math.min(1, dimming + 0.025);
  return Math.round(dimming * 1000) / 1000;
}

/** Protect readability even if an uploaded wallpaper is entirely white or black. */
function readableOpacity(theme: ShivaTheme, surface: string, dimming: number): number {
  let alpha = theme.opacity;
  const extremes = [mix("#ffffff", theme.background, dimming), mix("#000000", theme.background, dimming)];
  while (
    alpha < 1 &&
    extremes.some(
      (color) =>
        contrast(theme.text, mix(color, surface, alpha)) < 4.5 ||
        contrast(theme.muted, mix(color, surface, alpha)) < 4.5 ||
        contrast(theme.accent, mix(color, surface, alpha)) < 4.5,
    )
  ) {
    alpha = Math.min(1, alpha + 0.025);
  }
  return Math.round(alpha * 1000) / 1000;
}

export function ShivaThemeProvider({ theme: input, children }: { theme: ShivaTheme; children: ReactNode }) {
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)", true);
  const smallScreen = useMediaQuery("(max-width: 720px)", false);
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)", false);
  const configured = useMemo(() => {
    const parsed = shivaThemeSchema.safeParse(input);
    return parsed.success ? parsed.data : graphiteTheme;
  }, [input]);
  const mode = configured.mode === "system" ? (systemDark ? "dark" : "light") : configured.mode;
  // System mode follows the OS with a legible base palette; all layout and effect preferences remain user controlled.
  const theme = useMemo(() => {
    const base = mode === "dark" ? graphiteTheme : ivoryTheme;
    const source =
      configured.mode === "system"
        ? {
            ...configured,
            accent: base.accent,
            background: base.background,
            surface: base.surface,
            text: base.text,
            muted: base.muted,
            border: base.border,
            sidebarSurface: base.sidebarSurface,
            headerSurface: base.headerSurface,
            chart: base.chart,
          }
        : configured;
    return getShivaReadableTheme(source, mode);
  }, [configured, mode]);
  const wallpaperDimming = useMemo(() => getShivaWallpaperDimming(theme), [theme]);
  const reduced = theme.reducedEffects || smallScreen || prefersReducedMotion;
  const glass = Boolean(theme.wallpaper) && !reduced;
  const mantineTheme = useMemo(() => {
    const portalProps = { target: "#shiva-portals" };
    const panelStyle = {
      background: "var(--shiva-panel)",
      color: "var(--shiva-text)",
      borderColor: "var(--shiva-border)",
      backdropFilter: "var(--shiva-glass)",
      boxShadow: "var(--shiva-shadow)",
    };
    const dropdownStyle = {
      background: "var(--shiva-surface)",
      color: "var(--shiva-text)",
      borderColor: "var(--shiva-control-border)",
    };
    const shades = getShivaAccentColors(theme.accent);
    return createTheme({
      primaryColor: "shiva",
      primaryShade: 6,
      autoContrast: true,
      luminanceThreshold: shivaLuminanceThreshold,
      respectReducedMotion: true,
      cursorType: "pointer",
      fontFamily: fonts[theme.font],
      fontFamilyMonospace: fonts.mono,
      headings: { fontFamily: fonts[theme.font], fontWeight: "650" },
      fontSizes: {
        xs: `${Math.max(11, theme.fontSize - 2)}px`,
        sm: `${theme.fontSize}px`,
        md: `${theme.fontSize + 1}px`,
        lg: `${theme.fontSize + 3}px`,
        xl: `${theme.fontSize + 5}px`,
      },
      spacing: {
        xs: `${theme.spacing * 0.4}px`,
        sm: `${theme.spacing * 0.6}px`,
        md: `${theme.spacing * 0.8}px`,
        lg: `${theme.spacing}px`,
        xl: `${theme.spacing * 1.3}px`,
      },
      radius: {
        xs: `${theme.radius * 0.3}px`,
        sm: `${theme.radius * 0.5}px`,
        md: `${theme.radius * 0.7}px`,
        lg: `${theme.radius}px`,
        xl: `${theme.radius * 1.25}px`,
      },
      defaultRadius: "md",
      colors: { shiva: shades },
      components: {
        Card: {
          defaultProps: { withBorder: theme.borders, radius: "lg", padding: theme.density === "compact" ? "sm" : "lg" },
          styles: { root: panelStyle },
        },
        Paper: { defaultProps: { withBorder: theme.borders, radius: "lg" }, styles: { root: panelStyle } },
        Input: {
          defaultProps: { size: theme.density === "compact" ? "xs" : "sm" },
          styles: {
            input: {
              background: "var(--shiva-input)",
              color: "var(--shiva-text)",
              borderColor: "var(--shiva-control-border)",
            },
          },
        },
        InputWrapper: {
          styles: { label: { color: "var(--shiva-text)" }, description: { color: "var(--shiva-muted)" } },
        },
        Button: { defaultProps: { radius: "md", size: theme.density === "compact" ? "xs" : "sm" } },
        Modal: {
          defaultProps: {
            portalProps,
            centered: true,
            // Native dialogs should respond immediately; animating a full-screen
            // backdrop over glass cards delays feedback on modest renderers.
            transitionProps: { duration: 0 },
            overlayProps: { backgroundOpacity: 0.7, blur: 0 },
          },
          styles: { content: dropdownStyle, header: dropdownStyle },
        },
        Drawer: { defaultProps: { portalProps }, styles: { content: dropdownStyle, header: dropdownStyle } },
        Menu: { defaultProps: { portalProps }, styles: { dropdown: dropdownStyle } },
        Popover: { defaultProps: { portalProps }, styles: { dropdown: dropdownStyle } },
        Combobox: { defaultProps: { portalProps }, styles: { dropdown: dropdownStyle } },
        Tooltip: {
          defaultProps: { portalProps, openDelay: 250 },
          styles: { tooltip: { background: "var(--shiva-text)", color: "var(--shiva-bg)" } },
        },
        Table: { styles: { table: { color: "var(--shiva-text)", borderColor: "var(--shiva-border)" } } },
        Divider: { styles: { root: { borderColor: "var(--shiva-border)" } } },
      },
    });
  }, [theme]);
  const cssVariablesResolver = useMemo<CSSVariablesResolver>(() => {
    // Mantine's scheme selectors outrank its shared variable selector. Override
    // semantic colors in each scheme so components and portals use the same tokens.
    const semanticVariables = {
      "--mantine-color-body": theme.background,
      "--mantine-color-text": theme.text,
      "--mantine-color-bright": theme.text,
      "--mantine-color-dimmed": theme.muted,
      "--mantine-color-placeholder": theme.muted,
      "--mantine-color-default": theme.surface,
      "--mantine-color-default-color": theme.text,
      "--mantine-color-default-border": "var(--shiva-control-border)",
      "--mantine-color-default-hover": getShivaReadableMix(theme, theme.surface, theme.accent, 0.1),
      "--mantine-color-anchor": theme.accent,
      "--mantine-color-disabled": getShivaReadableMix(theme, theme.surface, theme.background, 0.4),
      "--mantine-color-disabled-color": theme.muted,
      "--mantine-color-disabled-border": "var(--shiva-control-border)",
    };
    return () => ({
      variables: {
        "--shiva-bg": theme.background,
        "--shiva-surface": theme.surface,
        "--shiva-text": theme.text,
        "--shiva-muted": theme.muted,
        "--shiva-border": theme.border,
        "--shiva-control-border": getShivaControlBorder(theme),
        "--shiva-accent": theme.accent,
        "--shiva-chart": theme.chart,
        "--shiva-wallpaper-dimming": String(wallpaperDimming),
        "--shiva-sidebar": glass
          ? alphaColor(theme.sidebarSurface, readableOpacity(theme, theme.sidebarSurface, wallpaperDimming))
          : theme.sidebarSurface,
        "--shiva-sidebar-opaque": theme.sidebarSurface,
        "--shiva-header": glass
          ? alphaColor(theme.headerSurface, readableOpacity(theme, theme.headerSurface, wallpaperDimming))
          : theme.headerSurface,
        "--shiva-header-opaque": theme.headerSurface,
        "--shiva-panel": glass
          ? alphaColor(theme.surface, readableOpacity(theme, theme.surface, wallpaperDimming))
          : theme.surface,
        "--shiva-glass": glass ? `blur(${theme.blur}px)` : "none",
        "--shiva-radius": `${theme.radius}px`,
        "--shiva-spacing": `${theme.spacing}px`,
        "--shiva-card-border": theme.borders ? "1px solid var(--shiva-border)" : "none",
        "--shiva-card-padding": `${theme.density === "compact" ? theme.spacing * 0.65 : theme.spacing}px`,
        "--shiva-font-size": `${theme.fontSize}px`,
        "--shiva-font-small": `${Math.max(12, theme.fontSize - 1)}px`,
        "--shiva-font-tiny": `${Math.max(11, theme.fontSize - 2)}px`,
        "--shiva-shadow": theme.shadow && !reduced ? "0 12px 34px rgba(0,0,0,.12)" : "none",
        "--shiva-input": getShivaReadableMix(theme, theme.surface, theme.background, 0.2),
        "--shiva-hover": getShivaReadableMix(theme, theme.surface, theme.accent, mode === "dark" ? 0.12 : 0.08),
        ...semanticVariables,
      },
      light: semanticVariables,
      dark: semanticVariables,
    });
  }, [theme, glass, reduced, mode, wallpaperDimming]);
  const rootStyle: CSSProperties = {
    backgroundColor: theme.background,
    backgroundImage: theme.wallpaper
      ? `linear-gradient(${alphaColor(theme.background, wallpaperDimming)}, ${alphaColor(theme.background, wallpaperDimming)}), url("${theme.wallpaper}")`
      : undefined,
    backgroundPosition: theme.wallpaperPosition,
    backgroundSize: theme.wallpaperSize,
    fontFamily: fonts[theme.font],
    fontSize: `${theme.fontSize}px`,
  };
  return (
    <MantineProvider
      theme={mantineTheme}
      forceColorScheme={mode}
      cssVariablesSelector=".shiva-root"
      deduplicateCssVariables={false}
      cssVariablesResolver={cssVariablesResolver}
      getRootElement={() =>
        typeof document === "undefined" ? undefined : (document.getElementById("shiva-theme-root") ?? undefined)
      }
    >
      <div
        id="shiva-theme-root"
        className="shiva-root"
        data-effects={reduced ? "reduced" : "full"}
        data-density={theme.density}
        data-mantine-color-scheme={mode}
        style={rootStyle}
      >
        {children}
        <div id="shiva-portals" />
      </div>
    </MantineProvider>
  );
}
