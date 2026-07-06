import { eq } from "drizzle-orm";
import { db, products, opportunityProducts } from "@smart-crm/db";

/** Technicians is optional on the wire (defaults to 1) — keep the service tolerant. */
export interface ProductLineInput {
  product: string;
  technicians?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Current per-technician price for each active product (label → price). */
export async function getProductPriceMap(): Promise<Map<string, number>> {
  const rows = await db.select({ label: products.label, price: products.defaultPrice }).from(products);
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.label, r.price == null ? 0 : Number(r.price));
  return map;
}

export interface PricedLine {
  product: string;
  technicians: number;
  unitPrice: number;
  amount: number;
  sortOrder: number;
}

/** Price each line (unit_price × technicians) and total the deal value. */
export async function priceLines(lines: ProductLineInput[]): Promise<{ rows: PricedLine[]; total: number }> {
  const prices = await getProductPriceMap();
  const rows: PricedLine[] = lines.map((l, idx) => {
    const unitPrice = prices.get(l.product) ?? 0;
    const technicians = l.technicians ?? 1;
    return { product: l.product, technicians, unitPrice, amount: round2(unitPrice * technicians), sortOrder: idx };
  });
  const total = round2(rows.reduce((s, r) => s + r.amount, 0));
  return { rows, total };
}

/** Replace an opportunity's product lines with a freshly-priced set; returns the new deal value. */
export async function replaceProductLines(opportunityId: string, lines: ProductLineInput[]): Promise<number> {
  const { rows, total } = await priceLines(lines);
  await db.delete(opportunityProducts).where(eq(opportunityProducts.opportunityId, opportunityId));
  if (rows.length) {
    await db.insert(opportunityProducts).values(
      rows.map((r) => ({
        opportunityId,
        product: r.product,
        technicians: r.technicians,
        unitPrice: String(r.unitPrice),
        amount: String(r.amount),
        sortOrder: r.sortOrder,
      })),
    );
  }
  return total;
}

/** A human summary for the legacy single `product` column (e.g. "Smart Plan Survey +2 more"). */
export function summarizeProducts(lines: ProductLineInput[]): string {
  if (lines.length === 0) return "";
  const first = lines[0]!.product;
  return lines.length === 1 ? first : `${first} +${lines.length - 1} more`;
}

export async function getProductLines(opportunityId: string) {
  const rows = await db
    .select()
    .from(opportunityProducts)
    .where(eq(opportunityProducts.opportunityId, opportunityId))
    .orderBy(opportunityProducts.sortOrder);
  return rows.map((r) => ({
    id: r.id,
    product: r.product,
    technicians: r.technicians,
    unitPrice: Number(r.unitPrice),
    amount: Number(r.amount),
  }));
}
