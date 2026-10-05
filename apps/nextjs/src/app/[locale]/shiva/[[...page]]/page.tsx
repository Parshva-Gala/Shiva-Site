// SHIVA extension, Apache-2.0. Reuses Homarr identity and client providers.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { api } from "@homarr/api/shiva-server";
import { auth } from "@homarr/auth/next";
import { createLogger } from "@homarr/core/infrastructure/logs";
import { ShivaApp } from "~/shiva/app";

export const metadata: Metadata = { title: { absolute: "SHIVA — Personal dashboard" } };
const logger = createLogger({ module: "shiva-initial-data" });
export default async function ShivaPage({ params }: { params: Promise<{ page?: string[] }> }) {
  const session = await auth();
  if (!session?.user) redirect("/auth/login?callbackUrl=%2Fshiva");
  const { page } = await params;
  const currentPage = page?.join("/") ?? "home";
  // Protected native reads share the existing request identity and query cache.
  // Failures leave the client query free to load, retry, and show its error state.
  const [initialSettings, initialShoppingSummary] = await Promise.all([
    api.shiva.settings().catch(() => {
      logger.warn("SHIVA initial settings read failed; client recovery remains available.");
      return undefined;
    }),
    currentPage === "home"
      ? api.shiva.shoppingSummary().catch(() => {
          logger.warn("SHIVA initial Shopping summary read failed; client recovery remains available.");
          return undefined;
        })
      : undefined,
  ]);
  const initialTodayLabel = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  return (
    <ShivaApp
      page={currentPage}
      initialSettings={initialSettings}
      initialShoppingSummary={initialShoppingSummary}
      initialTodayLabel={initialTodayLabel}
    />
  );
}
