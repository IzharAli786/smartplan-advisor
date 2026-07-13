import { z } from "zod";
import { roleSchema } from "./roles.js";
import { CURRENCY_CODES, DATE_FORMAT_VALUES, DEFAULT_CURRENCY, DEFAULT_DATE_FORMAT } from "./locale.js";

/** ── Auth ──────────────────────────────────────────────── */
export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Public self-service business registration → creates an org + its first admin. */
export const registerSchema = z.object({
  company_name: z.string().trim().min(1, "Company name is required").max(160),
  full_name: z.string().trim().min(1, "Your name is required").max(160),
  email: z.string().trim().email("Enter a valid email"),
  password: z.string().min(10, "Use at least 10 characters"),
  currency: z.enum(CURRENCY_CODES).default(DEFAULT_CURRENCY),
  date_format: z.enum(DATE_FORMAT_VALUES).default(DEFAULT_DATE_FORMAT),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const setPasswordSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(10, "Use at least 10 characters"),
});
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;

export const forgotPasswordSchema = z.object({ email: z.string().trim().email() });

/** ── User management (§3.2) ────────────────────────────── */
const optionalStr = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));

export const createUserSchema = z.object({
  full_name: z.string().trim().min(1).max(120),
  email: z.string().trim().email(),
  role: roleSchema,
  phone: optionalStr(40),
  phone2: optionalStr(40),
  address: optionalStr(300),
  start_date: z.coerce.date().optional(),
  referral_link: optionalStr(500),
  enrolled_date: z.coerce.date().optional(),
  referred_by: optionalStr(160),
  notes: optionalStr(2000),
  states_covered: z.array(z.string().trim().length(2).transform((s) => s.toUpperCase())).default([]),
  // Advisor-only fields; ignored server-side for non-advisor roles. Default commission 33%.
  current_commission_rate: z.coerce.number().min(0).max(100).optional(),
  monthly_quota: z.coerce.number().min(0).max(100000000).optional(),
  apollo_credit_allowance_monthly: z.coerce.number().int().min(0).optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = createUserSchema.partial().omit({ role: true }).extend({
  active: z.boolean().optional(),
  // Optional admin-set password; omit to leave unchanged.
  password: z.string().min(10, "Use at least 10 characters").optional().or(z.literal("").transform(() => undefined)),
  // Optional effective date for a commission-rate change (defaults to today).
  commission_effective_from: z.coerce.date().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** Default advisor commission rate when none is specified (§10). */
export const DEFAULT_COMMISSION_RATE = 33;

/** ── Settings / option lists (§3.3a) ───────────────────── */
export const statusStageSchema = z.object({
  id: z.string().uuid().optional(),
  key: z.string().trim().regex(/^[a-z0-9_]+$/, "lowercase/underscore only"),
  label: z.string().trim().min(1).max(60),
  sort_order: z.number().int(),
  is_conversion: z.boolean().default(false),
  is_terminal: z.boolean().default(false),
  win_probability: z.coerce.number().int().min(0).max(100).default(0),
});
export type StatusStageInput = z.infer<typeof statusStageSchema>;

export const productSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(80),
  sort_order: z.number().int(),
  active: z.boolean().default(true),
  default_price: z.coerce.number().min(0).max(100000000).optional(),
});

/** ── Smart Plan (Stripe) transactions ──────────────────── */
export const smartPlanTxnSchema = z.object({
  advisor_id: z.string().uuid(),
  stripe_transaction_id: z.string().trim().max(120).optional().or(z.literal("").transform(() => undefined)),
  occurred_at: z.coerce.date().optional(),
  // Negative amounts are allowed for reversals/clawbacks (failed payments,
  // refunds). The Smart Plan report sums amount * rate, so a negative row nets
  // the advisor's commission down automatically.
  amount: z.coerce.number().min(-1_000_000_000).max(1_000_000_000),
  product: z.string().trim().max(160).optional().or(z.literal("").transform(() => undefined)),
  // "adjustment" marks a reversal row (e.g. a failed payment clawback).
  status: z.enum(["active", "inactive", "adjustment"]).default("active"),
});
export type SmartPlanTxnInput = z.infer<typeof smartPlanTxnSchema>;

/** Normalized payload a Stripe webhook adapter posts to /ingest (source = stripe). */
export const smartPlanTxnIngestSchema = smartPlanTxnSchema.extend({
  stripe_transaction_id: z.string().trim().min(1).max(120),
  // The referred customer's company name — lets the super-admin reports show
  // WHICH customer subscribed under each advisor and count distinct subscribers.
  company_name: z.string().trim().max(200).optional().or(z.literal("").transform(() => undefined)),
});

/**
 * Referral activation payload SmartPlan posts to /activation when a referred
 * customer activates. The API creates a pipeline opportunity owned by the
 * referring advisor (source = "referral").
 */
export const smartPlanActivationSchema = z.object({
  advisor_id: z.string().uuid(),
  company_name: z.string().trim().min(1).max(200),
  state: z.string().trim().max(80).optional().or(z.literal("").transform(() => undefined)),
  contact_name: z.string().trim().max(160).optional().or(z.literal("").transform(() => undefined)),
  contact_email: z.string().trim().max(200).optional().or(z.literal("").transform(() => undefined)),
  contact_cell: z.string().trim().max(40).optional().or(z.literal("").transform(() => undefined)),
  product: z.string().trim().max(160).optional().or(z.literal("").transform(() => undefined)),
  opportunity_value: z.coerce.number().min(0).max(1_000_000_000).optional(),
});
export type SmartPlanActivationInput = z.infer<typeof smartPlanActivationSchema>;

/**
 * Advisor-sync payload SmartPlan posts to /advisor-sync when an Eco Admin
 * creates or updates a Smart Advisor (referral partner). Upserts a real
 * Advise advisor account by email — so the roster stays in sync — and returns
 * the user's UUID, which SmartPlan stores as its commission-routing link.
 */
export const smartPlanAdvisorSyncSchema = z.object({
  /** The already-linked Advise user UUID, when SmartPlan has one. Lets the
   * upsert match by IDENTITY first, so correcting an advisor's email updates
   * the same account instead of creating a duplicate. */
  advise_user_id: z.string().uuid().optional(),
  email: z.string().trim().email("Enter a valid email").max(200),
  full_name: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(40).optional().or(z.literal("").transform(() => undefined)),
  state: z.string().trim().max(80).optional().or(z.literal("").transform(() => undefined)),
  commission_rate: z.coerce.number().min(0).max(100).optional(),
  referral_link: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
  referred_by: z.string().trim().max(160).optional().or(z.literal("").transform(() => undefined)),
  enrolled_date: z.coerce.date().optional(),
  active: z.boolean().optional(),
  /** When true, SmartPlan is asking Advise to (re)send the set-password invite
   *  email for a not-yet-activated advisor — a brand-new account, or an existing
   *  one that hasn't set a password. Advise owns the token + the email; SmartPlan
   *  only requests it and reports the `invited` result back to the eco-admin. */
  request_invite: z.boolean().optional(),
});
export type SmartPlanAdvisorSyncInput = z.infer<typeof smartPlanAdvisorSyncSchema>;

/** ── Performance: advisor setup, activities, badges, high-fives ── */
export const advisorSetupSchema = z.object({
  days_to_sell: z.coerce.number().int().min(1).max(366).default(250),
  hours_per_day: z.coerce.number().min(0.25).max(24).default(6),
  annual_objective: z.coerce.number().min(0).max(1_000_000_000).default(0),
  close_rate: z.coerce.number().min(0).max(100).default(0),
  avg_sale_size: z.coerce.number().min(0).max(1_000_000_000).default(0),
  personal_objective: z.coerce.number().min(0).max(1_000_000_000).default(0),
});
export type AdvisorSetupInput = z.infer<typeof advisorSetupSchema>;

export const ACTIVITY_CATEGORIES = ["sales", "non_sales"] as const;
export const activityTypeSchema = z.object({
  label: z.string().trim().min(1).max(80),
  category: z.enum(ACTIVITY_CATEGORIES),
  sort_order: z.coerce.number().int().default(0),
  active: z.boolean().default(true),
});
export type ActivityTypeInput = z.infer<typeof activityTypeSchema>;

export const activityEntrySchema = z.object({
  activity_type_id: z.string().uuid(),
  hours: z.coerce.number().min(0).max(24),
  occurred_on: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional().or(z.literal("").transform(() => undefined)),
});
export type ActivityEntryInput = z.infer<typeof activityEntrySchema>;

export const badgeTierSchema = z.object({
  label: z.string().trim().min(1).max(60),
  min_percent: z.coerce.number().min(0).max(10000).default(0),
  color: z.string().trim().max(20).optional().or(z.literal("").transform(() => undefined)),
  sort_order: z.coerce.number().int().default(0),
});
export type BadgeTierInput = z.infer<typeof badgeTierSchema>;

export const highFiveSchema = z.object({
  to_advisor_id: z.string().uuid(),
  message: z.string().trim().max(280).optional().or(z.literal("").transform(() => undefined)),
});
export type HighFiveInput = z.infer<typeof highFiveSchema>;

/** ── AI pipeline import (Excel → opportunities) ────────── */
export const importAnalyzeSchema = z.object({
  headers: z.array(z.string()).max(200),
  rows: z.array(z.record(z.unknown())).max(5000),
});
export type ImportAnalyzeInput = z.infer<typeof importAnalyzeSchema>;

export const importRowSchema = z.object({
  contractor_company_name: z.string().trim().min(1).max(200),
  contact_name: z.string().trim().max(200).optional().or(z.literal("").transform(() => undefined)),
  contact_email: z.string().trim().max(200).optional().or(z.literal("").transform(() => undefined)),
  contact_cell: z.string().trim().max(60).optional().or(z.literal("").transform(() => undefined)),
  state: z.string().trim().max(40).optional().or(z.literal("").transform(() => undefined)),
  product: z.string().trim().max(160).optional().or(z.literal("").transform(() => undefined)),
  num_technicians: z.coerce.number().int().min(0).max(100000).optional(),
  opportunity_value: z.coerce.number().min(0).max(1_000_000_000).optional(),
  notes: z.string().trim().max(4000).optional().or(z.literal("").transform(() => undefined)),
  advisor_id: z.string().uuid(),
});
export type ImportRowInput = z.infer<typeof importRowSchema>;

export const importCommitSchema = z.object({
  rows: z.array(importRowSchema).max(5000),
  dry_run: z.boolean().default(false),
});
export type ImportCommitInput = z.infer<typeof importCommitSchema>;

/** ── Email templates ───────────────────────────────────── */
export const emailAttachmentSchema = z.object({
  key: z.string().min(1),
  filename: z.string().min(1).max(260),
  size: z.number().int().nonnegative().optional(),
});
export type EmailAttachment = z.infer<typeof emailAttachmentSchema>;

const emailListOptional = z.string().trim().max(2000).optional().or(z.literal("").transform(() => undefined));

export const emailTemplateSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name").max(120),
  subject: z.string().trim().max(300).default(""),
  cc: emailListOptional,
  bcc: emailListOptional,
  body_html: z.string().max(200_000).default(""),
  attachments: z.array(emailAttachmentSchema).max(20).default([]),
  active: z.boolean().default(true),
  sort_order: z.coerce.number().int().default(0),
});
export type EmailTemplateInput = z.infer<typeof emailTemplateSchema>;

