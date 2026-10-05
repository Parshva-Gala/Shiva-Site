// SHIVA extension, Apache-2.0. No connector requests or external writes here.
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";

import { createId } from "@homarr/common";
import {
  assertOwnedShivaWallpaperUrls,
  ShivaAssetReferenceError,
  withShivaAssetOwnerLock,
} from "@homarr/core/infrastructure/shiva-assets";
import { and, asc, desc, eq, sql } from "@homarr/db";
import { shivaSettings, shivaShoppingRecords } from "@homarr/db/schema";
import {
  defaultShivaSettings,
  shivaSettingsDocumentSchema,
  shivaSettingsSnapshotSchema,
  shivaSettingsResponseSchema,
  shoppingInputSchema,
  shoppingListInputSchema,
} from "@homarr/validation/shiva";
import type { ShoppingInput } from "@homarr/validation/shiva";

import { createTRPCRouter, protectedProcedure } from "../trpc";

const recordIdSchema = z.object({ id: z.string().min(1).max(64) }).strict();
const shoppingRecordSchema = shoppingInputSchema.extend({ id: z.string(), createdAt: z.date(), updatedAt: z.date() });
const shoppingListItemSchema = shoppingRecordSchema.omit({ notes: true });
const currencies = ["INR", "USD", "EUR", "GBP"] as const;
const summarySchema = z.object({
  total: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  purchased: z.number().int().nonnegative(),
  budgetedMinorByCurrency: z.object({ INR: z.number(), USD: z.number(), EUR: z.number(), GBP: z.number() }),
});

const toStoredPrice = ({ estimatedPrice, ...input }: ShoppingInput) => ({
  ...input,
  estimatedPriceMinor: estimatedPrice === null ? null : Math.round(estimatedPrice * 100),
});
const fromStoredPrice = <T extends { estimatedPriceMinor: number | null }>(record: T) => {
  const { estimatedPriceMinor, ...result } = record;
  return { ...result, estimatedPrice: estimatedPriceMinor === null ? null : estimatedPriceMinor / 100 };
};
const settingsConflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message:
      "Settings changed in another tab. Reload the saved preferences before trying again; your draft has not been saved.",
  });

