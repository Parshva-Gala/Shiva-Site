// SHIVA extension, Apache-2.0. Load editing controls only when a layout is unlocked.
"use client";

import type { Dispatch, SetStateAction } from "react";
import { ActionIcon, Alert, Button, Checkbox, Group, Select, TextInput } from "@mantine/core";
import { IconArrowDown, IconArrowUp } from "@tabler/icons-react";

import { defaultLayout } from "@homarr/validation/shiva";
import type { ShivaLayout, ShivaSettings } from "@homarr/validation/shiva";

const widgetLabels: Record<string, string> = {
  priorities: "Today's priorities",
  agenda: "Agenda",
  tasks: "Task preview",
  shopping: "Shopping summary",
  connections: "Sources",
};

interface LayoutEditorProps {
  draft: ShivaLayout;
  setDraft: Dispatch<SetStateAction<ShivaLayout>>;
  settings: ShivaSettings;
  name: string;
  onNameChange: (name: string) => void;
  error: string;
  onError: (error: string) => void;
  onUpdate: (settings: ShivaSettings) => Promise<void>;
  onCancel: () => void;
}

export function LayoutEditor({
  draft,
  setDraft,
  settings,
  name,
  onNameChange,
  error,
  onError,
  onUpdate,
  onCancel,
}: LayoutEditorProps) {
  const move = (index: number, delta: number) => {
    const widgets = [...draft.widgets];
    const target = index + delta;
    if (target < 0 || target >= widgets.length) return;
    const original = widgets[index];
    const destination = widgets[target];
    if (!original || !destination) return;
    widgets[index] = destination;
    widgets[target] = original;
    setDraft({ ...draft, widgets });
  };
  return (
    <section className="shiva-card layout-editor">
      <Group justify="space-between">
        <h2>Layout preferences</h2>
        <Button variant="subtle" onClick={onCancel}>
          Cancel
        </Button>
      </Group>
      <p>Use the arrow buttons to reorder cards. Changes stay in preview until you save.</p>
      <Select
        label="Sidebar"
        value={draft.sidebar}
        data={[
          { value: "expanded", label: "Expanded" },
          { value: "icons", label: "Icons only" },
          { value: "hidden", label: "Hidden" },
        ]}
        onChange={(value) => {
          if (value) setDraft({ ...draft, sidebar: value as ShivaLayout["sidebar"] });
        }}
      />
      {draft.widgets.map((widget, index) => (
        <div className="layout-row" key={widget.id}>
          <Checkbox
            label={widgetLabels[widget.id]}
            checked={widget.visible}
            onChange={(event) =>
              setDraft({
                ...draft,
                widgets: draft.widgets.map((w) =>
                  w.id === widget.id ? { ...w, visible: event.currentTarget.checked } : w,
                ),
              })
            }
          />
          <Group gap="xs">
            <ActionIcon
              variant="default"
              aria-label={`Move ${widgetLabels[widget.id]} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <IconArrowUp size={16} />
            </ActionIcon>
            <ActionIcon
              variant="default"
              aria-label={`Move ${widgetLabels[widget.id]} down`}
              disabled={index === draft.widgets.length - 1}
              onClick={() => move(index, 1)}
            >
              <IconArrowDown size={16} />
            </ActionIcon>
            <Select
              aria-label={`${widgetLabels[widget.id]} width`}
              w={130}
              data={[
                { value: "normal", label: "Half width" },
                { value: "wide", label: "Full width" },
              ]}
              value={widget.width}
              onChange={(value) =>
                setDraft({
                  ...draft,
                  widgets: draft.widgets.map((w) =>
                    w.id === widget.id ? { ...w, width: value as "normal" | "wide" } : w,
                  ),
                })
              }
            />
          </Group>
        </div>
      ))}
      <Group mt="md">
        <TextInput
          aria-label="Layout name"
          placeholder="Name this layout"
          value={name}
          maxLength={60}
          onChange={(event) => onNameChange(event.currentTarget.value)}
        />
        <Button
          variant="default"
          disabled={!name.trim() || settings.savedLayouts.length >= 8}
          onClick={() => {
            void onUpdate({
              ...settings,
              savedLayouts: [...settings.savedLayouts, { name: name.trim(), layout: draft }],
            })
              .then(() => onNameChange(""))
              .catch(() => onError("Layout preset could not be saved."));
          }}
        >
          Save layout preset
        </Button>
        <Button variant="subtle" onClick={() => setDraft(defaultLayout)}>
          Reset preview
        </Button>
      </Group>
      {settings.savedLayouts.length > 0 && (
        <Group mt="sm">
          {settings.savedLayouts.map((saved, index) => (
            <Button key={`${saved.name}-${index}`} variant="light" onClick={() => setDraft(saved.layout)}>
              {saved.name}
            </Button>
          ))}
        </Group>
      )}
      {error && (
        <Alert color="red" mt="sm">
          {error}
        </Alert>
      )}
    </section>
  );
}