/** Send an ad-hoc email (composed from a template) to a prospect. */
export const emailSendSchema = z.object({
  to: z.string().trim().email("Enter a valid recipient email"),
  cc: emailListOptional,
  bcc: emailListOptional,
  subject: z.string().trim().min(1, "Subject is required").max(300),
  html: z.string().max(200_000).default(""),
  opportunity_id: z.string().uuid().optional(),
  contact_id: z.string().uuid().optional(),
  attachments: z.array(emailAttachmentSchema).max(20).default([]),
});
export type EmailSendInput = z.infer<typeof emailSendSchema>;

/** A journey/touchpoint stage (Intro Call, Zoom Demo, …) shown on the opportunity stepper. */
export const journeyStageSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(80),
  sort_order: z.coerce.number().int().default(0),
  active: z.boolean().default(true),
});
export type JourneyStageInput = z.infer<typeof journeyStageSchema>;

/** ── Claim requests (§5.1) ─────────────────────────────── */
export const claimDecisionSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  decision_note: z.string().trim().max(1000).optional(),
});

/** ── Collateral (§7) ───────────────────────────────────── */
export const collateralTypeSchema = z.enum(["pdf", "slides", "image", "video", "link"]);
export const collateralSchema = z
  .object({
    product: z.string().trim().min(1),
    type: collateralTypeSchema,
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().max(2000).optional().or(z.literal("").transform(() => undefined)),
    external_url: z.string().trim().url().optional().or(z.literal("").transform(() => undefined)),
    sort_order: z.number().int().default(0),
  })
  .refine((v) => v.type !== "video" || !!v.external_url, {
    message: "Videos require a YouTube/Vimeo URL",
    path: ["external_url"],
  });
