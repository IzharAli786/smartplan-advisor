import { db, statusStages, products, journeyStages, activityTypes, badgeTiers } from "@smart-crm/db";

/** Default pipeline + option lists provisioned for every new organization. */
const DEFAULT_STAGES = [
  { key: "new", label: "New", sortOrder: 1, isConversion: false, isTerminal: false, winProbability: 10 },
  { key: "contacted", label: "Contacted", sortOrder: 2, isConversion: false, isTerminal: false, winProbability: 25 },
  { key: "demo_scheduled", label: "Demo Scheduled", sortOrder: 3, isConversion: false, isTerminal: false, winProbability: 50 },
  { key: "proposal", label: "Proposal", sortOrder: 4, isConversion: false, isTerminal: false, winProbability: 70 },
  { key: "won", label: "Won", sortOrder: 5, isConversion: true, isTerminal: true, winProbability: 100 },
  { key: "lost", label: "Lost", sortOrder: 6, isConversion: false, isTerminal: true, winProbability: 0 },
];

const DEFAULT_PRODUCTS = ["Smart Plan Survey", "Smart Plan Propose", "Smart Plan Quote", "Smart Plan Perform", "Equipment Only Survey", "Equipment Only Perform"];

const DEFAULT_JOURNEY = ["Intro Call", "Intro Email", "Follow Up Email", "Zoom Demo", "Upgrade Email", "Trial Started"];

const DEFAULT_ACTIVITY_TYPES: { label: string; category: "sales" | "non_sales" }[] = [
  { label: "Intel Collection", category: "sales" },
  { label: "Prospecting", category: "sales" },
  { label: "Phone Calls", category: "sales" },
  { label: "Emails", category: "sales" },
  { label: "Survey", category: "non_sales" },
  { label: "Estimating", category: "non_sales" },
  { label: "Proposal Prep", category: "non_sales" },
  { label: "Company Meetings", category: "non_sales" },
  { label: "Social Events", category: "non_sales" },
];

const DEFAULT_BADGE_TIERS = [
  { label: "Bronze", minPercent: "25", color: "#cd7f32" },
  { label: "Silver", minPercent: "50", color: "#9aa4b2" },
  { label: "Gold", minPercent: "75", color: "#f5b301" },
  { label: "Platinum", minPercent: "100", color: "#29a9f2" },
  { label: "Diamond", minPercent: "125", color: "#8b5cf6" },
];

/** Seed a freshly-created organization with sensible defaults so it works out of the box. */
export async function provisionOrg(orgId: string): Promise<void> {
  await db.insert(statusStages).values(DEFAULT_STAGES.map((s) => ({ ...s, orgId })));
  await db.insert(products).values(DEFAULT_PRODUCTS.map((label, i) => ({ orgId, label, sortOrder: i + 1, active: true })));
  await db.insert(journeyStages).values(DEFAULT_JOURNEY.map((label, i) => ({ orgId, label, sortOrder: i + 1, active: true })));
  await db.insert(activityTypes).values(DEFAULT_ACTIVITY_TYPES.map((a, i) => ({ orgId, label: a.label, category: a.category, sortOrder: i + 1, active: true })));
  await db.insert(badgeTiers).values(DEFAULT_BADGE_TIERS.map((b, i) => ({ orgId, label: b.label, minPercent: b.minPercent, color: b.color, sortOrder: i + 1 })));
}
