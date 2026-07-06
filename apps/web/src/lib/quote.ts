import type { QuoteStatus } from "../api/types.ts";

/** Map a quote status to a badge label + kind for <StatusBadge>. */
export function quoteBadge(status: QuoteStatus): { label: string; kind?: "overdue" | "success" | "ai" } {
  switch (status) {
    case "draft":
      return { label: "Draft" };
    case "sent":
      return { label: "Sent", kind: "ai" };
    case "viewed":
      return { label: "Viewed", kind: "ai" };
    case "signed":
      return { label: "Signed", kind: "success" };
    case "declined":
      return { label: "Declined", kind: "overdue" };
    case "expired":
      return { label: "Expired", kind: "overdue" };
    default:
      return { label: status };
  }
}
