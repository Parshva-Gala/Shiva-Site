// SHIVA extension, Apache-2.0.
"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ActionIcon, Alert, Badge, Button, Checkbox, Group, FocusTrap, Loader, Stack, Text } from "@mantine/core";
import {
  IconArrowUpRight,
  IconCalendar,
  IconCheck,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconHeart,
  IconHome,
  IconInbox,
  IconLayoutSidebarLeftCollapse,
  IconMenu2,
  IconPalette,
  IconPlugConnected,
  IconSettings,
  IconShoppingBag,
  IconTarget,
  IconWallet,
  IconBook,
  IconListCheck,
  IconLock,
  IconLogout,
  IconX,
} from "@tabler/icons-react";
import { useFocusReturn } from "@mantine/hooks";
import type { RouterOutputs } from "@homarr/api";
import { clientApi } from "@homarr/api/client";
import { signOut } from "@homarr/auth/client";
import { graphiteTheme } from "@homarr/validation/shiva";
import type { ShivaLayout, ShivaSettings, ShivaTheme } from "@homarr/validation/shiva";
import { ShivaThemeProvider } from "./theme";
// eslint-disable-next-line import/no-unassigned-import -- scoped Next.js application styles
import "./shell.css";

const loadingModule = () => (
  <Group py="xl">
    <Loader size="sm" />
    <Text>Opening this page…</Text>
  </Group>
);
const Appearance = dynamic(() => import("./appearance").then((module) => module.Appearance), {
  loading: loadingModule,
});
const Shopping = dynamic(() => import("./shopping").then((module) => module.Shopping), { loading: loadingModule });
const LayoutEditor = dynamic(() => import("./layout-editor").then((module) => module.LayoutEditor), {
  loading: loadingModule,
});

const navigation = [
  { id: "home", name: "Home", icon: IconHome },
  { id: "vision", name: "SHIVA", icon: IconTarget },
  { id: "tasks", name: "Tasks", icon: IconListCheck },
  { id: "calendar", name: "Calendar", icon: IconCalendar },
  { id: "health", name: "Health", icon: IconHeart },
  { id: "finance", name: "Finance", icon: IconWallet },
  { id: "shopping", name: "Shopping", icon: IconShoppingBag },
  { id: "knowledge", name: "Knowledge", icon: IconBook },
  { id: "inbox", name: "Inbox", icon: IconInbox },
  { id: "settings/appearance", name: "Settings", icon: IconSettings },
];
const href = (id: string) => (id === "home" ? "/shiva" : `/shiva/${id}`);

interface ShivaAppProps {
  page: string;
  initialSettings?: RouterOutputs["shiva"]["settings"];
  initialShoppingSummary?: RouterOutputs["shiva"]["shoppingSummary"];
  initialTodayLabel: string;
}

