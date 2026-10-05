"use client";

import { useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  ColorInput,
  Divider,
  FileButton,
  Group,
  Image as MantineImage,
  Modal,
  NumberInput,
  SegmentedControl,
  SimpleGrid,
  Slider,
  Stack,
  Switch,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconDownload,
  IconPhoto,
  IconRefresh,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { z } from "zod";

import { graphiteTheme, initialThemes, shivaThemeSchema, themeDocumentSchema } from "@homarr/validation/shiva";
import type { ShivaSettings, ShivaTheme } from "@homarr/validation/shiva";

import { getShivaContrastWarnings } from "./theme";

const maximumImageBytes = 2 * 1024 * 1024;
const maximumDocumentBytes = 2_850_000;
const themeFields = shivaThemeSchema.keyof().options;
const wallpaperLibrarySchema = z
  .object({
    assets: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-f0-9]{64}$/),
            url: z.string().regex(/^\/api\/shiva\/wallpaper\/[a-f0-9]{64}$/),
            size: z.number().int().positive().max(maximumImageBytes),
            createdAt: z.string(),
            inUse: z.boolean(),
          })
          .strict(),
      )
      .max(24),
  })
  .strict();
type WallpaperAsset = z.infer<typeof wallpaperLibrarySchema>["assets"][number];
const paletteFields = [
  ["accent", "Accent"],
  ["background", "Background"],
  ["surface", "Card surface"],
  ["text", "Text"],
  ["muted", "Secondary text"],
  ["border", "Borders"],
  ["sidebarSurface", "Sidebar surface"],
  ["headerSurface", "Header surface"],
  ["chart", "Chart palette"],
] as const;

function imageIsValid(uri: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.addEventListener(
      "load",
      () =>
        resolve(
          image.naturalWidth > 0 &&
            image.naturalHeight > 0 &&
            image.naturalWidth <= 16384 &&
            image.naturalHeight <= 16384 &&
            image.naturalWidth * image.naturalHeight <= 40_000_000,
        ),
      { once: true },
    );
    image.addEventListener("error", () => resolve(false), { once: true });
    image.src = uri;
  });
}

function themesEqual(first: ShivaTheme, second: ShivaTheme): boolean {
  return themeFields.every((key) => first[key] === second[key]);
}

function presetsEqual(first: ShivaTheme[], second: ShivaTheme[]): boolean {
  return (
    first.length === second.length &&
    first.every((preset, index) => {
      const other = second[index];
      return other !== undefined && themesEqual(preset, other);
    })
  );
}

async function validateImage(file: Blob): Promise<void> {
  if (!file.size || file.size > maximumImageBytes || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Choose a PNG, JPEG or WebP image no larger than 2 MB.");
  }
  const uri = URL.createObjectURL(file);
  try {
    if (!(await imageIsValid(uri)))
      throw new Error("Choose a supported image with dimensions no larger than 16,384 pixels and 40 megapixels.");
  } finally {
    URL.revokeObjectURL(uri);
  }
}

async function storeWallpaper(file: File): Promise<string> {
  await validateImage(file);
  const form = new FormData();
  form.set("file", file);
  const response = await fetch("/api/shiva/wallpaper", { method: "POST", body: form, credentials: "same-origin" });
  if (!response.ok) {
    if (response.status === 409)
      throw new Error("Your wallpaper library is full. Remove an unused image and try again.");
    throw new Error("Wallpaper could not be uploaded. Check the local server and try again.");
  }
  const result: unknown = await response.json();
  if (
    typeof result !== "object" ||
    result === null ||
    !("url" in result) ||
    typeof result.url !== "string" ||
    !/^\/api\/shiva\/wallpaper\/[a-f0-9]{64}$/.test(result.url)
  ) {
    throw new Error("The server returned an invalid wallpaper reference.");
  }
  return result.url;
}

function portableImageFile(uri: string): File {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(uri);
  if (!match?.[1] || !match[2]) throw new Error("Invalid portable wallpaper.");
  const bytes = Uint8Array.from(atob(match[2]), (character) => character.charCodeAt(0));
  if (bytes.byteLength > maximumImageBytes) throw new Error("The wallpaper exceeds 2 MB.");
  return new File([bytes], "imported-wallpaper", { type: match[1] });
}

