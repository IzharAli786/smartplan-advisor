import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import type { ReportColumn, ReportData, ReportColType } from "../api/types.ts";
import { dateShort, money } from "./format.ts";

/** Display string for a value, by column type (used in PDF + on-screen). */
export function fmt(value: unknown, type?: ReportColType): string {
  if (value === null || value === undefined || value === "") return type === "text" ? "" : "—";
  switch (type) {
    case "currency":
      return money(Number(value));
    case "percent":
      return `${Number(value)}%`;
    case "date":
      return dateShort(String(value));
    case "number":
      return new Intl.NumberFormat("en-US").format(Number(value));
    default:
      return String(value);
  }
}

/** Raw value for Excel (numbers stay numeric so Excel can sum). */
function xlsxValue(value: unknown, type?: ReportColType): string | number {
  if (value === null || value === undefined || value === "") return "";
  if (type === "currency" || type === "number") return Number(value);
  if (type === "percent") return Number(value);
  if (type === "date") return dateShort(String(value));
  return String(value);
}

function fileBase(report: ReportData): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${report.key}-${stamp}`;
}

function totalsRow(report: ReportData, render: (v: unknown, t?: ReportColType) => string | number): (string | number)[] | null {
  if (!report.totals) return null;
  return report.columns.map((c) => (report.totals && c.key in report.totals ? render(report.totals[c.key], c.type) : ""));
}

/** Export a report to a landscape PDF with a formatted table. */
export function exportPdf(report: ReportData, range?: { from: string; to: string }) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(16);
  doc.setTextColor(30, 42, 56);
  doc.text(report.title, 40, 40);
  doc.setFontSize(10);
  doc.setTextColor(120, 135, 145);
  const sub = [report.subtitle, report.dateRange && range ? `${dateShort(range.from)} – ${dateShort(range.to)}` : "", `Generated ${dateShort(new Date())}`]
    .filter(Boolean)
    .join("   ·   ");
  doc.text(sub, 40, 58);

  const head = [report.columns.map((c) => c.label)];
  const body = report.rows.map((r) => report.columns.map((c) => fmt(r[c.key], c.type)));
  const foot = totalsRow(report, (v, t) => fmt(v, t));

  autoTable(doc, {
    head,
    body,
    foot: foot ? [foot.map(String)] : undefined,
    startY: 72,
    styles: { fontSize: 9, cellPadding: 5, textColor: [30, 42, 56] },
    headStyles: { fillColor: [14, 124, 196], textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [238, 241, 245], textColor: [30, 42, 56], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 40, right: 40 },
  });
  doc.save(`${fileBase(report)}.pdf`);
}

export interface QuotePdfData {
  quoteNumber: string;
  title: string;
  company: string;
  advisorName?: string;
  lineItems: { product: string | null; description: string | null; quantity: number; unitPrice: number; amount: number }[];
  subtotal: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  validUntil: string | null;
  notes: string | null;
  signerName: string | null;
  signedAt: string | null;
}

/** Branded quote/proposal PDF (portrait). */
export function exportQuotePdf(q: QuotePdfData) {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pw = doc.internal.pageSize.getWidth();

  doc.setFontSize(22);
  doc.setTextColor(14, 124, 196);
  doc.setFont("helvetica", "bold");
  doc.text("SmartPlan", 40, 54);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(120, 135, 145);
  doc.text("Quote / Proposal", 40, 72);

  doc.setFontSize(13);
  doc.setTextColor(30, 42, 56);
  doc.text(q.quoteNumber, pw - 40, 54, { align: "right" });
  doc.setFontSize(10);
  doc.setTextColor(120, 135, 145);
  doc.text(`Date: ${dateShort(new Date())}`, pw - 40, 70, { align: "right" });
  if (q.validUntil) doc.text(`Valid until: ${dateShort(q.validUntil)}`, pw - 40, 84, { align: "right" });

  doc.setFontSize(10);
  doc.setTextColor(81, 96, 111);
  doc.text("PREPARED FOR", 40, 110);
  doc.setFontSize(13);
  doc.setTextColor(30, 42, 56);
  doc.text(q.company || "—", 40, 128);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text(q.title, 40, 156);
  doc.setFont("helvetica", "normal");

  autoTable(doc, {
    startY: 172,
    head: [["Item", "Qty", "Unit Price", "Amount"]],
    body: q.lineItems.map((l) => [
      [l.product, l.description].filter(Boolean).join(" — ") || "Item",
      new Intl.NumberFormat("en-US").format(l.quantity),
      money(l.unitPrice),
      money(l.amount),
    ]),
    styles: { fontSize: 10, cellPadding: 6, textColor: [30, 42, 56] },
    headStyles: { fillColor: [14, 124, 196], textColor: 255 },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    margin: { left: 40, right: 40 },
  });

  // Totals block
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;
  const labelX = pw - 200;
  const valX = pw - 40;
  const line = (label: string, val: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 13 : 11);
    doc.setTextColor(bold ? 30 : 81, bold ? 42 : 96, bold ? 56 : 111);
    doc.text(label, labelX, y);
    doc.text(val, valX, y, { align: "right" });
    y += bold ? 22 : 18;
  };
  line("Subtotal", money(q.subtotal));
  if (q.discount > 0) line("Discount", `-${money(q.discount)}`);
  if (q.taxRate > 0) line(`Tax (${q.taxRate}%)`, money(q.taxAmount));
  line("Total", money(q.total), true);

  if (q.notes) {
    y += 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(81, 96, 111);
    doc.text("TERMS", 40, y);
    y += 16;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 72, 84);
    doc.text(doc.splitTextToSize(q.notes, pw - 80), 40, y);
  }

  if (q.signerName && q.signedAt) {
    const sy = doc.internal.pageSize.getHeight() - 70;
    doc.setDrawColor(205, 213, 223);
    doc.line(40, sy, 280, sy);
    doc.setFontSize(13);
    doc.setTextColor(30, 42, 56);
    doc.setFont("helvetica", "italic");
    doc.text(q.signerName, 44, sy - 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120, 135, 145);
    doc.text(`Signed electronically on ${dateShort(q.signedAt)}`, 40, sy + 14);
  }

  doc.save(`${q.quoteNumber}.pdf`);
}

export interface StatementData {
  advisorName: string;
  advisorEmail: string;
  from: string;
  to: string;
  rows: { company: string; convertedAt: string; dealValue: number; rate: number; commission: number }[];
  totals: { deals: number; dealValue: number; commission: number };
}

/** Per-advisor commission statement PDF (portrait, branded). */
export function exportStatementPdf(s: StatementData) {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pw = doc.internal.pageSize.getWidth();
  doc.setFontSize(20);
  doc.setTextColor(14, 124, 196);
  doc.setFont("helvetica", "bold");
  doc.text("SmartPlan", 40, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.setTextColor(30, 42, 56);
  doc.text("Commission Statement", 40, 72);
  doc.setFontSize(10);
  doc.setTextColor(120, 135, 145);
  doc.text(`${s.advisorName}  ·  ${s.advisorEmail}`, 40, 90);
  doc.text(`Period: ${dateShort(s.from)} – ${dateShort(s.to)}`, pw - 40, 90, { align: "right" });

  autoTable(doc, {
    startY: 110,
    head: [["Company", "Converted", "Deal Value", "Rate %", "Commission"]],
    body: s.rows.map((r) => [r.company, dateShort(r.convertedAt), money(r.dealValue), `${r.rate}%`, money(r.commission)]),
    foot: [["Total", `${s.totals.deals} deals`, money(s.totals.dealValue), "", money(s.totals.commission)]],
    styles: { fontSize: 10, cellPadding: 6, textColor: [30, 42, 56] },
    headStyles: { fillColor: [14, 124, 196], textColor: 255 },
    footStyles: { fillColor: [238, 241, 245], textColor: [30, 42, 56], fontStyle: "bold" },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
    margin: { left: 40, right: 40 },
  });
  doc.save(`commission-statement-${s.advisorName.replace(/\s+/g, "-")}.pdf`);
}

/** Export a report to an .xlsx workbook. */
export function exportXlsx(report: ReportData) {
  const header = report.columns.map((c: ReportColumn) => c.label);
  const rows = report.rows.map((r) => report.columns.map((c) => xlsxValue(r[c.key], c.type)));
  const aoa: (string | number)[][] = [header, ...rows];
  const totals = totalsRow(report, (v, t) => xlsxValue(v, t));
  if (totals) aoa.push(totals);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = report.columns.map((c) => ({ wch: Math.max(12, c.label.length + 4) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, report.title.slice(0, 31));
  XLSX.writeFile(wb, `${fileBase(report)}.xlsx`);
}