export function ShivaApp({ page, initialSettings, initialShoppingSummary, initialTodayLabel }: ShivaAppProps) {
  const settingsQuery = clientApi.shiva.settings.useQuery(undefined, {
    initialData: initialSettings,
    refetchOnWindowFocus: false,
  });
  const utils = clientApi.useUtils();
  const save = clientApi.shiva.saveSettings.useMutation();
  const [preview, setPreview] = useState<ShivaTheme | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [failure, setFailure] = useState("");
  const safe = useSearchParams().get("safe") === "1";
  const settings = settingsQuery.data;
  useFocusReturn({ opened: mobileNav });
  useEffect(() => {
    setPreview(null);
    setMobileNav(false);
  }, [page]);
  useEffect(() => {
    if (!mobileNav) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNav(false);
    };
    globalThis.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      globalThis.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileNav]);
  const update = async (next: ShivaSettings) => {
    setFailure("");
    try {
      if (!settings) throw new Error("Settings are still loading.");
      const { theme, privacy, layout, presets, savedLayouts } = next;
      const saved = await save.mutateAsync({
        theme,
        privacy,
        layout,
        presets,
        savedLayouts,
        revision: settings.revision,
      });
      utils.shiva.settings.setData(undefined, saved);
    } catch (error) {
      const conflict = error instanceof Error && error.message.includes("changed");
      setFailure(
        conflict
          ? "Settings changed in another tab. Refresh the saved settings, then reapply your changes."
          : "Your changes could not be saved. Check the local server and try again.",
      );
      if (conflict) await utils.shiva.settings.invalidate();
      throw new Error("Settings were not saved.", { cause: error });
    }
  };
  const persist = (next: ShivaSettings) => {
    void update(next).catch(() => undefined);
  };
  if (!settings)
    return (
      <main className="shiva-loading">
        <h1>SHIVA</h1>
        {settingsQuery.isError ? (
          <Alert title="Settings unavailable" color="red">
            Check the local server and database. <Button onClick={() => void settingsQuery.refetch()}>Retry</Button>
          </Alert>
        ) : (
          <Group>
            <Loader size="sm" />
            <Text>Opening your workspace…</Text>
          </Group>
        )}
      </main>
    );
  const current = navigation.find(
    (item) => item.id === page || (item.id.startsWith("settings") && page.startsWith("settings")),
  );
  const sidebar = settings.layout.sidebar;
  return (
    <ShivaThemeProvider theme={safe ? graphiteTheme : (preview ?? settings.theme)}>
      <div className={`shiva-shell sidebar-${sidebar} ${mobileNav ? "nav-open" : ""}`}>
        <a className="shiva-skip" href="#shiva-content">
          Skip to content
        </a>
        <FocusTrap active={mobileNav}>
          <aside id="shiva-navigation" className="shiva-sidebar" aria-label="Main navigation">
            <ActionIcon
              className="shiva-nav-close"
              variant="subtle"
              aria-label="Close navigation"
              onClick={() => setMobileNav(false)}
            >
              <IconX size={20} />
            </ActionIcon>
            <Link href="/shiva" className="shiva-brand">
              <span className="shiva-mark">
                S<span />
              </span>
              <span className="nav-label">
                <strong>SHIVA</strong>
                <small>PERSONAL WORKSPACE</small>
              </span>
            </Link>
            <div className="nav-group-label nav-label">WORKSPACE</div>
            <nav>
              {navigation.map(({ id, name, icon: Icon }) => (
                <Link
                  key={id}
                  href={href(id)}
                  title={name}
                  className={`shiva-nav-link ${current?.id === id ? "active" : ""}`}
                  aria-current={current?.id === id ? "page" : undefined}
                >
                  <Icon size={19} stroke={1.6} />
                  <span className="nav-label">{name}</span>
                  {id === "shopping" && <span className="nav-label nav-native">NATIVE</span>}
                </Link>
              ))}
            </nav>
            <div className="shiva-sidebar-footer">
              <Link
                href="/manage"
                className="shiva-nav-link"
                title="Homarr administration"
                aria-label="Homarr administration"
              >
                <IconSettings size={18} />
                <span className="nav-label">
                  Homarr administration
                  <IconArrowUpRight size={13} />
                </span>
              </Link>
              <button
                className="shiva-nav-link"
                onClick={() => void signOut({ callbackUrl: "/auth/login" })}
                title="Sign out"
                aria-label="Sign out"
              >
                <IconLogout size={18} />
                <span className="nav-label">Sign out</span>
              </button>
              <div className="shiva-owner nav-label">
                <span className="owner-avatar">S</span>
                <div>
                  <strong>Personal space</strong>
                  <small>Asia/Kolkata · INR</small>
                </div>
                <span className="online-dot" title="Local instance" />
              </div>
            </div>
          </aside>
        </FocusTrap>
        {mobileNav && (
          <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />
        )}
        <div className="shiva-main" inert={mobileNav || undefined}>
          <header className="shiva-header">
            <Group gap="sm">
              <ActionIcon
                variant="subtle"
                aria-label="Toggle navigation"
                aria-expanded={mobileNav || sidebar === "expanded"}
                aria-controls="shiva-navigation"
                disabled={save.isPending}
                onClick={() => {
                  if (window.innerWidth < 800) setMobileNav(!mobileNav);
                  else
                    persist({
                      ...settings,
                      layout: { ...settings.layout, sidebar: sidebar === "expanded" ? "icons" : "expanded" },
                    });
                }}
              >
                <IconMenu2 size={20} />
              </ActionIcon>
              <span className="header-breadcrumb">
                Workspace <IconChevronRight size={14} />{" "}
                <strong>{current?.name ?? (page === "settings/integrations" ? "Settings" : "Page")}</strong>
              </span>
            </Group>
            <Group gap="sm">
              <span className="local-label">
                <span className="online-dot" />
                Local instance
              </span>
              <ActionIcon
                variant="subtle"
                aria-label={settings.privacy ? "Show sensitive content" : "Hide sensitive content"}
                title={settings.privacy ? "Privacy on" : "Hide sensitive content"}
                disabled={save.isPending}
                onClick={() => persist({ ...settings, privacy: !settings.privacy })}
              >
                {settings.privacy ? <IconEyeOff size={19} /> : <IconEye size={19} />}
              </ActionIcon>
              <Link href="/shiva/settings/appearance" className="header-appearance" title="Appearance">
                <IconPalette size={19} />
              </Link>
            </Group>
          </header>
          <main id="shiva-content" className="shiva-content" tabIndex={-1}>
            {failure && (
              <Alert color="red" mb="md" title="Save failed" withCloseButton onClose={() => setFailure("")}>
                {failure}
              </Alert>
            )}
            {settings.recoveryWarning && (
              <Alert color="yellow" mb="md" title="Settings recovered">
                Saved appearance settings could not be read. Safe defaults are active; your Shopping records and
                original settings are preserved. Review Appearance and save a readable preset to recover.
              </Alert>
            )}
            {settings.privacy && (
              <div className="privacy-banner">
                <IconEyeOff size={15} /> Sensitive content is hidden. This is a display control; your records are
                unchanged.
              </div>
            )}
            {safe && (
              <Alert title="Safe appearance mode" mb="md">
                Graphite is active for this visit.{" "}
                <Button
                  size="xs"
                  ml="sm"
                  onClick={() => {
                    void update({ ...settings, theme: graphiteTheme })
                      .then(() => {
                        window.location.href = href(page);
                      })
                      .catch(() => undefined);
                  }}
                >
                  Save readable defaults
                </Button>
              </Alert>
            )}
            {page === "home" ? (
              <Home
                settings={settings}
                onUpdate={update}
                saving={save.isPending}
                initialShoppingSummary={initialShoppingSummary}
                todayLabel={initialTodayLabel}
              />
            ) : page === "shopping" ? (
              <Shopping privacy={settings.privacy} />
            ) : page.startsWith("settings") ? (
              <>
                <div className="page-heading">
                  <div className="eyebrow">YOUR WORKSPACE, YOUR WAY</div>
                  <h1>Settings</h1>
                  <p>Make this space work for you.</p>
                </div>
                <div className="settings-tabs">
                  <Link
                    href="/shiva/settings/appearance"
                    aria-current={page !== "settings/integrations" ? "page" : undefined}
                  >
                    <IconPalette size={17} />
                    Appearance
                  </Link>
                  <Link
                    href="/shiva/settings/integrations"
                    aria-current={page === "settings/integrations" ? "page" : undefined}
                  >
                    <IconPlugConnected size={17} />
                    Integrations
                  </Link>
                </div>
                {page === "settings/integrations" ? (
                  <Integrations />
                ) : (
                  <Appearance
                    settings={settings}
                    onPreview={setPreview}
                    onSave={async (theme, presets) => {
                      await update({ ...settings, theme, presets });
                      setPreview(null);
                    }}
                  />
                )}
              </>
            ) : (
              <Planned page={page} />
            )}
            <footer className="shiva-page-footer">
              <span>
                SHIVA <span className="footer-dot">/</span> Personal workspace · Asia/Kolkata
              </span>
              <span>Foundation · Built on Homarr 2.1.2</span>
            </footer>
          </main>
        </div>
      </div>
    </ShivaThemeProvider>
  );
}

