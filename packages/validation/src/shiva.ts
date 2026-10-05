// SHIVA extension, Apache-2.0. Theme documents contain appearance only.
import { z } from "zod";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const wallpaper = z
  .string()
  .max(90)
  .refine(
    (value) => value === "" || value === "/shiva/midnight.svg" || /^\/api\/shiva\/wallpaper\/[a-f0-9]{64}$/.test(value),
    "Choose an uploaded wallpaper or the built-in image.",
  );
// Portable themes may include a bitmap; ordinary settings contain only lightweight asset references.
const portableWallpaper = z
  .string()
  .max(2_796_256)
  .refine((value) => {
    if (value === "" || value === "/shiva/midnight.svg") return true;
    if (
      !/^data:image\/(png|jpeg|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
    )
      return false;
    const base64 = value.slice(value.indexOf(",") + 1);
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return base64.length > 0 && (base64.length / 4) * 3 - padding <= 2 * 1024 * 1024;
  }, "A portable wallpaper must be a PNG, JPEG or WebP no larger than 2 MiB.");
export const shivaThemeSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    mode: z.enum(["dark", "light", "system"]),
    accent: color,
    background: color,
    surface: color,
    text: color,
    muted: color,
    border: color,
    sidebarSurface: color,
    headerSurface: color,
    chart: color,
    font: z.enum(["sans", "serif", "mono"]),
    fontSize: z.number().int().min(12).max(20),
    density: z.enum(["comfortable", "compact"]),
    radius: z.number().int().min(0).max(24),
    spacing: z.number().int().min(12).max(32),
    shadow: z.boolean(),
    borders: z.boolean(),
    wallpaper,
    wallpaperPosition: z.enum(["center", "top", "bottom"]),
    wallpaperSize: z.enum(["cover", "contain"]),
    dimming: z.number().min(0).max(0.9),
    opacity: z.number().min(0.65).max(1),
    blur: z.number().int().min(0).max(24),
    reducedEffects: z.boolean(),
  })
  .strict();
export type ShivaTheme = z.infer<typeof shivaThemeSchema>;

export const midnightTheme: ShivaTheme = {
  name: "Midnight Glass",
  mode: "dark",
  accent: "#78aaff",
  background: "#0c111b",
  surface: "#172131",
  text: "#edf2fa",
  muted: "#a8b5c9",
  border: "#3b4a60",
  sidebarSurface: "#111927",
  headerSurface: "#111927",
  chart: "#91b8f8",
  font: "sans",
  fontSize: 14,
  density: "comfortable",
  radius: 16,
  spacing: 24,
  shadow: true,
  borders: true,
  wallpaper: "/shiva/midnight.svg",
  wallpaperPosition: "center",
  wallpaperSize: "cover",
  dimming: 0.2,
  opacity: 0.84,
  blur: 14,
  reducedEffects: false,
};
export const graphiteTheme: ShivaTheme = {
  ...midnightTheme,
  name: "Graphite",
  background: "#14171c",
  surface: "#20252d",
  sidebarSurface: "#191d24",
  headerSurface: "#191d24",
  border: "#414b5a",
  wallpaper: "",
  opacity: 1,
  blur: 0,
  shadow: false,
};
export const ivoryTheme: ShivaTheme = {
  ...graphiteTheme,
  name: "Ivory",
  mode: "light",
  accent: "#2454aa",
  background: "#f3f1ec",
  surface: "#fffefb",
  sidebarSurface: "#ebe9e3",
  headerSurface: "#fffefb",
  text: "#252b36",
  muted: "#535e70",
  border: "#b5bbc4",
  chart: "#315fae",
  radius: 14,
};
export const initialThemes = [midnightTheme, graphiteTheme, ivoryTheme];
export const portableShivaThemeSchema = shivaThemeSchema.extend({ wallpaper: portableWallpaper });
export const themeDocumentSchema = z
  .object({ format: z.literal("shiva-theme"), version: z.literal(1), theme: portableShivaThemeSchema })
  .strict();