function imageDataUri(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      "load",
      () =>
        typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Wallpaper could not be read.")),
      { once: true },
    );
    reader.addEventListener("error", () => reject(new Error("Wallpaper could not be read.")), { once: true });
    reader.readAsDataURL(file);
  });
}

function Preset({ preset, selected, onSelect }: { preset: ShivaTheme; selected: boolean; onSelect: () => void }) {
  return (
    <UnstyledButton
      className="shiva-preset"
      onClick={onSelect}
      data-selected={selected}
      aria-pressed={selected}
      aria-label={`Preview ${preset.name}`}
    >
      <Stack gap="sm">
        <div
          className="shiva-preset-preview"
          style={{
            background: preset.background,
            backgroundImage: preset.wallpaper === "/shiva/midnight.svg" ? "url('/shiva/midnight.svg')" : undefined,
            backgroundSize: "cover",
          }}
          aria-hidden="true"
        >
          <div style={{ display: "flex", gap: 8, height: "100%" }}>
            <div style={{ width: 23, borderRadius: 6, background: preset.sidebarSurface }} />
            <div style={{ flex: 1, background: preset.surface, opacity: preset.opacity, borderRadius: 7, padding: 10 }}>
              <div className="shiva-preview-bar" style={{ width: "45%", background: preset.accent }} />
              <div className="shiva-preview-bar" style={{ width: "78%", background: preset.text, opacity: 0.25 }} />
              <div className="shiva-preview-bar" style={{ width: "60%", background: preset.text, opacity: 0.15 }} />
            </div>
          </div>
        </div>
        <Group justify="space-between" gap="xs">
          <Text fw={650} size="sm">
            {preset.name}
          </Text>
          {selected && <IconCheck size={17} aria-hidden="true" />}
        </Group>
        <Text size="xs" c="dimmed">
          {preset.name === "Midnight Glass"
            ? "Wallpaper · soft glass · dark"
            : preset.name === "Graphite"
              ? "Opaque · calm · dark"
              : preset.name === "Ivory"
                ? "Warm · crisp · light"
                : `${preset.mode} · ${preset.density}`}
        </Text>
      </Stack>
    </UnstyledButton>
  );
}

