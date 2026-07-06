import type { Role } from "@smart-crm/shared";

export type { Role };

/** Org-level display preferences (currency + date format), chosen at registration. */
export interface OrgPrefs {
  id: string;
  name: string;
  currency: string;
  dateFormat: string;
}

export interface CurrentUser {
  id: string;
  role: Role;
  fullName: string;
  email: string;
  phone: string | null;
  phone2: string | null;
  address: string | null;
  startDate: string | null;
  referralLink?: string | null;
  enrolledDate?: string | null;
  referredBy?: string | null;
  statesCovered: string[];
  avatarUrl?: string | null;
  apolloCreditAllowanceMonthly: number | null;
  active: boolean;
  status: "active" | "invited" | "deactivated";
  monthlyQuota: number | null;
  /** Present only for managerial viewers (stripped server-side for advisors, §11.1). */
  currentCommissionRate?: number | null;
  notes?: string | null;
}

export interface Lead {
  id: string;
  orgId: string;
  assignedAdvisorId: string;
  advisorName?: string | null;
  status: "new" | "claimed" | "converted" | "dismissed";
  firstName: string | null;
  lastName: string | null;
  title: string | null;
  email: string | null;
  department: string | null;
  linkedinUrl: string | null;
  companyName: string;
  website: string | null;
  companyAddress: string | null;
  companyCity: string | null;
  companyState: string | null;
  corporatePhone: string | null;
  companyPhone: string | null;
  numEmployees: number | null;
  keywords: string | null;
  technologies: string | null;
  annualRevenue: string | null;
  subsidiaryOf: string | null;
  notes: string | null;
  convertedOpportunityId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Opportunity {
  id: string;
  advisorId: string;
  contractorCompanyName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactCell: string | null;
  numTechnicians: number | null;
  product: string | null;
  opportunityValue: number | null;
  status: string;
  state: string;
  address: string | null;
  website: string | null;
  followUpAt: string | null;
  nextStep: string | null;
  nextStepDue: string | null;
  nextReviewAt: string | null;
  reviewNotes: string | null;
  notes: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface OpportunityProductLine {
  id?: string;
  product: string;
  technicians: number;
  unitPrice: number;
  amount: number;
}

export interface Communication {
  id: string;
  opportunityId: string | null;
  contactId: string | null;
  advisorId: string | null;
  toEmail: string;
  subject: string;
  kind: "quote" | "email" | "invite" | "reset" | "other";
  provider: string;
  providerMessageId: string | null;
  status: string;
  createdAt: string;
}

export interface StatusStage {
  id: string;
  key: string;
  label: string;
  sortOrder: number;
  isConversion: boolean;
  isTerminal: boolean;
  winProbability: number;
  active: boolean;
}

export interface CommissionStatement {
  advisorName: string;
  advisorEmail: string;
  from: string;
  to: string;
  rows: { company: string; convertedAt: string; dealValue: number; rate: number; commission: number }[];
  totals: { deals: number; dealValue: number; commission: number };
}

export interface Product {
  id: string;
  label: string;
  sortOrder: number;
  active: boolean;
  defaultPrice: string | null;
}

export interface SmartPlanTransaction {
  id: string;
  advisorId: string;
  stripeTransactionId: string | null;
  occurredAt: string;
  amount: number | string;
  product: string | null;
  status: "active" | "inactive";
  source: "stripe" | "manual";
  createdAt: string;
}

export interface AdvisorSetup {
  daysToSell: number;
  hoursPerDay: number;
  annualObjective: number;
  closeRate: number;
  avgSaleSize: number;
  personalObjective: number;
}
export interface Badge {
  label: string;
  color: string | null;
  minPercent: number;
}
export interface PerformanceSummary {
  setup: AdvisorSetup;
  derived: {
    totalHours: number;
    requiredPerHour: number;
    personalPerHour: number;
    salesHours: number;
    nonSalesHours: number;
    adjustedAnnual: number;
    personalAdjusted: number;
    wonYtd: number;
    wonMtd: number;
    objective: number;
    attainmentYear: number;
    attainmentMonth: number;
  };
  badgeYear: Badge | null;
  badgeMonth: Badge | null;
}
export type ActivityCategory = "sales" | "non_sales";
export interface ActivityTypeDef {
  id: string;
  label: string;
  category: ActivityCategory;
  sortOrder: number;
  active: boolean;
}
export interface ActivityEntry {
  id: string;
  activityTypeId: string | null;
  category: ActivityCategory;
  label: string;
  hours: number | string;
  occurredOn: string;
  notes: string | null;
  createdAt: string;
}
export interface BadgeTier {
  id: string;
  label: string;
  minPercent: number | string;
  color: string | null;
  sortOrder: number;
}

export interface EmailAttachment {
  key: string;
  filename: string;
  size?: number;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  cc: string | null;
  bcc: string | null;
  bodyHtml: string;
  attachments: EmailAttachment[];
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface JourneyStage {
  id: string;
  label: string;
  sortOrder: number;
  active: boolean;
}

export interface JourneyItem {
  stageId: string;
  label: string;
  sortOrder: number;
  completedAt: string | null;
}

export type ContactType = "customer" | "lead" | "partner" | "other";
export interface Contact {
  id: string;
  ownerId: string;
  ownerName?: string | null;
  type: ContactType;
  name: string;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  phone2: string | null;
  address: string | null;
  notes: string | null;
  nextReviewAt: string | null;
  reviewNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ActivityType = "call" | "sms" | "email" | "note" | "status_change" | "quote" | "system";
export interface Activity {
  id: string;
  opportunityId: string;
  advisorId: string | null;
  type: ActivityType;
  subject: string;
  body: string | null;
  outcome: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type QuoteStatus = "draft" | "sent" | "viewed" | "signed" | "declined" | "expired";

export interface QuoteLineItem {
  id?: string;
  product: string | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface Quote {
  id: string;
  opportunityId: string;
  advisorId: string;
  quoteNumber: string;
  title: string;
  contactName: string | null;
  contactEmail: string | null;
  status: QuoteStatus;
  effectiveStatus: QuoteStatus;
  currency: string;
  subtotal: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  notes: string | null;
  validUntil: string | null;
  publicToken: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  declinedAt: string | null;
  signerName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteDetail {
  quote: Quote;
  lineItems: QuoteLineItem[];
  company: string;
  state: string;
  advisor: { name: string; email: string; phone: string | null } | null;
  publicUrl: string | null;
}

export interface PublicQuote {
  quoteNumber: string;
  title: string;
  company: string;
  contactName: string | null;
  advisor: { name: string; email: string; phone: string | null } | null;
  status: QuoteStatus;
  currency: string;
  subtotal: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  notes: string | null;
  validUntil: string | null;
  signedAt: string | null;
  signerName: string | null;
  logoUrl: string | null;
  lineItems: QuoteLineItem[];
}

export interface TodayItem {
  id: string;
  contractorCompanyName: string;
  status: string;
  nextStep: string | null;
  nextStepDue: string | null;
  followUpAt: string | null;
  product: string | null;
  state: string;
  overdue: boolean;
}

export interface PendingClaim {
  id: string;
  matchedCompanyName: string;
  status: string;
  createdAt: string;
}

export interface ClaimRequest {
  id: string;
  matchedOpportunityId: string;
  matchedCompanyName: string;
  requestingAdvisorId: string;
  requesterName: string | null;
  currentOwnerId: string;
  currentOwnerName: string | null;
  draft: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  decisionNote: string | null;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  type: string;
  message: string;
  relatedId: string | null;
  read: boolean;
  createdAt: string;
}

export interface Collateral {
  id: string;
  product: string;
  type: "pdf" | "slides" | "image" | "video" | "link";
  title: string;
  description: string | null;
  fileUrl: string | null;
  externalUrl: string | null;
  thumbnailUrl: string | null;
  sortOrder: number;
  active: boolean;
  createdAt: string;
}

export interface AdvisorRollup {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  statesCovered: string[];
  totalOpps: number;
  openOpps: number;
  openValue: number;
  wonCount: number;
  conversionRate: number;
}

export interface StateRollup {
  state: string;
  totalOpps: number;
  openOpps: number;
  openValue: number;
  wonCount: number;
}

export interface ConvertedRow {
  company: string;
  advisorName: string;
  convertedAt: string;
  dealValue: number;
  commissionRateSnapshot: number;
  commissionAmount: number;
}

export type ReportColType = "text" | "number" | "currency" | "percent" | "date";
export interface ReportColumn {
  key: string;
  label: string;
  type?: ReportColType;
}
export interface ReportData {
  key: string;
  title: string;
  subtitle?: string;
  dateRange: boolean;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  generatedAt: string;
}
export interface ReportMeta {
  key: string;
  title: string;
  description: string;
  dateRange: boolean;
}