export type CollateralInput = z.infer<typeof collateralSchema>;

/** ── Conversion (§10) ──────────────────────────────────── */
export const convertSchema = z.object({
  deal_value: z.coerce.number().min(0),
});

/** ── Quotes / proposals ────────────────────────────────── */
export const quoteLineItemSchema = z.object({
  product: z.string().trim().max(120).optional().or(z.literal("").transform(() => undefined)),
  description: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
  quantity: z.coerce.number().min(0).max(100000).default(1),
  unit_price: z.coerce.number().min(0).max(100000000).default(0),
});

export const quoteInputSchema = z.object({
  opportunity_id: z.string().uuid(),
  title: z.string().trim().min(1, "Give the quote a title").max(160),
  contact_name: z.string().trim().max(120).optional().or(z.literal("").transform(() => undefined)),
  contact_email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(4000).optional().or(z.literal("").transform(() => undefined)),
  valid_until: z.coerce.date().optional(),
  discount: z.coerce.number().min(0).default(0),
  tax_rate: z.coerce.number().min(0).max(100).default(0),
  line_items: z.array(quoteLineItemSchema).min(1, "Add at least one line item"),
});
export type QuoteInput = z.infer<typeof quoteInputSchema>;

/** Update reuses the same shape minus the opportunity (a quote can't change owner). */
export const quoteUpdateSchema = quoteInputSchema.omit({ opportunity_id: true });

