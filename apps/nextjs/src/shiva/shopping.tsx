"use client";

import { useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import {
  IconAlertCircle,
  IconArrowUpRight,
  IconCheck,
  IconEdit,
  IconLock,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconShoppingBag,
  IconTrash,
} from "@tabler/icons-react";

import { clientApi } from "@homarr/api/client";
import type { RouterOutputs } from "@homarr/api";
import { SAFE_NEW_TAB_REL } from "@homarr/common";
import { shoppingInputSchema, shoppingStages } from "@homarr/validation/shiva";
import type { ShoppingInput } from "@homarr/validation/shiva";

import "./shopping.css"; // oxlint-disable-line import/no-unassigned-import -- Load isolated SHIVA shopping styles.

type ShoppingListItem = RouterOutputs["shiva"]["shoppingList"]["items"][number];
type ShoppingDraft = Omit<ShoppingInput, "estimatedPrice"> & { estimatedPrice: number | string };
type FieldErrors = Partial<Record<keyof ShoppingInput, string>>;

const stageLabels: Record<ShoppingInput["stage"], string> = {
  considering: "Considering",
  researching: "Researching",
  shortlisted: "Shortlisted",
  budgeted: "Budgeted",
  purchased: "Purchased",
};
const priorities = [
  { value: "high", label: "High priority" },
  { value: "medium", label: "Medium priority" },
  { value: "low", label: "Low priority" },
];
const stageOptions = shoppingStages.map((value) => ({ value, label: stageLabels[value] }));
const emptyDraft: ShoppingDraft = {
  name: "",
  category: "General",
  priority: "medium",
  estimatedPrice: "",
  currency: "INR",
  stage: "considering",
  notes: "",
  url: "",
};
const emptyRecords: ShoppingListItem[] = [];
const pageSize = 30;
const currencies: ShoppingInput["currency"][] = ["INR", "USD", "EUR", "GBP"];

function estimatedPrice(value: number | null, currency: ShoppingInput["currency"]) {
  if (value === null) return "Not estimated";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Server messages may contain source details; expose a useful, bounded message instead. */
function saveError(error: unknown) {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = error.data;
    if (typeof data === "object" && data !== null && "code" in data && data.code === "UNAUTHORIZED") {
      return "Your session expired. Sign in again before saving your changes.";
    }
  }
  return "Could not save this item. Your changes are still here; try again.";
}

export function Shopping({ privacy }: { privacy: boolean }) {
  const utils = clientApi.useUtils();
  const create = clientApi.shiva.shoppingCreate.useMutation();
  const update = clientApi.shiva.shoppingUpdate.useMutation();
  const remove = clientApi.shiva.shoppingDelete.useMutation();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [priority, setPriority] = useState("all");
  const [stage, setStage] = useState("all");
  const [page, setPage] = useState(1);
  const [debouncedSearch] = useDebouncedValue(search.trim(), 250);
  const query = clientApi.shiva.shoppingList.useQuery(
    {
      limit: pageSize,
      offset: (page - 1) * pageSize,
      search: debouncedSearch || undefined,
      category: category === "all" ? undefined : category.slice("category:".length),
      priority: priority === "all" ? undefined : (priority as ShoppingInput["priority"]),
      stage: stage === "all" ? undefined : (stage as ShoppingInput["stage"]),
    },
    { retry: 1, staleTime: 30_000 },
  );
  const summary = clientApi.shiva.shoppingSummary.useQuery(undefined, { retry: 1, staleTime: 30_000 });
  const categories = clientApi.shiva.shoppingCategories.useQuery(undefined, { retry: 1, staleTime: 60_000 });
  const [opened, setOpened] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<ShoppingDraft>(emptyDraft);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailFailed, setDetailFailed] = useState(false);
  const [deleting, setDeleting] = useState<ShoppingListItem | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const saveInProgress = useRef(false);
  const deleteInProgress = useRef(false);
  const detailRequest = useRef(0);
  const records = query.data?.items ?? emptyRecords;
  const categoryOptions = useMemo(
    () => [
      { value: "all", label: "All categories" },
      ...(categories.data ?? []).map((value, index) => ({
        value: `category:${value}`,
        label: privacy ? `Category ${index + 1}` : value,
      })),
    ],
    [categories.data, privacy],
  );
  const filtered = Boolean(search.trim() || category !== "all" || priority !== "all" || stage !== "all");
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / pageSize));
  const searching = search.trim() !== debouncedSearch;
  const budgetedCurrencies = currencies.filter(
    (currency) => (summary.data?.budgetedMinorByCurrency[currency] ?? 0) > 0,
  );

  function closeEditor() {
    if (saving) return;
    detailRequest.current += 1;
    setOpened(false);
  }

  function refreshShopping() {
    void Promise.all([
      utils.shiva.shoppingList.invalidate(),
      utils.shiva.shoppingSummary.invalidate(),
      utils.shiva.shoppingCategories.invalidate(),
      utils.shiva.shoppingDetail.invalidate(),
    ]);
  }

  function change<K extends keyof ShoppingDraft>(key: K, value: ShoppingDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setFormError("");
  }

  function startCreate() {
    detailRequest.current += 1;
    setEditing(null);
    setDetailLoading(false);
    setDetailFailed(false);
    setDraft({ ...emptyDraft });
    setErrors({});
    setFormError("");
    setOpened(true);
  }

  async function loadDetails(id: string) {
    const request = ++detailRequest.current;
    setDetailLoading(true);
    setDetailFailed(false);
    setFormError("");
    try {
      const row = await utils.shiva.shoppingDetail.fetch({ id }, { staleTime: 0 });
      if (request !== detailRequest.current) return;
      setDraft({
        name: row.name,
        category: row.category,
        priority: row.priority,
        estimatedPrice: row.estimatedPrice ?? "",
        currency: row.currency,
        stage: row.stage,
        notes: row.notes,
        url: row.url,
      });
    } catch {
      if (request !== detailRequest.current) return;
      setDetailFailed(true);
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  }

  function startEdit(row: ShoppingListItem) {
    setEditing(row.id);
    setErrors({});
    setFormError("");
    setOpened(true);
    void loadDetails(row.id);
  }

  function clearFilters() {
    setSearch("");
    setCategory("all");
    setPriority("all");
    setStage("all");
    setPage(1);
  }

  async function save() {
    if (saveInProgress.current || detailLoading || detailFailed) return;
    const parsed = shoppingInputSchema.safeParse({
      ...draft,
      estimatedPrice: draft.estimatedPrice === "" ? null : Number(draft.estimatedPrice),
    });
    if (!parsed.success) {
      const nextErrors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ShoppingInput;
        nextErrors[key] ??= issue.message;
      }
      setErrors(nextErrors);
      setFormError("Check the highlighted fields before saving.");
      if (nextErrors.name) nameRef.current?.focus();
      return;
    }
    saveInProgress.current = true;
    setSaving(true);
    setFormError("");
    try {
      if (editing) await update.mutateAsync({ id: editing, data: parsed.data });
      else await create.mutateAsync(parsed.data);
      setOpened(false);
      setAnnouncement(editing ? "Item updated." : "Item added.");
      if (!editing) setPage(1);
      refreshShopping();
    } catch (error) {
      setFormError(saveError(error));
    } finally {
      saveInProgress.current = false;
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleting || deleteInProgress.current) return;
    deleteInProgress.current = true;
    setDeletingBusy(true);
    setDeleteError("");
    try {
      await remove.mutateAsync({ id: deleting.id });
      setDeleting(null);
      setAnnouncement("Item deleted.");
      if (records.length === 1 && page > 1) setPage((current) => current - 1);
      refreshShopping();
    } catch {
      setDeleteError("Could not delete this item. Try again.");
    } finally {
      deleteInProgress.current = false;
      setDeletingBusy(false);
    }
  }

  return (
    <section className="shiva-shopping" aria-labelledby="shopping-heading">
      <div className="shiva-shopping-header">
        <div>
          <h1 id="shopping-heading">Shopping</h1>
          <p>Consider, compare, and plan purchases.</p>
        </div>
        <Button leftSection={<IconPlus size={18} />} onClick={startCreate}>
          Add item
        </Button>
      </div>

      <div className="shiva-shopping-metrics">
        <div className="shiva-card shiva-shopping-metric">
          <span>On your list</span>
          <strong>{summary.isSuccess ? summary.data.active : "—"}</strong>
          <small>Items yet to purchase</small>
        </div>
        <div className="shiva-card shiva-shopping-metric">
          <span>Purchased</span>
          <strong>{summary.isSuccess ? summary.data.purchased : "—"}</strong>
          <small>Items marked as purchased</small>
        </div>
        <div className="shiva-card shiva-shopping-metric">
          <span>Budgeted estimates</span>
          <strong className="shiva-shopping-budget-totals">
            {privacy
              ? "••••"
              : summary.isSuccess
                ? budgetedCurrencies.length
                  ? budgetedCurrencies.map((currency) => (
                      <span key={currency}>
                        {estimatedPrice(summary.data.budgetedMinorByCurrency[currency] / 100, currency)}
                      </span>
                    ))
                  : "No estimated spend"
                : "—"}
          </strong>
          <small>Budgeted stage only · currencies kept separate</small>
        </div>
      </div>

      {summary.isError && (
        <Alert
          color="red"
          icon={<IconAlertCircle size={17} />}
          className="shiva-shopping-status"
          title="Summary unavailable"
        >
          Your list can still be used.{" "}
          <button type="button" onClick={() => void summary.refetch()}>
            Retry summary
          </button>
        </Alert>
      )}

      <div className="shiva-card shiva-shopping-content">
        <div className="shiva-shopping-toolbar">
          <TextInput
            aria-label="Search shopping items"
            placeholder="Search your list"
            leftSection={<IconSearch size={17} />}
            value={search}
            maxLength={120}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              setPage(1);
            }}
            rightSection={
              searching || query.isFetching ? <Loader size="xs" aria-label="Updating shopping results" /> : undefined
            }
          />
          <Select
            aria-label="Filter by category"
            data={categoryOptions}
            value={category}
            onChange={(value) => {
              setCategory(value ?? "all");
              setPage(1);
            }}
            allowDeselect={false}
            comboboxProps={{ withinPortal: false }}
          />
          <Select
            aria-label="Filter by priority"
            data={[{ value: "all", label: "All priorities" }, ...priorities]}
            value={priority}
            onChange={(value) => {
              setPriority(value ?? "all");
              setPage(1);
            }}
            allowDeselect={false}
            comboboxProps={{ withinPortal: false }}
          />
          <Select
            aria-label="Filter by stage"
            data={[{ value: "all", label: "All stages" }, ...stageOptions]}
            value={stage}
            onChange={(value) => {
              setStage(value ?? "all");
              setPage(1);
            }}
            allowDeselect={false}
            comboboxProps={{ withinPortal: false }}
          />
        </div>

        {categories.isError && (
          <output className="shiva-shopping-filter-status">
            Categories are unavailable. Other filters still work.
            <button type="button" onClick={() => void categories.refetch()}>
              Retry categories
            </button>
          </output>
        )}

        {query.isPending ? (
          <output className="shiva-shopping-empty" aria-live="polite">
            <Loader size="sm" />
            <p>Loading your shopping list…</p>
          </output>
        ) : query.isError ? (
          <div className="shiva-shopping-empty">
            <IconAlertCircle size={32} aria-hidden="true" />
            <h2>Your list could not be loaded</h2>
            <p>Check that SHIVA is running and your session is active.</p>
            <Button
              variant="light"
              leftSection={<IconRefresh size={17} />}
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : records.length === 0 && !filtered && page === 1 ? (
          <div className="shiva-shopping-empty">
            <div className="shiva-shopping-empty-icon">
              <IconShoppingBag size={30} stroke={1.5} aria-hidden="true" />
            </div>
            <h2>Make room for thoughtful purchases</h2>
            <p>Save something you’re considering, add your requirements, and move it forward when you’re ready.</p>
            <Button variant="light" leftSection={<IconPlus size={17} />} onClick={startCreate}>
              Add your first item
            </Button>
            <small>Your list starts empty. Prices are estimates you enter.</small>
          </div>
        ) : records.length === 0 ? (
          <div className="shiva-shopping-empty">
            <IconSearch size={30} aria-hidden="true" />
            <h2>No matching items</h2>
            <p>
              {filtered
                ? "Try another search or clear your filters."
                : "The list changed. Return to the first page to see your items."}
            </p>
            <Button variant="light" onClick={clearFilters}>
              {filtered ? "Clear filters" : "First page"}
            </Button>
          </div>
        ) : (
          <>
            <div className="shiva-shopping-list-meta">
              <span>
                {(page - 1) * pageSize + 1}–{(page - 1) * pageSize + records.length} of {query.data?.total ?? 0}{" "}
                {query.data?.total === 1 ? "item" : "items"}
              </span>
              {filtered && (
                <button type="button" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
              <span className="shiva-shopping-estimates-label">Your estimates · no live prices</span>
            </div>
            <ul className="shiva-shopping-list" aria-busy={query.isFetching || searching}>
              {records.map((row, index) => {
                const label = privacy ? `Hidden item ${(page - 1) * pageSize + index + 1}` : row.name;
                const safeLink = shoppingInputSchema.shape.url.safeParse(row.url);
                return (
                  <li key={row.id} className="shiva-shopping-row">
                    <div className="shiva-shopping-product">
                      <div className="shiva-shopping-product-icon" aria-hidden="true">
                        {row.stage === "purchased" ? <IconCheck size={20} /> : <IconShoppingBag size={20} />}
                      </div>
                      <div>
                        <h3>{label}</h3>
                        <span>{privacy ? "Category hidden" : row.category}</span>
                        {!privacy && safeLink.success && safeLink.data && (
                          <a href={safeLink.data} target="_blank" rel={SAFE_NEW_TAB_REL}>
                            Product link <IconArrowUpRight size={13} aria-hidden="true" />
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="shiva-shopping-stage">
                      <Badge
                        variant="light"
                        color={row.stage === "purchased" ? "teal" : row.stage === "budgeted" ? "blue" : "gray"}
                      >
                        {stageLabels[row.stage]}
                      </Badge>
                    </div>
                    <span className={`shiva-shopping-priority shiva-shopping-priority-${row.priority}`}>
                      <span aria-hidden="true" />
                      {row.priority.charAt(0).toUpperCase() + row.priority.slice(1)} priority
                    </span>
                    <div className="shiva-shopping-price">
                      {privacy ? "••••" : estimatedPrice(row.estimatedPrice, row.currency)}
                    </div>
                    <Group gap={4} wrap="nowrap" className="shiva-shopping-actions">
                      <ActionIcon
                        variant="subtle"
                        aria-label={`Edit ${label}`}
                        title="Edit item"
                        onClick={() => startEdit(row)}
                      >
                        <IconEdit size={18} />
                      </ActionIcon>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={`Delete ${label}`}
                        title="Delete item"
                        onClick={() => {
                          setDeleteError("");
                          setDeleting(row);
                        }}
                      >
                        <IconTrash size={18} />
                      </ActionIcon>
                    </Group>
                  </li>
                );
              })}
            </ul>
            {pageCount > 1 && (
              <nav className="shiva-shopping-pagination" aria-label="Shopping pages">
                <Button
                  variant="default"
                  size="sm"
                  disabled={page <= 1 || query.isFetching || searching}
                  onClick={() => setPage((current) => current - 1)}
                >
                  Previous
                </Button>
                <span aria-live="polite">
                  Page {page} of {pageCount}
                </span>
                <Button
                  variant="default"
                  size="sm"
                  disabled={page >= pageCount || query.isFetching || searching}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                </Button>
              </nav>
            )}
          </>
        )}
      </div>
      <output className="shiva-shopping-announcement" aria-live="polite">
        {announcement}
      </output>

      <Modal
        opened={opened}
        onClose={closeEditor}
        title={editing ? "Edit shopping item" : "Add shopping item"}
        size="lg"
        withinPortal={false}
        closeOnClickOutside={!saving}
        closeOnEscape={!saving}
        withCloseButton={!saving}
        className="shiva-shopping-modal"
      >
        {detailLoading ? (
          <output className="shiva-shopping-detail-status" aria-live="polite">
            <Loader size="sm" />
            <p>Loading item details…</p>
          </output>
        ) : detailFailed ? (
          <Stack gap="md">
            <Alert color="red" icon={<IconAlertCircle size={17} />} title="Item details unavailable">
              The item may have been removed, or your session may have expired. No changes have been made.
            </Alert>
            <Group justify="flex-end">
              <Button variant="default" onClick={closeEditor}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (editing) void loadDetails(editing);
                }}
              >
                Try again
              </Button>
            </Group>
          </Stack>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
            noValidate
          >
            <Stack gap="md">
              {privacy && (
                <Alert icon={<IconLock size={17} />} title="Private details are visible in this editor">
                  Close the editor to return to your hidden list.
                </Alert>
              )}
              <TextInput
                label="Name"
                placeholder="What are you considering?"
                required
                maxLength={120}
                value={draft.name}
                onChange={(event) => change("name", event.currentTarget.value)}
                error={errors.name}
                ref={nameRef}
                data-autofocus
                disabled={saving}
              />
              <div className="shiva-shopping-form-grid">
                <TextInput
                  label="Category"
                  required
                  maxLength={60}
                  value={draft.category}
                  onChange={(event) => change("category", event.currentTarget.value)}
                  error={errors.category}
                  disabled={saving}
                />
                <Select
                  label="Priority"
                  data={priorities}
                  value={draft.priority}
                  onChange={(value) => {
                    if (value) change("priority", value as ShoppingInput["priority"]);
                  }}
                  allowDeselect={false}
                  error={errors.priority}
                  disabled={saving}
                  comboboxProps={{ withinPortal: false }}
                />
                <NumberInput
                  label="Estimated price"
                  description="Optional; your estimate, not a live price"
                  placeholder="Not estimated"
                  value={draft.estimatedPrice}
                  onChange={(value) => change("estimatedPrice", value)}
                  min={0}
                  max={1_000_000_000}
                  decimalScale={2}
                  allowNegative={false}
                  hideControls
                  thousandSeparator=","
                  thousandsGroupStyle={draft.currency === "INR" ? "lakh" : "thousand"}
                  error={errors.estimatedPrice}
                  disabled={saving}
                />
                <Select
                  label="Currency"
                  data={["INR", "USD", "EUR", "GBP"]}
                  value={draft.currency}
                  onChange={(value) => {
                    if (value) change("currency", value as ShoppingInput["currency"]);
                  }}
                  allowDeselect={false}
                  error={errors.currency}
                  disabled={saving}
                  comboboxProps={{ withinPortal: false }}
                />
              </div>
              <Select
                label="Purchase stage"
                data={stageOptions}
                value={draft.stage}
                onChange={(value) => {
                  if (value) change("stage", value as ShoppingInput["stage"]);
                }}
                allowDeselect={false}
                error={errors.stage}
                disabled={saving}
                comboboxProps={{ withinPortal: false }}
              />
              <Textarea
                label="Notes and requirements"
                placeholder="Requirements, comparisons, or things to check"
                autosize
                minRows={3}
                maxRows={7}
                maxLength={5000}
                value={draft.notes}
                onChange={(event) => change("notes", event.currentTarget.value)}
                error={errors.notes}
                disabled={saving}
              />
              <TextInput
                label="Product or source URL"
                placeholder="https://…"
                type="url"
                maxLength={2048}
                value={draft.url}
                onChange={(event) => change("url", event.currentTarget.value)}
                error={errors.url}
                disabled={saving}
              />
              {formError && (
                <Alert color="red" icon={<IconAlertCircle size={17} />} role="alert">
                  {formError}
                </Alert>
              )}
              <Group justify="flex-end">
                <Button variant="default" onClick={closeEditor} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" loading={saving}>
                  {editing ? "Save changes" : "Add item"}
                </Button>
              </Group>
            </Stack>
          </form>
        )}
      </Modal>

      <Modal
        opened={deleting !== null}
        onClose={() => {
          if (!deletingBusy) setDeleting(null);
        }}
        title="Delete shopping item?"
        size="sm"
        withinPortal={false}
        className="shiva-shopping-modal"
        closeOnClickOutside={!deletingBusy}
        closeOnEscape={!deletingBusy}
        withCloseButton={!deletingBusy}
      >
        <Stack gap="md">
          <Text size="sm">
            {privacy ? "This item" : `“${deleting?.name ?? "This item"}”`} will be permanently removed from your
            shopping list.
          </Text>
          {deleteError && (
            <Alert color="red" role="alert">
              {deleteError}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleting(null)} disabled={deletingBusy}>
              Keep item
            </Button>
            <Button color="red" onClick={() => void confirmDelete()} loading={deletingBusy}>
              Delete item
            </Button>
          </Group>
        </Stack>
      </Modal>
    </section>
  );
}
