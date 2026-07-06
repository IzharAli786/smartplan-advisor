/** Quote money math + status helpers. */
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LineInput {
  product?: string | null;
  description?: string | null;
  quantity: number;
  unitPrice: number;
}

export function computeTotals(items: LineInput[], discount: number, taxRate: number) {
  const lines = items.map((i, idx) => ({
    product: i.product ?? null,
    description: i.description ?? null,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    amount: round2(i.quantity * i.unitPrice),
    sortOrder: idx,
  }));
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const taxAmount = round2(((subtotal - discount) * taxRate) / 100);
  const total = round2(subtotal - discount + taxAmount);
  return { lines, subtotal, taxAmount, total };
}

/** A sent/viewed quote past its valid_until reads as "expired" without rewriting the row. */
export function effectiveStatus(status: string, validUntil: string | null): string {
  if ((status === "sent" || status === "viewed") && validUntil) {
    if (validUntil < new Date().toISOString().slice(0, 10)) return "expired";
  }
  return status;
}