export type PortableShivaTheme = z.infer<typeof portableShivaThemeSchema>;

export const homeWidgetIds = ["priorities", "agenda", "tasks", "shopping", "connections"] as const;
const widgetSchema = z
  .object({ id: z.enum(homeWidgetIds), visible: z.boolean(), width: z.enum(["normal", "wide"]) })
  .strict();
export const layoutSchema = z
  .object({
    sidebar: z.enum(["expanded", "icons", "hidden"]),
    widgets: z
      .array(widgetSchema)
      .length(5)
      .refine((rows) => new Set(rows.map((row) => row.id)).size === 5, "Each widget must appear once."),
  })
  .strict();
export type ShivaLayout = z.infer<typeof layoutSchema>;
export const defaultLayout: ShivaLayout = {
  sidebar: "expanded",
  widgets: homeWidgetIds.map((id) => ({
    id,
    visible: true,
    width: id === "priorities" || id === "connections" ? "wide" : "normal",
  })),
};
const shivaSettingsFieldsSchema = z
  .object({
    theme: shivaThemeSchema,
    privacy: z.boolean(),
    layout: layoutSchema,
    presets: z.array(shivaThemeSchema).max(12),
    savedLayouts: z.array(z.object({ name: z.string().trim().min(1).max(60), layout: layoutSchema }).strict()).max(8),
  })
  .strict();
export const SHIVA_SETTINGS_MAX_BYTES = 50 * 1024;
const metadataFits = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength <= SHIVA_SETTINGS_MAX_BYTES;
export const shivaSettingsSchema = shivaSettingsFieldsSchema.refine(
  metadataFits,
  "Settings exceed the 50 KiB metadata limit.",
);
export const shivaSettingsSnapshotSchema = shivaSettingsFieldsSchema
  .extend({ revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) })
  .refine(metadataFits, "Settings exceed the 50 KiB metadata limit.");
export const shivaSettingsResponseSchema = shivaSettingsFieldsSchema
  .extend({ revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), recoveryWarning: z.boolean() })
  .refine(metadataFits, "Settings exceed the 50 KiB metadata limit.");
export const shivaSettingsDocumentSchema = shivaSettingsFieldsSchema
  .extend({ schemaVersion: z.literal(1) })
  .refine(metadataFits, "Settings exceed the 50 KiB metadata limit.");
export type ShivaSettings = z.infer<typeof shivaSettingsSchema>;
export type ShivaSettingsSnapshot = z.infer<typeof shivaSettingsSnapshotSchema>;
export const defaultShivaSettings: ShivaSettings = {
  theme: midnightTheme,
  privacy: false,
  layout: defaultLayout,
  presets: [],
  savedLayouts: [],
};

export const shoppingStages = ["considering", "researching", "shortlisted", "budgeted", "purchased"] as const;
export const shoppingInputSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a name.").max(120),
    category: z.string().trim().min(1).max(60),
    priority: z.enum(["low", "medium", "high"]),
    estimatedPrice: z
      .number()
      .finite()
      .min(0)
      .max(1_000_000_000)
      .refine((value) => Number(value.toFixed(2)) === value, "Use at most two decimal places.")
      .nullable(),
    currency: z.enum(["INR", "USD", "EUR", "GBP"]),
    stage: z.enum(shoppingStages),
    notes: z.string().trim().max(5000),
    url: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => {
        if (!value) return true;
        try {
          const parsed = new URL(value);
          return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
        } catch {
          return false;
        }
      }, "Enter a valid HTTP or HTTPS link without credentials."),
  })
  .strict();
export type ShoppingInput = z.infer<typeof shoppingInputSchema>;

export const shoppingListInputSchema = z
  .object({
    limit: z.number().int().min(1).max(100).default(30),
    offset: z.number().int().min(0).max(100_000).default(0),
    search: z.string().trim().max(120).optional(),
    stage: z.enum(shoppingStages).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    category: z.string().trim().min(1).max(60).optional(),
  })
  .strict()
  .default({ limit: 30, offset: 0 });
