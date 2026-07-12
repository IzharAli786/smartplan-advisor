import { z } from "zod";

/**
 * THE CAPTURE CONTRACT (§6, §2 of the build plan).
 *
 * The typed form produces an OpportunityDraft. In v1.1, captureViaVoice() and
 * captureViaApollo() will produce the SAME object behind the same interface, so adding
 * those paths is additive — not a migration. Do not let other shapes leak downstream.
 */

/** Provenance of an opportunity's creation. `referral` rows are created by the
 * SmartPlan activation ingest (a referred customer's instance went live). */
export const opportunitySourceSchema = z.enum(["typed", "voice", "enriched", "lead", "referral"]);
export type OpportunitySource = z.infer<typeof opportunitySourceSchema>;

const usState = z
  .string()
  .trim()
  .length(2, "Use the 2-letter state code")
  .transform((s) => s.toUpperCase());

const optionalText = z.string().trim().max(2000).optional().or(z.literal("").transform(() => undefined));

/** A single product line on an opportunity: a product + how many technicians it covers. */
export const opportunityProductLineSchema = z.object({
  product: z.string().trim().min(1, "Pick a product").max(160),
  technicians: z.coerce.number().int().min(1, "At least 1 technician").max(100000).default(1),
});
export type OpportunityProductLine = z.infer<typeof opportunityProductLineSchema>;

/**
 * What an advisor fills in to capture an opportunity. Minimal required set (§6.1):
 * company + product + state. Everything else optional, to keep logging under 30s.
 */
const opportunityDraftBase = z.object({
  contractor_company_name: z.string().trim().min(1, "Company name is required").max(200),
  contact_name: optionalText,
  contact_email: z
    .string()
    .trim()
    .email("Enter a valid email")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  contact_cell: z.string().trim().max(40).optional().or(z.literal("").transform(() => undefined)),
  num_technicians: z.coerce.number().int().min(0).max(100000).optional(),
  /** Single product (voice / legacy). Optional when product_lines is supplied. */
  product: z.string().trim().min(1).optional(),
  /** Multi-product capture: each line drives the auto-computed deal value. */
  product_lines: z.array(opportunityProductLineSchema).max(50).optional(),
  /** Auto-computed from product_lines server-side; an explicit value still overrides. */
  opportunity_value: z.coerce.number().min(0).max(1_000_000_000).optional(),
  state: usState,
  notes: optionalText,
  follow_up_at: z.coerce.date().optional(),
  next_review_at: z.coerce.date().nullish(),
  review_notes: optionalText,
  /** Manager-defined custom fields (§3.3). Reserved in v1 — always {} until v1.1. */
  custom_fields: z.record(z.unknown()).default({}),
  source: opportunitySourceSchema.default("typed"),
});

export const opportunityDraftSchema = opportunityDraftBase.refine(
  (d) => !!d.product || (d.product_lines && d.product_lines.length > 0),
  { message: "Pick at least one product", path: ["product_lines"] },
);

export type OpportunityDraft = z.infer<typeof opportunityDraftSchema>;

/** Payload for updating an existing opportunity (status changes, edits, follow-ups).
 * `state` additionally accepts "" here: referral-sourced opportunities may be created
 * without a US state (SmartPlan orgs often have none), and the edit form round-trips
 * the stored value — requiring 2 letters would make those rows un-savable. */
export const opportunityUpdateSchema = opportunityDraftBase
  .partial()
  .extend({
    status: z.string().trim().min(1).optional(),
    state: usState.or(z.literal("")).optional(),
  })
  .omit({ source: true });

export type OpportunityUpdate = z.infer<typeof opportunityUpdateSchema>;
