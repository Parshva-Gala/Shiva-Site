import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { defaultShivaSettings } from "@homarr/validation/shiva";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  settings: vi.fn(),
  summary: vi.fn(),
  warn: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("login redirect");
  }),
}));
vi.mock("@homarr/auth/next", () => ({ auth: mocks.auth }));
vi.mock("@homarr/api/shiva-server", () => ({
  api: { shiva: { settings: mocks.settings, shoppingSummary: mocks.summary } },
}));
vi.mock("@homarr/core/infrastructure/logs", () => ({ createLogger: () => ({ warn: mocks.warn }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("~/shiva/app", () => ({ ShivaApp: () => null }));

import ShivaPage from "./page";

const settings = { ...defaultShivaSettings, revision: 3, recoveryWarning: false };
const summary = { total: 7, active: 5, purchased: 2, budgetedMinorByCurrency: { INR: 199950, USD: 0, EUR: 0, GBP: 0 } };

beforeEach(() => {
  vi.useFakeTimers();
  // This instant is already the following day in Kolkata.
  vi.setSystemTime(new Date("2026-10-04T20:00:00Z"));
  mocks.auth.mockResolvedValue({ user: { id: "owner" } });
  mocks.settings.mockResolvedValue(settings);
  mocks.summary.mockResolvedValue(summary);
});

afterEach(() => vi.useRealTimers());

describe("SHIVA authenticated initial page reads", () => {
  test("redirects an unauthenticated request before reading personal data", async () => {
    mocks.auth.mockResolvedValue(null);
    await expect(ShivaPage({ params: Promise.resolve({}) })).rejects.toThrow("login redirect");
    expect(mocks.redirect).toHaveBeenCalledWith("/auth/login?callbackUrl=%2Fshiva");
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.summary).not.toHaveBeenCalled();
  });

  test("passes successful protected Home reads and one hydration-stable Kolkata date", async () => {
    const page = await ShivaPage({ params: Promise.resolve({}) });
    expect(page.props).toEqual({
      page: "home",
      initialSettings: settings,
      initialShoppingSummary: summary,
      initialTodayLabel: "Monday, 5 October",
    });
    expect(mocks.settings).toHaveBeenCalledOnce();
    expect(mocks.summary).toHaveBeenCalledOnce();
  });

  test("keeps non-Home routes independent of the Shopping summary", async () => {
    const page = await ShivaPage({ params: Promise.resolve({ page: ["settings", "appearance"] }) });
    expect(page.props.page).toBe("settings/appearance");
    expect(page.props.initialSettings).toBe(settings);
    expect(page.props.initialShoppingSummary).toBeUndefined();
    expect(mocks.summary).not.toHaveBeenCalled();
  });

  test("leaves failed reads undefined for client recovery and logs no failure payload", async () => {
    const sensitiveFailure = new Error("credential=secret database-private-path");
    mocks.settings.mockRejectedValue(sensitiveFailure);
    mocks.summary.mockRejectedValue(sensitiveFailure);
    const page = await ShivaPage({ params: Promise.resolve({}) });
    expect(page.props.initialSettings).toBeUndefined();
    expect(page.props.initialShoppingSummary).toBeUndefined();
    expect(mocks.warn.mock.calls).toEqual([
      ["SHIVA initial settings read failed; client recovery remains available."],
      ["SHIVA initial Shopping summary read failed; client recovery remains available."],
    ]);
  });
});