function Home({
  settings,
  onUpdate,
  saving,
  initialShoppingSummary,
  todayLabel,
}: {
  settings: ShivaSettings;
  onUpdate: (settings: ShivaSettings) => Promise<void>;
  saving: boolean;
  initialShoppingSummary?: RouterOutputs["shiva"]["shoppingSummary"];
  todayLabel: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ShivaLayout>(settings.layout);
  const [name, setName] = useState("");
  const [done, setDone] = useState<string[]>([]);
  const [error, setError] = useState("");
  const shopping = clientApi.shiva.shoppingSummary.useQuery(undefined, { initialData: initialShoppingSummary });
  const layout = editing ? draft : settings.layout;
  const saveLayout = async () => {
    try {
      await onUpdate({ ...settings, layout: draft });
      setEditing(false);
    } catch {
      setError("Layout could not be saved.");
    }
  };
  return (
    <>
      <div className="home-heading">
        <div>
          <div className="eyebrow">
            {todayLabel} <span>IST</span>
          </div>
          <h1>Today, at a glance</h1>
          <p>Priorities, commitments and purchase planning.</p>
        </div>
        <Button
          variant="default"
          leftSection={editing ? <IconLock size={16} /> : <IconLayoutSidebarLeftCollapse size={16} />}
          onClick={() => {
            if (editing) void saveLayout();
            else {
              setDraft(settings.layout);
              setEditing(true);
            }
          }}
          loading={saving}
        >
          {editing ? "Save & lock layout" : "Edit layout"}
        </Button>
      </div>
      <div className="demo-notice">
        <span className="demo-tag">SAMPLE OVERVIEW</span>
        <span>Priorities, task previews and agenda below are examples. Shopping reflects your saved records.</span>
      </div>
      {editing && (
        <LayoutEditor
          draft={draft}
          setDraft={setDraft}
          settings={settings}
          name={name}
          onNameChange={setName}
          error={error}
          onError={setError}
          onUpdate={onUpdate}
          onCancel={() => setEditing(false)}
        />
      )}
      <div className="home-grid">
        {layout.widgets
          .filter((w) => w.visible)
          .map((widget) => (
            <section key={widget.id} className={`shiva-card home-card width-${widget.width}`} data-widget={widget.id}>
              {widget.id === "priorities" ? (
                <>
                  <div className="card-heading">
                    <div>
                      <div className="eyebrow">FOCUS</div>
                      <h2>Today's priorities</h2>
                    </div>
                    <Badge variant="light">Sample · personal</Badge>
                  </div>
                  <div className="priority-feature">
                    <span className="priority-number">01</span>
                    <div>
                      <h3>{settings.privacy ? "Hidden priority" : "Build a consistent weekly planning routine"}</h3>
                      <p>
                        {settings.privacy
                          ? "Sensitive content is hidden"
                          : "Outcome: a sustainable routine. Project: simplify the weekly plan."}
                      </p>
                      <div className="subtle-chips">
                        <span>Outcome</span>
                        <IconChevronRight size={12} />
                        <span>Project</span>
                        <IconChevronRight size={12} />
                        <span>Next action</span>
                      </div>
                    </div>
                    <IconTarget className="feature-icon" size={42} stroke={1} />
                  </div>
                  <div className="priority-next">
                    <IconCheck size={17} />
                    <span>
                      {settings.privacy ? "Hidden next action" : "Next action: choose three priorities for the week"}
                    </span>
                    <Badge color="gray" variant="outline">
                      Example
                    </Badge>
                  </div>
                  <Link className="card-link" href="/shiva/vision">
                    Open SHIVA planning <IconArrowUpRight size={15} />
                  </Link>
                </>
              ) : null}
              {widget.id === "agenda" ? (
                <>
                  <div className="card-heading">
                    <h2>
                      <IconCalendar size={19} />
                      Agenda
                    </h2>
                    <span className="sample-label">SAMPLE</span>
                  </div>
                  <div className="agenda-row">
                    <span className="agenda-time">09:30</span>
                    <span className="agenda-rule appointment" />
                    <div>
                      <strong>{settings.privacy ? "Hidden appointment" : "Weekly planning"}</strong>
                      <small>Appointment · sample calendar · IST</small>
                    </div>
                  </div>
                  <div className="agenda-row">
                    <span className="agenda-time">17:00</span>
                    <span className="agenda-rule deadline" />
                    <div>
                      <strong>{settings.privacy ? "Hidden deadline" : "Review project outline"}</strong>
                      <small>Task deadline · not booked time</small>
                    </div>
                  </div>
                  <div className="agenda-row">
                    <span className="agenda-time">18:30</span>
                    <span className="agenda-rule appointment" />
                    <div>
                      <strong>{settings.privacy ? "Hidden commitment" : "Evening walk"}</strong>
                      <small>Planned time · completion not recorded</small>
                    </div>
                  </div>
                  <Link className="card-link" href="/shiva/calendar">
                    Calendar connection planned <IconArrowUpRight size={15} />
                  </Link>
                </>
              ) : null}
              {widget.id === "tasks" ? (
                <>
                  <div className="card-heading">
                    <h2>
                      <IconListCheck size={19} />
                      Task preview
                    </h2>
                    <span className="sample-label">SAMPLE</span>
                  </div>
                  {[
                    { id: "one", text: "Review this week's priorities", context: "Personal" },
                    { id: "two", text: "Prepare the project checklist", context: "Professional · fictional" },
                    { id: "three", text: "Compare desk lighting options", context: "Personal" },
                  ].map((task) => (
                    <div className="task-row" key={task.id}>
                      <Checkbox
                        aria-label={`Toggle sample task ${task.id}`}
                        checked={done.includes(task.id)}
                        onChange={() =>
                          setDone(done.includes(task.id) ? done.filter((id) => id !== task.id) : [...done, task.id])
                        }
                      />
                      <div>
                        <strong className={done.includes(task.id) ? "completed" : ""}>
                          {settings.privacy ? "Hidden task" : task.text}
                        </strong>
                        <small>{task.context}</small>
                      </div>
                    </div>
                  ))}
                  <p className="card-footnote">Checkboxes only change this sample preview. ClickUp is not connected.</p>
                </>
              ) : null}
              {widget.id === "shopping" ? (
                <>
                  <div className="card-heading">
                    <h2>
                      <IconShoppingBag size={19} />
                      Purchase planning
                    </h2>
                    <Badge color="gray" variant="light">
                      Your records
                    </Badge>
                  </div>
                  {shopping.isError ? (
                    <Alert color="red">
                      Shopping unavailable.{" "}
                      <Button size="xs" onClick={() => void shopping.refetch()}>
                        Retry
                      </Button>
                    </Alert>
                  ) : shopping.isPending ? (
                    <Loader size="sm" />
                  ) : (
                    <>
                      <div className="shopping-metric">
                        {settings.privacy ? "••" : shopping.data.active}
                        <span>items being considered</span>
                      </div>
                      <p className="card-description">Keep requirements, research and estimated costs in one place.</p>
                      <Link className="card-link" href="/shiva/shopping">
                        {shopping.data.total ? "Review your list" : "Plan your first purchase"}
                        <IconArrowUpRight size={15} />
                      </Link>
                    </>
                  )}
                </>
              ) : null}
              {widget.id === "connections" ? (
                <>
                  <div className="card-heading">
                    <div>
                      <div className="eyebrow">YOUR SOURCES</div>
                      <h2>Bring your tools together</h2>
                    </div>
                    <Link className="card-link" href="/shiva/settings/integrations">
                      Integrations
                      <IconArrowUpRight size={15} />
                    </Link>
                  </div>
                  <div className="source-grid">
                    {["ClickUp", "Calendar", "Excel", "Obsidian"].map((sourceName) => (
                      <div className="source-item" key={sourceName}>
                        <span className="source-initial">{sourceName.slice(0, 1)}</span>
                        <div>
                          <strong>{sourceName}</strong>
                          <small>
                            <span className="status-dot" />
                            Not configured
                          </small>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="card-footnote">
                    Your tools keep ownership of their records. No credentials are needed for this foundation.
                  </p>
                </>
              ) : null}
            </section>
          ))}
      </div>
      {layout.widgets.every((w) => !w.visible) && (
        <div className="shiva-card empty-home">
          <h2>A quiet canvas</h2>
          <p>Use Edit layout to show the cards you want.</p>
        </div>
      )}
    </>
  );
}

const connectors = [
  { name: "ClickUp", owner: "Tasks", next: "Read-only personal and professional task viewing.", milestone: 2 },
  {
    name: "Calendar",
    owner: "Appointments & invitations",
    next: "Consolidated agenda with source IDs, recurrence and time zones.",
    milestone: 2,
  },
  {
    name: "Excel",
    owner: "Financial records & calculations",
    next: "Explicit JSON/CSV import of saved, calculated summary results.",
    milestone: 4,
  },
  {
    name: "Obsidian",
    owner: "Notes & research",
    next: "Selected vault links or an approved local index.",
    milestone: 4,
  },
  { name: "Email", owner: "Messages", next: "Selected actionable metadata through official access.", milestone: 5 },
  {
    name: "WhatsApp",
    owner: "Messages",
    next: "Evaluate official account support or selective capture.",
    milestone: 5,
  },
  {
    name: "Notion",
    owner: "Optional source",
    next: "Optional read/import path; no automatic migration.",
    milestone: 5,
  },
];
function Integrations() {
  return (
    <>
      <div className="shiva-card integration-intro">
        <IconPlugConnected size={28} stroke={1.4} />
        <div>
          <h2>Connections begin with a verified source</h2>
          <p>Connectors are planned. No keys are saved, and no external records are requested by SHIVA.</p>
        </div>
      </div>
      <div className="integration-grid">
        {connectors.map((connector) => (
          <section className="shiva-card" key={connector.name}>
            <Group justify="space-between">
              <h2>{connector.name}</h2>
              <Badge color="gray" variant="outline">
                Not configured
              </Badge>
            </Group>
            <p className="owner-label">Owns: {connector.owner}</p>
            <p>{connector.next}</p>
            <div className="integration-bottom">
              Planned · milestone {connector.milestone}
              <span>Last refresh: never</span>
            </div>
          </section>
        ))}
      </div>
      <div className="shiva-card status-reference">
        <h2>Connection states</h2>
        <p>
          Future connectors will distinguish Not configured, Unverified, Connected, Syncing, Stale or offline, Failed,
          and Demo data. Connected will require a successful verification.
        </p>
      </div>
    </>
  );
}
function Planned({ page }: { page: string }) {
  const detail: Record<string, { title: string; icon: typeof IconTarget; description: string; points: string[] }> = {
    vision: {
      title: "SHIVA",
      icon: IconTarget,
      description: "A place for your direction, priorities and daily practice.",
      points: [
        "Outcomes describe what you want to achieve.",
        "Projects support outcomes; tasks are individual actions.",
        "Routines repeat. Scheduled commitments reserve actual time.",
        "Goals, daily planning and reviews are planned for milestone 3.",
      ],
    },
    tasks: {
      title: "Tasks",
      icon: IconListCheck,
      description: "Your ClickUp tasks, with personal and professional contexts kept clear.",
      points: [
        "ClickUp remains the source of truth.",
        "Read-only viewing is planned for milestone 2.",
        "Context, client, project, status and due-date filters will follow a verified connection.",
      ],
    },
    calendar: {
      title: "Calendar",
      icon: IconCalendar,
      description: "Appointments and deadlines in one agenda, with their differences preserved.",
      points: [
        "Calendar providers own appointments and invitations.",
        "Task deadlines never become booked appointments automatically.",
        "Source calendars, time zones, all-day events and recurrence will be preserved.",
      ],
    },
    health: {
      title: "Health",
      icon: IconHeart,
      description: "Workout plans, session logs and straightforward progress.",
      points: [
        "Scheduling a workout does not record its completion.",
        "Workout logging and adherence are planned for milestone 3.",
        "No invented medical scores.",
      ],
    },
    finance: {
      title: "Finance",
      icon: IconWallet,
      description: "Selected summaries from your Excel finance manager.",
      points: [
        "Excel owns financial calculations and transaction records.",
        "A selected JSON/CSV summary import is planned for milestone 4.",
        "No workbook upload, macro execution or formula recalculation is assumed.",
      ],
    },
    knowledge: {
      title: "Knowledge",
      icon: IconBook,
      description: "Find your way into Obsidian, where your detailed notes belong.",
      points: [
        "Selected vault/note links and an approved index are planned for milestone 4.",
        "This server cannot access your Windows vault without an approved bridge.",
        "Detailed note-taking remains in Obsidian.",
      ],
    },
    inbox: {
      title: "Inbox",
      icon: IconInbox,
      description: "A selected collection of messages and captured items that need action.",
      points: [
        "Selected email capture is planned for milestone 5.",
        "No automatic send, reply, deletion or archiving.",
        "WhatsApp requires a separate official API evaluation.",
      ],
    },
  };
  const item = detail[page];
  if (!item)
    return (
      <section className="shiva-card">
        <h1>Page not found</h1>
        <Link className="card-link" href="/shiva">
          Return Home
        </Link>
      </section>
    );
  const Icon = item.icon;
  return (
    <>
      <div className="page-heading">
        <div className="eyebrow">PERSONAL WORKSPACE</div>
        <h1>{item.title}</h1>
        <p>{item.description}</p>
      </div>
      <section className="shiva-card planned-state">
        <span className="planned-icon">
          <Icon size={36} stroke={1.2} />
        </span>
        <Badge color="gray" variant="outline">
          {["vision", "health"].includes(page) ? "Planned module" : "Not configured"}
        </Badge>
        <h2>A foundation for the next step</h2>
        <Stack gap="sm">
          {item.points.map((point) => (
            <p key={point}>{point}</p>
          ))}
        </Stack>
        <Link className="card-link" href="/shiva/settings/integrations">
          View integration plan <IconArrowUpRight size={15} />
        </Link>
      </section>
    </>
  );
}
