import { z } from "zod";

// Query strings must preserve false; Boolean("false") is true.
const queryBoolean = z.union([z.boolean(), z.enum(["true", "false"])]).transform(value => value === true || value === "true");
export const searchFiltersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  country: z.string().trim().regex(/^[a-z]{2}$/i).transform(value => value.toUpperCase()).optional(),
  region: z.string().trim().min(1).max(16).transform(value => value.toUpperCase()).optional(),
  language: z.string().trim().max(32).optional(),
  verifiedOnly: queryBoolean.optional(),
  // Discovery has no privacy-aware realtime presence provider yet.
  onlineOnly: queryBoolean.refine(value => !value, "Online discovery is unavailable").optional()
}).strict();
export const discoverySearchSchema = searchFiltersSchema.extend({
  verifiedOnly: queryBoolean.default(true),
  onlineOnly: queryBoolean.refine(value => !value, "Online discovery is unavailable").default(false),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().uuid().optional()
});
export const collectionSearchSchema = searchFiltersSchema.pick({ q: true, country: true, region: true }).extend({
  category: z.string().trim().max(80).optional(),
  period: z.enum(["all", "week", "month"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(10000).default(0)
});
export type CollectionSearch = z.infer<typeof collectionSearchSchema>;

export function pageItems<T>(rows: T[], query: { limit: number; offset: number }) {
  return { items: rows.slice(0, query.limit), nextOffset: rows.length > query.limit ? query.offset + query.limit : null };
}