export function Appearance({
  settings,
  onSave,
  onPreview,
}: {
  settings: ShivaSettings;
  onSave: (theme: ShivaTheme, presets: ShivaTheme[]) => Promise<void>;
  onPreview: (theme: ShivaTheme | null) => void;
}) {
  const [draft, setDraft] = useState<ShivaTheme>(settings.theme);
  const [presets, setPresets] = useState<ShivaTheme[]>(settings.presets);
  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [assets, setAssets] = useState<WallpaperAsset[] | null>(null);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [removeAsset, setRemoveAsset] = useState<WallpaperAsset | null>(null);
  const [deletingAsset, setDeletingAsset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const [resetOpened, setResetOpened] = useState(false);
  const [removePreset, setRemovePreset] = useState<string | null>(null);
  const imageReset = useRef<() => void>(null);
  const importReset = useRef<() => void>(null);
  const previewCallback = useRef(onPreview);
  previewCallback.current = onPreview;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const savedRef = useRef({ theme: settings.theme, presets: settings.presets });
  const imageOperation = useRef(0);

  useEffect(() => {
    if (
      !themesEqual(savedRef.current.theme, settings.theme) ||
      !presetsEqual(savedRef.current.presets, settings.presets)
    ) {
      setDraft(settings.theme);
      setPresets(settings.presets);
      previewCallback.current(null);
    }
    savedRef.current = { theme: settings.theme, presets: settings.presets };
  }, [settings.theme, settings.presets]);
  useEffect(
    () => () => {
      imageOperation.current += 1;
      previewCallback.current(null);
    },
    [],
  );

  const changed = !themesEqual(draft, settings.theme) || !presetsEqual(presets, settings.presets);
  const contrastWarnings = getShivaContrastWarnings(draft);

  function change(next: ShivaTheme) {
    setDraft(next);
    setError(null);
    setNotice(null);
    const valid = shivaThemeSchema.safeParse(next);
    if (previewEnabled && valid.success) onPreview(valid.data);
  }

  function update<K extends keyof ShivaTheme>(field: K, value: ShivaTheme[K]) {
    if (field === "wallpaper") {
      imageOperation.current += 1;
      setImageBusy(false);
    }
    change({ ...draft, [field]: value });
  }

  function selectPreset(preset: ShivaTheme) {
    imageOperation.current += 1;
    setImageBusy(false);
    change({ ...preset });
  }

  function cancel() {
    imageOperation.current += 1;
    setImageBusy(false);
    setDraft(settings.theme);
    setPresets(settings.presets);
    setError(null);
    setNotice(null);
    onPreview(null);
  }

  async function save(theme = draft, nextPresets = presets) {
    imageOperation.current += 1;
    setImageBusy(false);
    setError(null);
    setNotice(null);
    const result = shivaThemeSchema.safeParse(theme);
    if (!result.success) {
      setError(result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" "));
      return;
    }
    setSaving(true);
    try {
      await onSave(result.data, nextPresets);
      onPreview(null);
      setDraft(result.data);
      setPresets(nextPresets);
      setNotice("Appearance saved. It will be here after your next restart.");
      setResetOpened(false);
    } catch {
      setError("Appearance could not be saved. Your previous settings are intact. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  function addPreset() {
    const name = presetName.trim();
    if (!name || name.length > 60) {
      setError("Give your preset a name of 1–60 characters.");
      return;
    }
    if ([...initialThemes, ...presets].some((preset) => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setError("A preset with that name already exists. Choose a different name.");
      return;
    }
    if (presets.length >= 12) {
      setError("You can keep up to 12 custom presets. Remove one before adding another.");
      return;
    }
    const result = shivaThemeSchema.safeParse({ ...draft, name });
    if (!result.success) {
      setError("Fix the appearance values before adding this preset.");
      return;
    }
    setPresets([...presets, result.data]);
    setPresetName("");
    setError(null);
    setNotice("Preset added to your draft. Save changes to keep it.");
  }

  async function uploadWallpaper(file: File | null) {
    imageReset.current?.();
    if (!file) return;
    setError(null);
    setNotice(null);
    const operation = ++imageOperation.current;
    setImageBusy(true);
    try {
      const url = await storeWallpaper(file);
      if (operation !== imageOperation.current) return;
      change({ ...draftRef.current, wallpaper: url });
      setNotice("Wallpaper uploaded into preview. Save changes to keep it active.");
      if (assets !== null) void loadLibrary();
    } catch (cause) {
      if (operation === imageOperation.current)
        setError(cause instanceof Error ? cause.message : "That image could not be uploaded.");
    } finally {
      if (operation === imageOperation.current) setImageBusy(false);
    }
  }

  async function loadLibrary() {
    setLibraryBusy(true);
    setLibraryError(null);
    try {
      const response = await fetch("/api/shiva/wallpaper", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Wallpaper library could not be loaded.");
      const result = wallpaperLibrarySchema.parse(await response.json());
      setAssets(result.assets);
    } catch {
      setLibraryError("Wallpaper library unavailable. Check the local server and retry.");
    } finally {
      setLibraryBusy(false);
    }
  }

  function assetInUse(asset: WallpaperAsset): boolean {
    return asset.inUse || draft.wallpaper === asset.url || presets.some((preset) => preset.wallpaper === asset.url);
  }

  async function deleteWallpaper() {
    if (!removeAsset || assetInUse(removeAsset)) return;
    setDeletingAsset(true);
    setLibraryError(null);
    try {
      const response = await fetch(removeAsset.url, { method: "DELETE", credentials: "same-origin" });
      if (response.status === 409)
        throw new Error(
          "This wallpaper is referenced by saved appearance or presets. Remove those references and save before deleting it.",
        );
      if (!response.ok) throw new Error("Wallpaper could not be deleted. Check the local server and retry.");
      setAssets((current) => current?.filter((asset) => asset.id !== removeAsset.id) ?? null);
      setRemoveAsset(null);
      setNotice("Unused wallpaper deleted.");
    } catch (cause) {
      setLibraryError(cause instanceof Error ? cause.message : "Wallpaper could not be deleted.");
    } finally {
      setDeletingAsset(false);
    }
  }

  async function importTheme(file: File | null) {
    importReset.current?.();
    if (!file) return;
    setError(null);
    if (file.size > maximumDocumentBytes) {
      setError("This theme file is too large. Theme imports must be under 2.85 MB.");
      return;
    }
    const operation = ++imageOperation.current;
    setImageBusy(true);
    setNotice(null);
    try {
      const result = themeDocumentSchema.safeParse(JSON.parse(await file.text()));
      if (!result.success) {
        setError("Invalid SHIVA theme. Use a version 1 theme export with appearance fields only.");
        return;
      }
      const portable = result.data.theme;
      const wallpaper = portable.wallpaper.startsWith("data:")
        ? await storeWallpaper(portableImageFile(portable.wallpaper))
        : portable.wallpaper;
      if (operation !== imageOperation.current) return;
      change(shivaThemeSchema.parse({ ...portable, wallpaper }));
      setNotice("Theme imported into preview. Save changes to keep it.");
      if (assets !== null && wallpaper.startsWith("/api/")) void loadLibrary();
    } catch (cause) {
      if (operation === imageOperation.current)
        setError(
          cause instanceof Error && cause.message.includes("library is full")
            ? cause.message
            : "This file is not a valid SHIVA theme, or its wallpaper could not be loaded.",
        );
    } finally {
      if (operation === imageOperation.current) setImageBusy(false);
    }
  }

  async function exportTheme() {
    setError(null);
    setExporting(true);
    try {
      const validTheme = shivaThemeSchema.parse(draft);
      let wallpaper = validTheme.wallpaper;
      if (wallpaper.startsWith("/api/")) {
        const response = await fetch(wallpaper, { credentials: "same-origin" });
        if (!response.ok)
          throw new Error("The selected wallpaper is unavailable. Choose another image before exporting.");
        const blob = await response.blob();
        await validateImage(blob);
        wallpaper = await imageDataUri(blob);
      }
      const result = themeDocumentSchema.parse({
        format: "shiva-theme",
        version: 1,
        theme: { ...validTheme, wallpaper },
      });
      const exportedFile = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
      if (exportedFile.size > maximumDocumentBytes) throw new Error("This theme exceeds the portable file limit.");
      const url = URL.createObjectURL(exportedFile);
      const link = document.createElement("a");
      link.href = url;
      link.download = `shiva-${draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "theme"}.json`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice("Theme exported. The file contains appearance only, including your selected wallpaper.");
    } catch {
      setError(
        "This theme could not be exported. Check the appearance values and make sure its wallpaper is available.",
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>Appearance</Title>
          <Text c="dimmed" mt={5}>
            Choose a starting point, then tune the details across your workspace.
          </Text>
        </div>
        <Badge variant="light" color={changed ? "blue" : "gray"}>
          {changed ? "Unsaved changes" : "Saved appearance"}
        </Badge>
      </Group>
      {error && (
        <Alert
          icon={<IconAlertCircle size={18} />}
          title="Check appearance"
          color="red"
          role="alert"
          withCloseButton
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}
      {notice && (
        <Alert
          icon={<IconCheck size={18} />}
          color="blue"
          // Mantine Alert renders a div; a non-urgent status region preserves its supported structure.
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="status"
          withCloseButton
          onClose={() => setNotice(null)}
        >
          {notice}
        </Alert>
      )}
      {contrastWarnings.length > 0 && (
        <Alert icon={<IconAlertCircle size={18} />} color="yellow" title="Readability protection">
          Some selected colors have low contrast ({contrastWarnings.join(", ")}). SHIVA applies readable display colors
          while keeping your chosen values available to edit.
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
        {initialThemes.map((preset) => (
          <Preset
            key={preset.name}
            preset={preset}
            selected={themesEqual(preset, draft)}
            onSelect={() => selectPreset(preset)}
          />
        ))}
      </SimpleGrid>
      <Card>
        <Group justify="space-between" mb="lg">
          <div>
            <Title order={3}>Live workspace preview</Title>
            <Text size="sm" c="dimmed">
              Changes apply to this session until you save or cancel.
            </Text>
          </div>
          <Switch
            label="Live preview"
            checked={previewEnabled}
            onChange={(event) => {
              setPreviewEnabled(event.currentTarget.checked);
              onPreview(event.currentTarget.checked ? draft : null);
            }}
          />
        </Group>
        <Tabs defaultValue="theme" keepMounted={false}>
          <Tabs.List mb="lg">
            <Tabs.Tab value="theme">Colors</Tabs.Tab>
            <Tabs.Tab value="wallpaper">Wallpaper & glass</Tabs.Tab>
            <Tabs.Tab value="interface">Interface</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="theme">
            <Stack gap="lg">
              <TextInput
                label="Theme name"
                description="Used in your exported theme and saved appearance."
                value={draft.name}
                maxLength={60}
                onChange={(event) => update("name", event.currentTarget.value)}
              />
              <div>
                <Text size="sm" fw={500} mb={7}>
                  Color mode
                </Text>
                <SegmentedControl
                  fullWidth
                  value={draft.mode}
                  data={[
                    { value: "dark", label: "Dark" },
                    { value: "light", label: "Light" },
                    { value: "system", label: "System" },
                  ]}
                  onChange={(value) => {
                    if (value === "system") {
                      update("mode", "system");
                      return;
                    }
                    const base = initialThemes.find(
                      (preset) => preset.mode === value && preset.name !== "Midnight Glass",
                    );
                    if (base && (value === "dark" || value === "light"))
                      change({
                        ...draft,
                        mode: value,
                        ...Object.fromEntries(paletteFields.map(([key]) => [key, base[key]])),
                      });
                  }}
                />
                <Text size="xs" c="dimmed" mt={7}>
                  System follows your device with Graphite or Ivory colors. Custom colors apply in Light or Dark mode.
                </Text>
              </div>
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
                {paletteFields.map(([key, label]) => (
                  <ColorInput
                    key={key}
                    label={label}
                    format="hex"
                    disallowInput={false}
                    value={draft[key]}
                    onChange={(value) => update(key, value)}
                    disabled={draft.mode === "system"}
                    withPicker
                  />
                ))}
              </SimpleGrid>
              <Text size="xs" c="dimmed">
                Status colors retain their meaning. Low contrast values get a readable display fallback; dialogs and
                menus stay opaque.
              </Text>
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="wallpaper">
            <Stack gap="lg">
              <Group gap="sm">
                <FileButton
                  resetRef={imageReset}
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(file) => {
                    void uploadWallpaper(file);
                  }}
                >
                  {(props) => (
                    <Button
                      {...props}
                      variant="light"
                      leftSection={<IconPhoto size={17} />}
                      loading={imageBusy}
                      disabled={saving}
                    >
                      Choose wallpaper
                    </Button>
                  )}
                </FileButton>
                <Button variant="default" disabled={!draft.wallpaper} onClick={() => update("wallpaper", "")}>
                  Remove wallpaper
                </Button>
              </Group>
              <Text size="sm" c="dimmed">
                PNG, JPEG or WebP · maximum 2 MB. Stored privately in your wallpaper library; no external image
                requests.
              </Text>
              {draft.wallpaper && (
                <MantineImage
                  src={shivaThemeSchema.safeParse(draft).success ? draft.wallpaper : undefined}
                  alt="Selected wallpaper preview"
                  h={140}
                  fit={draft.wallpaperSize === "cover" ? "cover" : "contain"}
                  radius="md"
                  style={{ objectPosition: draft.wallpaperPosition, background: "var(--shiva-bg)" }}
                />
              )}
              <div>
                <Group justify="space-between" mb="sm">
                  <Text fw={600} size="sm">
                    Wallpaper library
                  </Text>
                  <Button
                    variant="subtle"
                    size="xs"
                    loading={libraryBusy}
                    onClick={() => {
                      void loadLibrary();
                    }}
                  >
                    {assets === null ? "Open library" : "Refresh library"}
                  </Button>
                </Group>
                <Text size="xs" c="dimmed" mb="sm">
                  Keep up to 24 uploaded images. Saved themes and presets protect their images from deletion.
                </Text>
                {libraryError && (
                  <Alert color="red" role="alert" mb="sm">
                    {libraryError}
                  </Alert>
                )}
                {assets?.length === 0 && (
                  <Text size="sm" c="dimmed">
                    No uploaded wallpapers yet.
                  </Text>
                )}
                {assets && assets.length > 0 && (
                  <SimpleGrid cols={{ base: 2, sm: 3, lg: 4 }} spacing="sm">
                    {assets.map((asset, index) => (
                      <div key={asset.id} className="shiva-wallpaper-asset">
                        <UnstyledButton
                          className="shiva-wallpaper-pick"
                          aria-label={`Preview uploaded wallpaper ${index + 1}`}
                          aria-pressed={draft.wallpaper === asset.url}
                          data-selected={draft.wallpaper === asset.url}
                          onClick={() => update("wallpaper", asset.url)}
                        >
                          <MantineImage
                            src={`${asset.url}?thumbnail=1`}
                            alt=""
                            h={80}
                            fit="cover"
                            radius="sm"
                            loading="lazy"
                          />
                        </UnstyledButton>
                        <Group justify="space-between" mt={5} gap="xs">
                          <Text size="xs" c="dimmed">
                            {Math.round(asset.size / 1024)} KB{assetInUse(asset) ? " · In use" : ""}
                          </Text>
                          <Tooltip
                            label={
                              assetInUse(asset)
                                ? "Remove theme references and save before deleting"
                                : "Delete unused wallpaper"
                            }
                          >
                            <ActionIcon
                              aria-label={`Delete uploaded wallpaper ${index + 1}`}
                              color="red"
                              variant="subtle"
                              disabled={assetInUse(asset)}
                              onClick={() => setRemoveAsset(asset)}
                            >
                              <IconTrash size={15} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </div>
                    ))}
                  </SimpleGrid>
                )}
              </div>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
                <div>
                  <Text size="sm" fw={500} mb={7}>
                    Position
                  </Text>
                  <SegmentedControl
                    fullWidth
                    value={draft.wallpaperPosition}
                    data={[
                      { value: "top", label: "Top" },
                      { value: "center", label: "Center" },
                      { value: "bottom", label: "Bottom" },
                    ]}
                    onChange={(value) => {
                      if (value === "top" || value === "center" || value === "bottom")
                        update("wallpaperPosition", value);
                    }}
                  />
                </div>
                <div>
                  <Text size="sm" fw={500} mb={7}>
                    Scaling
                  </Text>
                  <SegmentedControl
                    fullWidth
                    value={draft.wallpaperSize}
                    data={[
                      { value: "cover", label: "Fill" },
                      { value: "contain", label: "Fit" },
                    ]}
                    onChange={(value) => {
                      if (value === "cover" || value === "contain") update("wallpaperSize", value);
                    }}
                  />
                </div>
                <div>
                  <Text size="sm" fw={500} mb={12}>
                    Requested wallpaper dimming · {Math.round(draft.dimming * 100)}%
                  </Text>
                  <Slider
                    aria-label="Wallpaper dimming"
                    value={draft.dimming * 100}
                    min={0}
                    max={90}
                    onChange={(value) => update("dimming", value / 100)}
                    label={(value) => `${value}%`}
                  />
                </div>
                <div>
                  <Text size="sm" fw={500} mb={12}>
                    Panel opacity · {Math.round(draft.opacity * 100)}%
                  </Text>
                  <Slider
                    aria-label="Panel opacity"
                    value={draft.opacity * 100}
                    min={65}
                    max={100}
                    onChange={(value) => update("opacity", value / 100)}
                    label={(value) => `${value}%`}
                  />
                </div>
                <div>
                  <Text size="sm" fw={500} mb={12}>
                    Panel blur · {draft.blur}px
                  </Text>
                  <Slider
                    aria-label="Panel blur"
                    value={draft.blur}
                    min={0}
                    max={24}
                    onChange={(value) => update("blur", value)}
                    label={(value) => `${value}px`}
                  />
                </div>
                <Switch
                  label="Reduced effects"
                  description="Opaque panels with blur, animation and shadows disabled."
                  checked={draft.reducedEffects}
                  onChange={(event) => update("reducedEffects", event.currentTarget.checked)}
                />
              </SimpleGrid>
              <Text size="xs" c="dimmed">
                Small screens and reduced-motion preferences automatically use reduced effects. Opacity may increase to
                keep text readable against your wallpaper. Uploaded images and the Midnight wallpaper in light mode also
                get a protective overlay that may increase beyond your requested dimming to keep page headings and
                captions readable. System mode applies that protection using its active Graphite or Ivory palette.
              </Text>
              <Button variant="default" onClick={() => change({ ...draft, opacity: 1, blur: 0, reducedEffects: true })}>
                Use opaque, high-readability panels
              </Button>
            </Stack>
          </Tabs.Panel>
          <Tabs.Panel value="interface">
            <Stack gap="lg">
              <div>
                <Text size="sm" fw={500} mb={7}>
                  Typography
                </Text>
                <SegmentedControl
                  fullWidth
                  value={draft.font}
                  data={[
                    { value: "sans", label: "Sans" },
                    { value: "serif", label: "Serif" },
                    { value: "mono", label: "Mono" },
                  ]}
                  onChange={(value) => {
                    if (value === "sans" || value === "serif" || value === "mono") update("font", value);
                  }}
                />
              </div>
              <div>
                <Text size="sm" fw={500} mb={7}>
                  Density
                </Text>
                <SegmentedControl
                  fullWidth
                  value={draft.density}
                  data={[
                    { value: "comfortable", label: "Comfortable" },
                    { value: "compact", label: "Compact" },
                  ]}
                  onChange={(value) => {
                    if (value === "comfortable" || value === "compact") update("density", value);
                  }}
                />
              </div>
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
                <NumberInput
                  label="Font size (px)"
                  value={draft.fontSize}
                  min={12}
                  max={20}
                  allowDecimal={false}
                  onChange={(value) => {
                    if (typeof value === "number") update("fontSize", value);
                  }}
                />
                <NumberInput
                  label="Corner radius (px)"
                  value={draft.radius}
                  min={0}
                  max={24}
                  allowDecimal={false}
                  onChange={(value) => {
                    if (typeof value === "number") update("radius", value);
                  }}
                />
                <NumberInput
                  label="Spacing (px)"
                  value={draft.spacing}
                  min={12}
                  max={32}
                  allowDecimal={false}
                  onChange={(value) => {
                    if (typeof value === "number") update("spacing", value);
                  }}
                />
              </SimpleGrid>
              <Group gap="xl">
                <Switch
                  label="Card borders"
                  checked={draft.borders}
                  onChange={(event) => update("borders", event.currentTarget.checked)}
                />
                <Switch
                  label="Soft shadows"
                  checked={draft.shadow}
                  onChange={(event) => update("shadow", event.currentTarget.checked)}
                />
              </Group>
              <Text size="xs" c="dimmed">
                Dashboard arrangement and sidebar preferences are available in Home’s layout editor.
              </Text>
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Card>
      <Card>
        <Stack gap="md">
          <div>
            <Title order={3}>Your presets</Title>
            <Text size="sm" c="dimmed">
              Keep up to 12 personal themes. Themes contain appearance only.
            </Text>
          </div>
          {presets.length === 0 ? (
            <Text size="sm" c="dimmed">
              No personal presets yet. Tune a theme and give it a name below.
            </Text>
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
              {presets.map((preset) => (
                <div key={preset.name}>
                  <Preset preset={preset} selected={themesEqual(preset, draft)} onSelect={() => selectPreset(preset)} />
                  <Group justify="flex-end" mt={5}>
                    <Tooltip label={`Remove ${preset.name}`}>
                      <ActionIcon
                        aria-label={`Remove preset ${preset.name}`}
                        color="red"
                        variant="subtle"
                        onClick={() => setRemovePreset(preset.name)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </div>
              ))}
            </SimpleGrid>
          )}
          <Group align="flex-end">
            <TextInput
              label="New preset name"
              placeholder="My quiet workspace"
              value={presetName}
              maxLength={60}
              onChange={(event) => setPresetName(event.currentTarget.value)}
              style={{ flex: 1, minWidth: 160 }}
            />
            <Button variant="default" onClick={addPreset} disabled={presets.length >= 12}>
              Add preset
            </Button>
          </Group>
          <Divider />
          <Group>
            <Button
              variant="default"
              leftSection={<IconDownload size={17} />}
              loading={exporting}
              disabled={imageBusy}
              onClick={() => {
                void exportTheme();
              }}
            >
              Export theme
            </Button>
            <FileButton
              resetRef={importReset}
              accept="application/json,.json"
              onChange={(file) => {
                void importTheme(file);
              }}
            >
              {(props) => (
                <Button
                  {...props}
                  variant="default"
                  leftSection={<IconUpload size={17} />}
                  disabled={saving || imageBusy}
                >
                  Import theme
                </Button>
              )}
            </FileButton>
            <Button variant="subtle" leftSection={<IconRefresh size={17} />} onClick={() => setResetOpened(true)}>
              Reset / recover
            </Button>
          </Group>
        </Stack>
      </Card>
      <div className="shiva-appearance-actions">
        <Group justify="space-between" gap="sm">
          <Text size="sm" c="dimmed">
            {changed ? "Preview changes, then save when ready." : "Your saved appearance is active."}
          </Text>
          <Group gap="sm">
            <Button variant="default" onClick={cancel} disabled={saving || !changed}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                void save();
              }}
              loading={saving}
              disabled={!changed || imageBusy}
            >
              Save changes
            </Button>
          </Group>
        </Group>
      </div>
      <Modal
        opened={resetOpened}
        onClose={() => {
          if (!saving) setResetOpened(false);
        }}
        title="Reset appearance"
        size="sm"
      >
        <Stack>
          <Text size="sm">
            Return to the opaque Graphite preset for a readable, calm workspace. Shopping records, layouts and saved
            presets stay intact.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" disabled={saving} onClick={() => setResetOpened(false)}>
              Cancel
            </Button>
            <Button
              loading={saving}
              onClick={() => {
                void save({ ...graphiteTheme }, presets);
              }}
            >
              Reset to Graphite
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={removePreset !== null} onClose={() => setRemovePreset(null)} title="Remove saved preset" size="sm">
        <Stack>
          <Text size="sm">Remove “{removePreset}” from your draft? Save changes to confirm the removal.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setRemovePreset(null)}>
              Keep preset
            </Button>
            <Button
              color="red"
              onClick={() => {
                setPresets(presets.filter((preset) => preset.name !== removePreset));
                setRemovePreset(null);
                setNotice("Preset removed from your draft. Save changes to keep this change.");
              }}
            >
              Remove preset
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={removeAsset !== null}
        onClose={() => {
          if (!deletingAsset) setRemoveAsset(null);
        }}
        title="Delete uploaded wallpaper"
        size="sm"
      >
        <Stack>
          <Text size="sm">
            Permanently delete this unused image from your wallpaper library? You can upload it again from the original
            file.
          </Text>
          {libraryError && (
            <Alert color="red" role="alert">
              {libraryError}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" disabled={deletingAsset} onClick={() => setRemoveAsset(null)}>
              Keep image
            </Button>
            <Button
              color="red"
              loading={deletingAsset}
              disabled={removeAsset !== null && assetInUse(removeAsset)}
              onClick={() => {
                void deleteWallpaper();
              }}
            >
              Delete image
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