export const shivaRouter = createTRPCRouter({
  settings: protectedProcedure.output(shivaSettingsResponseSchema).query(async ({ ctx }) => {
    const row = await ctx.db.query.shivaSettings.findFirst({ where: eq(shivaSettings.userId, ctx.session.user.id) });
    if (!row) return { ...structuredClone(defaultShivaSettings), revision: 0, recoveryWarning: false };

    // Recover readability from corrupt or incompatible preferences without deleting them.
    try {
      const parsed = shivaSettingsDocumentSchema.safeParse(JSON.parse(row.settings));
      if (parsed.success) {
        const { schemaVersion: _schemaVersion, ...settings } = parsed.data;
        return { ...settings, revision: row.revision, recoveryWarning: false };
      }
    } catch {
      // The original document remains available for backup and deliberate recovery.
    }
    return { ...structuredClone(defaultShivaSettings), revision: row.revision, recoveryWarning: true };
  }),
  saveSettings: protectedProcedure
    .input(shivaSettingsSnapshotSchema)
    .output(shivaSettingsResponseSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await withShivaAssetOwnerLock(ctx.session.user.id, async () => {
          await assertOwnedShivaWallpaperUrls(
            ctx.session.user.id,
            [input.theme, ...input.presets].map((theme) => theme.wallpaper),
          );
          const { revision, ...settings } = input;
          const row = {
            userId: ctx.session.user.id,
            settings: JSON.stringify(shivaSettingsDocumentSchema.parse({ ...settings, schemaVersion: 1 })),
            revision: revision + 1,
            updatedAt: new Date(),
          };
          // Compare-and-swap is atomic at the database, including two simultaneous initial saves.
          if (revision === 0) {
            const inserted = await ctx.db
              .insert(shivaSettings)
              .values(row)
              .onConflictDoNothing({ target: shivaSettings.userId })
              .returning({ revision: shivaSettings.revision });
            if (inserted.length > 0) return { ...settings, revision: row.revision, recoveryWarning: false };
          }
          const updated = await ctx.db
            .update(shivaSettings)
            .set({ settings: row.settings, revision: row.revision, updatedAt: row.updatedAt })
            .where(and(eq(shivaSettings.userId, row.userId), eq(shivaSettings.revision, revision)))
            .returning({ revision: shivaSettings.revision });
          if (updated.length === 0) throw settingsConflict();
          return { ...settings, revision: row.revision, recoveryWarning: false };
        });
      } catch (error) {
        if (error instanceof ShivaAssetReferenceError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    }),
  shoppingList: protectedProcedure
    .input(shoppingListInputSchema)
    .output(z.object({ items: z.array(shoppingListItemSchema), total: z.number().int().nonnegative() }))
    .query(async ({ ctx, input }) => {
      const search = input.search?.toLocaleLowerCase().replace(/[\\%_]/g, "\\$&");
      const where = and(
        eq(shivaShoppingRecords.userId, ctx.session.user.id),
        input.stage ? eq(shivaShoppingRecords.stage, input.stage) : undefined,
        input.priority ? eq(shivaShoppingRecords.priority, input.priority) : undefined,
        input.category ? eq(shivaShoppingRecords.category, input.category) : undefined,
        search
          ? sql`(lower(${shivaShoppingRecords.name}) like ${`%${search}%`} escape '\\' or lower(${shivaShoppingRecords.category}) like ${`%${search}%`} escape '\\')`
          : undefined,
      );
      const [records, counts] = await Promise.all([
        ctx.db.query.shivaShoppingRecords.findMany({
          columns: { userId: false, notes: false },
          where,
          orderBy: [desc(shivaShoppingRecords.updatedAt), desc(shivaShoppingRecords.id)],
          limit: input.limit,
          offset: input.offset,
        }),
        ctx.db
          .select({ total: sql<number>`count(*)` })
          .from(shivaShoppingRecords)
          .where(where),
      ]);
      return { items: records.map(fromStoredPrice), total: Number(counts[0]?.total ?? 0) };
    }),
  shoppingDetail: protectedProcedure
    .input(recordIdSchema)
    .output(shoppingRecordSchema)
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.shivaShoppingRecords.findFirst({
        columns: { userId: false },
        where: and(eq(shivaShoppingRecords.id, input.id), eq(shivaShoppingRecords.userId, ctx.session.user.id)),
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Shopping record not found." });
      return fromStoredPrice(row);
    }),
  shoppingCategories: protectedProcedure.output(z.array(z.string()).max(100)).query(async ({ ctx }) => {
    const rows = await ctx.db
      .selectDistinct({ category: shivaShoppingRecords.category })
      .from(shivaShoppingRecords)
      .where(eq(shivaShoppingRecords.userId, ctx.session.user.id))
      .orderBy(asc(shivaShoppingRecords.category))
      .limit(100);
    return rows.map((row) => row.category);
  }),
  shoppingSummary: protectedProcedure.output(summarySchema).query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        currency: shivaShoppingRecords.currency,
        total: sql<number>`count(*)`,
        active: sql<number>`sum(case when ${shivaShoppingRecords.stage} <> 'purchased' then 1 else 0 end)`,
        purchased: sql<number>`sum(case when ${shivaShoppingRecords.stage} = 'purchased' then 1 else 0 end)`,
        budgetedMinor: sql<number>`coalesce(sum(case when ${shivaShoppingRecords.stage} = 'budgeted' then ${shivaShoppingRecords.estimatedPriceMinor} else 0 end), 0)`,
      })
      .from(shivaShoppingRecords)
      .where(eq(shivaShoppingRecords.userId, ctx.session.user.id))
      .groupBy(shivaShoppingRecords.currency);
    const summary = { total: 0, active: 0, purchased: 0, budgetedMinorByCurrency: { INR: 0, USD: 0, EUR: 0, GBP: 0 } };
    for (const row of rows) {
      summary.total += Number(row.total);
      summary.active += Number(row.active);
      summary.purchased += Number(row.purchased);
      if (currencies.includes(row.currency)) summary.budgetedMinorByCurrency[row.currency] = Number(row.budgetedMinor);
    }
    return summary;
  }),
  shoppingCreate: protectedProcedure
    .input(shoppingInputSchema)
    .output(shoppingRecordSchema)
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const record = { ...input, id: createId(), createdAt: now, updatedAt: now };
      await ctx.db.insert(shivaShoppingRecords).values({
        ...toStoredPrice(input),
        id: record.id,
        createdAt: now,
        updatedAt: now,
        userId: ctx.session.user.id,
      });
      return record;
    }),
  shoppingUpdate: protectedProcedure
    .input(recordIdSchema.extend({ data: shoppingInputSchema }))
    .output(shoppingRecordSchema)
    .mutation(async ({ ctx, input }) => {
      const [record] = await ctx.db
        .update(shivaShoppingRecords)
        .set({ ...toStoredPrice(input.data), updatedAt: new Date() })
        .where(and(eq(shivaShoppingRecords.id, input.id), eq(shivaShoppingRecords.userId, ctx.session.user.id)))
        .returning();
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "Shopping record not found." });
      const { userId: _userId, ...result } = record;
      return fromStoredPrice(result);
    }),
  shoppingDelete: protectedProcedure
    .input(recordIdSchema)
    .output(z.void())
    .mutation(async ({ ctx, input }) => {
      const deleted = await ctx.db
        .delete(shivaShoppingRecords)
        .where(and(eq(shivaShoppingRecords.id, input.id), eq(shivaShoppingRecords.userId, ctx.session.user.id)))
        .returning({ id: shivaShoppingRecords.id });
      if (deleted.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Shopping record not found." });
    }),
});