export const quoteSignSchema = z.object({
  signer_name: z.string().trim().min(2, "Type your full name to sign").max(120),
  agree: z.literal(true, { errorMap: () => ({ message: "You must agree to sign" }) }),
});

export const QUOTE_STATUSES = ["draft", "sent", "viewed", "signed", "declined", "expired"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** ── Address Book (contacts) ───────────────────────────── */
export const CONTACT_TYPES = ["customer", "lead", "partner", "other"] as const;
export const contactTypeSchema = z.enum(CONTACT_TYPES);
export type ContactType = (typeof CONTACT_TYPES)[number];

const contactOptional = (max: number) => z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));

export const contactSchema = z.object({
  type: contactTypeSchema.default("lead"),
  name: z.string().trim().min(1, "Name is required").max(160),
  company: contactOptional(160),
  title: contactOptional(120),
  email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  phone: contactOptional(40),
  phone2: contactOptional(40),
  address: contactOptional(300),
  notes: contactOptional(2000),
  next_review_at: z.coerce.date().nullish(),
  review_notes: contactOptional(2000),
});
export type ContactInput = z.infer<typeof contactSchema>;

/** Bulk import (Excel / phone). Be lenient: skip rows with no name server-side. */
export const contactImportSchema = z.object({
  contacts: z.array(contactSchema.partial({ type: true }).extend({ name: z.string().trim().min(1).max(160) })).max(5000),
});

/** ── Activity timeline ─────────────────────────────────── */
// Only manual interaction types are loggable from the client; status/quote/system are server-generated.
export const logActivitySchema = z.object({
  type: z.enum(["call", "sms", "email", "note"]),
  subject: z.string().trim().max(200).optional().or(z.literal("").transform(() => undefined)),
  body: z.string().trim().max(4000).optional().or(z.literal("").transform(() => undefined)),
  outcome: z.string().trim().max(60).optional().or(z.literal("").transform(() => undefined)),
});
export type LogActivityInput = z.infer<typeof logActivitySchema>;
