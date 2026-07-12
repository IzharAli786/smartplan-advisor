import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  numeric,
  timestamp,
  date,
  jsonb,
  pgEnum,
  customType,
} from "drizzle-orm/pg-core";

/** Postgres bytea ↔ Node Buffer, for DB-backed file storage. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/** Enums mirror db/migrations/0001_init.sql. */
export const userRole = pgEnum("user_role", ["super_admin", "manager", "advisor"]);
export const tokenPurpose = pgEnum("token_purpose", ["invite", "reset"]);
export const opportunitySource = pgEnum("opportunity_source", ["typed", "voice", "enriched", "lead", "referral"]);
export const collateralType = pgEnum("collateral_type", ["pdf", "slides", "image", "video", "link"]);
export const claimStatus = pgEnum("claim_status", ["pending", "approved", "rejected"]);
export const notificationType = pgEnum("notification_type", [
  "claim_request",
  "claim_decision",
  "account_reassigned",
  "follow_up",
  "next_step",
  "quote_update",
]);
export const leadStatus = pgEnum("lead_status", ["new", "claimed", "converted", "dismissed"]);
export const fieldEntity = pgEnum("field_entity", ["opportunity", "lead"]);
export const fieldDataType = pgEnum("field_data_type", [
  "text",
  "long_text",
  "number",
  "currency",
  "date",
  "datetime",
  "boolean",
  "single_select",
  "multi_select",
  "email",
  "phone",
  "url",
]);
export const apolloAction = pgEnum("apollo_action", [
  "org_enrich",
  "people_enrich",
  "phone_reveal",
  "email_reveal",
  "waterfall",
]);
export const quoteStatus = pgEnum("quote_status", ["draft", "sent", "viewed", "signed", "declined", "expired"]);
export const activityType = pgEnum("activity_type", ["call", "sms", "email", "note", "status_change", "quote", "system"]);
export const contactType = pgEnum("contact_type", ["customer", "lead", "partner", "other"]);
export const communicationKind = pgEnum("communication_kind", ["quote", "email", "invite", "reset", "other"]);
export const activityCategory = pgEnum("activity_category", ["sales", "non_sales"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  currency: text("currency").notNull().default("USD"),
  dateFormat: text("date_format").notNull().default("MM/DD/YYYY"),
  lightLogoKey: text("light_logo_key"), // portal logo for light backgrounds
  darkLogoKey: text("dark_logo_key"), // portal logo for dark backgrounds (sidebar)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** DB-backed file storage — collateral, avatars, org logos, email attachments. */
export const fileBlobs = pgTable("file_blobs", {
  key: text("key").primaryKey(),
  contentType: text("content_type"),
  byteSize: integer("byte_size").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  role: userRole("role").notNull(),
  fullName: text("full_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  phone2: text("phone2"),
  address: text("address"),
  startDate: date("start_date"),
  referralLink: text("referral_link"),
  enrolledDate: date("enrolled_date"),
  referredBy: text("referred_by"),
  notes: text("notes"),
  passwordHash: text("password_hash"),
  sessionVersion: integer("session_version").notNull().default(0),
  statesCovered: text("states_covered").array().notNull().default([]),
  avatarKey: text("avatar_key"),
  currentCommissionRate: numeric("current_commission_rate"),
  monthlyQuota: numeric("monthly_quota"),
  apolloCreditAllowanceMonthly: integer("apollo_credit_allowance_monthly"),
  active: boolean("active").notNull().default(true),
  invitedAt: timestamp("invited_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userTokens = pgTable("user_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  purpose: tokenPurpose("purpose").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const statusStages = pgTable("status_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull(),
  isConversion: boolean("is_conversion").notNull().default(false),
  isTerminal: boolean("is_terminal").notNull().default(false),
  winProbability: integer("win_probability").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emailTemplates = pgTable("email_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  name: text("name").notNull(),
  subject: text("subject").notNull().default(""),
  cc: text("cc"),
  bcc: text("bcc"),
  bodyHtml: text("body_html").notNull().default(""),
  attachments: jsonb("attachments").notNull().default([]),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const journeyStages = pgTable("journey_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const opportunityJourney = pgTable("opportunity_journey", {
  id: uuid("id").primaryKey().defaultRandom(),
  opportunityId: uuid("opportunity_id").notNull(),
  stageId: uuid("stage_id").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull(),
  active: boolean("active").notNull().default(true),
  defaultPrice: numeric("default_price"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quotes = pgTable("quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  opportunityId: uuid("opportunity_id").notNull(),
  advisorId: uuid("advisor_id").notNull(),
  quoteNumber: text("quote_number").notNull(),
  title: text("title").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  status: quoteStatus("status").notNull().default("draft"),
  currency: text("currency").notNull().default("USD"),
  subtotal: numeric("subtotal").notNull().default("0"),
  discount: numeric("discount").notNull().default("0"),
  taxRate: numeric("tax_rate").notNull().default("0"),
  taxAmount: numeric("tax_amount").notNull().default("0"),
  total: numeric("total").notNull().default("0"),
  notes: text("notes"),
  validUntil: date("valid_until"),
  publicToken: text("public_token"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  viewedAt: timestamp("viewed_at", { withTimezone: true }),
  signedAt: timestamp("signed_at", { withTimezone: true }),
  declinedAt: timestamp("declined_at", { withTimezone: true }),
  signerName: text("signer_name"),
  signerIp: text("signer_ip"),
  signature: text("signature"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activities = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  opportunityId: uuid("opportunity_id").notNull(),
  advisorId: uuid("advisor_id"),
  type: activityType("type").notNull(),
  subject: text("subject").notNull(),
  body: text("body"),
  outcome: text("outcome"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const quoteLineItems = pgTable("quote_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: uuid("quote_id").notNull(),
  product: text("product"),
  description: text("description"),
  quantity: numeric("quantity").notNull().default("1"),
  unitPrice: numeric("unit_price").notNull().default("0"),
  amount: numeric("amount").notNull().default("0"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const opportunities = pgTable("opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  advisorId: uuid("advisor_id").notNull(),
  contractorCompanyName: text("contractor_company_name").notNull(),
  companyNameNormalized: text("company_name_normalized").notNull(),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactEmailNormalized: text("contact_email_normalized"),
  contactCell: text("contact_cell"),
  contactCellE164: text("contact_cell_e164"),
  numTechnicians: integer("num_technicians"),
  product: text("product"),
  opportunityValue: numeric("opportunity_value"),
  status: text("status").notNull(),
  statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
  state: text("state").notNull(),
  address: text("address"),
  website: text("website"),
  followUpAt: timestamp("follow_up_at", { withTimezone: true }),
  nextStep: text("next_step"),
  nextStepDue: timestamp("next_step_due", { withTimezone: true }),
  nextReviewAt: timestamp("next_review_at", { withTimezone: true }),
  reviewNotes: text("review_notes"),
  notes: text("notes"),
  customFields: jsonb("custom_fields").notNull().default({}),
  source: opportunitySource("source").notNull().default("typed"),
  apolloOrgId: text("apollo_org_id"),
  enrichedAt: timestamp("enriched_at", { withTimezone: true }),
  enrichmentVerified: boolean("enrichment_verified").notNull().default(false),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const keyPersonnel = pgTable("key_personnel", {
  id: uuid("id").primaryKey().defaultRandom(),
  opportunityId: uuid("opportunity_id").notNull(),
  name: text("name").notNull(),
  title: text("title"),
  email: text("email"),
  phone: text("phone"),
  apolloPersonId: text("apollo_person_id"),
  emailStatus: text("email_status"),
  source: text("source").notNull().default("manual"),
  verified: boolean("verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const collateral = pgTable("collateral", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  product: text("product").notNull(),
  type: collateralType("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  storageKey: text("storage_key"),
  fileUrl: text("file_url"),
  externalUrl: text("external_url"),
  thumbnailUrl: text("thumbnail_url"),
  sortOrder: integer("sort_order").notNull().default(0),
  uploadedBy: uuid("uploaded_by"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const claimRequests = pgTable("claim_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  matchedOpportunityId: uuid("matched_opportunity_id").notNull(),
  matchedCompanyName: text("matched_company_name").notNull(),
  requestingAdvisorId: uuid("requesting_advisor_id").notNull(),
  currentOwnerId: uuid("current_owner_id").notNull(),
  draft: jsonb("draft").notNull(),
  status: claimStatus("status").notNull().default("pending"),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  userId: uuid("user_id").notNull(),
  type: notificationType("type").notNull(),
  message: text("message").notNull(),
  relatedId: uuid("related_id"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  opportunityId: uuid("opportunity_id").notNull(),
  advisorId: uuid("advisor_id").notNull(),
  convertedAt: timestamp("converted_at", { withTimezone: true }).notNull().defaultNow(),
  dealValue: numeric("deal_value").notNull(),
  commissionRateSnapshot: numeric("commission_rate_snapshot").notNull(),
  commissionAmount: numeric("commission_amount").notNull(),
  commissionTierLabel: text("commission_tier_label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  assignedAdvisorId: uuid("assigned_advisor_id").notNull(),
  status: leadStatus("status").notNull().default("new"),
  // Person (Apollo)
  firstName: text("first_name"),
  lastName: text("last_name"),
  title: text("title"),
  email: text("email"),
  emailNormalized: text("email_normalized"),
  department: text("department"),
  linkedinUrl: text("linkedin_url"),
  // Company (Apollo)
  companyName: text("company_name").notNull(),
  companyNameNormalized: text("company_name_normalized").notNull(),
  website: text("website"),
  companyAddress: text("company_address"),
  companyCity: text("company_city"),
  companyState: text("company_state"),
  corporatePhone: text("corporate_phone"),
  companyPhone: text("company_phone"),
  phoneE164: text("phone_e164"),
  numEmployees: integer("num_employees"),
  keywords: text("keywords"),
  technologies: text("technologies"),
  annualRevenue: text("annual_revenue"),
  subsidiaryOf: text("subsidiary_of"),
  // Meta
  apolloOrgId: text("apollo_org_id"),
  source: text("source").notNull().default("apollo"),
  notes: text("notes"),
  customFields: jsonb("custom_fields").notNull().default({}),
  convertedOpportunityId: uuid("converted_opportunity_id"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const fieldDefinitions = pgTable("field_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  entity: fieldEntity("entity").notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  dataType: fieldDataType("data_type").notNull(),
  options: jsonb("options"),
  required: boolean("required").notNull().default(false),
  visibleToAdvisor: boolean("visible_to_advisor").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const commissionRates = pgTable("commission_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  advisorId: uuid("advisor_id").notNull(),
  rate: numeric("rate").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  ownerId: uuid("owner_id").notNull(),
  type: contactType("type").notNull().default("lead"),
  name: text("name").notNull(),
  company: text("company"),
  title: text("title"),
  email: text("email"),
  phone: text("phone"),
  phone2: text("phone2"),
  address: text("address"),
  notes: text("notes"),
  nextReviewAt: timestamp("next_review_at", { withTimezone: true }),
  reviewNotes: text("review_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const opportunityProducts = pgTable("opportunity_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  opportunityId: uuid("opportunity_id").notNull(),
  product: text("product").notNull(),
  technicians: integer("technicians").notNull().default(1),
  unitPrice: numeric("unit_price").notNull().default("0"),
  amount: numeric("amount").notNull().default("0"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const communications = pgTable("communications", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  opportunityId: uuid("opportunity_id"),
  contactId: uuid("contact_id"),
  advisorId: uuid("advisor_id"),
  toEmail: text("to_email").notNull(),
  subject: text("subject").notNull(),
  kind: communicationKind("kind").notNull().default("email"),
  provider: text("provider").notNull().default("dev"),
  providerMessageId: text("provider_message_id"),
  status: text("status").notNull().default("sent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const advisorSalesSetup = pgTable("advisor_sales_setup", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  advisorId: uuid("advisor_id").notNull(),
  daysToSell: integer("days_to_sell").notNull().default(250),
  hoursPerDay: numeric("hours_per_day").notNull().default("6"),
  annualObjective: numeric("annual_objective").notNull().default("0"),
  closeRate: numeric("close_rate").notNull().default("0"),
  avgSaleSize: numeric("avg_sale_size").notNull().default("0"),
  personalObjective: numeric("personal_objective").notNull().default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activityTypes = pgTable("activity_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  label: text("label").notNull(),
  category: activityCategory("category").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activityEntries = pgTable("activity_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  advisorId: uuid("advisor_id").notNull(),
  activityTypeId: uuid("activity_type_id"),
  category: activityCategory("category").notNull(),
  label: text("label").notNull(),
  hours: numeric("hours").notNull().default("0"),
  occurredOn: date("occurred_on").notNull().defaultNow(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const badgeTiers = pgTable("badge_tiers", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  label: text("label").notNull(),
  minPercent: numeric("min_percent").notNull().default("0"),
  color: text("color"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const highFives = pgTable("high_fives", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  fromUserId: uuid("from_user_id"),
  fromName: text("from_name"),
  toAdvisorId: uuid("to_advisor_id").notNull(),
  message: text("message"),
  seen: boolean("seen").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const smartplanTransactions = pgTable("smartplan_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  advisorId: uuid("advisor_id").notNull(),
  stripeTransactionId: text("stripe_transaction_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  amount: numeric("amount").notNull().default("0"),
  product: text("product"),
  status: text("status").notNull().default("active"),
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apolloUsage = pgTable("apollo_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  advisorId: uuid("advisor_id").notNull(),
  action: apolloAction("action").notNull(),
  credits: numeric("credits").notNull().default("0"),
  entityType: fieldEntity("entity_type").notNull(),
  entityId: uuid("entity_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
