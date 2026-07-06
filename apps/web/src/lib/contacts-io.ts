import * as XLSX from "xlsx";
import type { Contact } from "../api/types.ts";

export interface ImportContact {
  type?: string;
  name: string;
  company?: string;
  title?: string;
  email?: string;
  phone?: string;
  phone2?: string;
  address?: string;
  notes?: string;
}

/** Parse a .xlsx/.csv into contact rows, mapping common column headers flexibly. */
export async function parseContactsFile(file: File): Promise<ImportContact[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf);
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) return [];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  const get = (row: Record<string, unknown>, names: string[]) => {
    for (const key of Object.keys(row)) {
      if (names.includes(key.trim().toLowerCase())) return String(row[key] ?? "").trim();
    }
    return "";
  };
  const types = new Set(["customer", "lead", "partner", "other"]);
  return json
    .map((r) => {
      const rawType = get(r, ["type", "category"]).toLowerCase();
      return {
        name: get(r, ["name", "full name", "contact", "contact name"]),
        company: get(r, ["company", "organization", "organisation", "account"]),
        title: get(r, ["title", "job title", "role"]),
        email: get(r, ["email", "e-mail", "email address"]),
        phone: get(r, ["phone", "phone number", "mobile", "cell", "telephone", "phone 1"]),
        phone2: get(r, ["phone2", "phone 2", "secondary phone", "work phone", "alt phone"]),
        address: get(r, ["address", "street", "location"]),
        type: types.has(rawType) ? rawType : undefined,
        notes: get(r, ["notes", "note", "comments"]),
      } as ImportContact;
    })
    .filter((c) => c.name);
}

/** Download the contact list as an .xlsx file. */
export function exportContactsXlsx(rows: Contact[]) {
  const header = ["Name", "Type", "Company", "Title", "Email", "Phone", "Phone 2", "Address", "Notes"];
  const aoa = [
    header,
    ...rows.map((c) => [c.name, c.type, c.company ?? "", c.title ?? "", c.email ?? "", c.phone ?? "", c.phone2 ?? "", c.address ?? "", c.notes ?? ""]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = header.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Address Book");
  XLSX.writeFile(wb, "address-book.xlsx");
}

/** Import from the device's phone contacts via the Contact Picker API (mobile Chrome). */
export function phoneContactsSupported(): boolean {
  return typeof navigator !== "undefined" && "contacts" in navigator && "select" in (navigator as Navigator & { contacts?: { select?: unknown } }).contacts!;
}

export async function pickPhoneContacts(): Promise<ImportContact[]> {
  const nav = navigator as Navigator & {
    contacts?: { select: (props: string[], opts: { multiple: boolean }) => Promise<{ name?: string[]; email?: string[]; tel?: string[] }[]> };
  };
  if (!nav.contacts) return [];
  const picked = await nav.contacts.select(["name", "email", "tel"], { multiple: true });
  return picked
    .map((p) => ({
      name: p.name?.[0] ?? "",
      email: p.email?.[0] ?? "",
      phone: p.tel?.[0] ?? "",
      phone2: p.tel?.[1] ?? "",
      type: "lead" as const,
    }))
    .filter((c) => c.name);
}
