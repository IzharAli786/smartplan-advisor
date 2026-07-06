/**
 * Deterministic next-step engine config (§8.1).
 *
 * Each status stage carries a defined next step + SLA. No ML. The engine writes
 * `next_step` / `next_step_due` onto an opportunity from (status, follow_up_at, last
 * activity). Core reminders must NEVER depend on an LLM (§8.2).
 *
 * Keyed by the stage's STABLE key (not its display label), so renaming a stage in
 * settings does not break the rules (§5.2).
 */
export interface NextStepRule {
  /** Stable stage key. */
  stage: string;
  /** Recommended action text shown to the advisor. */
  nextStep: string;
  /** Days from the reference date until the action is due. */
  dueInDays: number;
}

export const DEFAULT_NEXT_STEP_RULES: NextStepRule[] = [
  { stage: "new", nextStep: "Make first contact", dueInDays: 2 },
  { stage: "contacted", nextStep: "Book a demo", dueInDays: 3 },
  { stage: "demo_scheduled", nextStep: "Run demo, then send proposal", dueInDays: 1 },
  { stage: "proposal", nextStep: "Follow up if no response", dueInDays: 5 },
  // won / lost are terminal — no next step.
];

/**
 * Compute the next step for an opportunity.
 * Reference date is follow_up_at when set (advisor's own scheduled touch wins),
 * otherwise the time the status was last changed.
 */
export function computeNextStep(args: {
  stageKey: string;
  isTerminal: boolean;
  statusChangedAt: Date;
  followUpAt?: Date | null;
  rules?: NextStepRule[];
}): { nextStep: string | null; nextStepDue: Date | null } {
  if (args.isTerminal) return { nextStep: null, nextStepDue: null };
  const rules = args.rules ?? DEFAULT_NEXT_STEP_RULES;
  const rule = rules.find((r) => r.stage === args.stageKey);
  if (!rule) return { nextStep: null, nextStepDue: null };

  if (args.followUpAt) {
    return { nextStep: rule.nextStep, nextStepDue: args.followUpAt };
  }
  const due = new Date(args.statusChangedAt);
  due.setDate(due.getDate() + rule.dueInDays);
  return { nextStep: rule.nextStep, nextStepDue: due };
}
