import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../hooks/useApi.ts";
import { Card, EmptyState, ErrorBanner, PageHead, Spinner, StatusBadge } from "../components/ui.tsx";
import { Icon } from "../components/Icon.tsx";
import { money, dateShort } from "../lib/format.ts";
import { quoteBadge } from "../lib/quote.ts";
import type { Quote } from "../api/types.ts";

const FILTERS: { key: string; label: string }[] = [
  { key: "", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "viewed", label: "Viewed" },
  { key: "signed", label: "Signed" },
];

export default function QuotesPage() {
  const { data, loading, error } = useApi<{ quotes: Quote[] }>("/api/quotes");
  const [filter, setFilter] = useState("");
  const quotes = (data?.quotes ?? []).filter((q) => !filter || q.effectiveStatus === filter || (filter === "signed" && q.status === "signed"));

  return (
    <div>
      <PageHead title="Quotes" subtitle="Proposals you've created — track viewed and signed status" />
      <ErrorBanner message={error} />

      <div className="tabs">
        {FILTERS.map((f) => (
          <button key={f.key} className={`tab ${filter === f.key ? "active" : ""}`} onClick={() => setFilter(f.key)}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner />
      ) : quotes.length === 0 ? (
        <EmptyState icon="file-text" title="No quotes yet" hint="Open an opportunity and tap “Create quote” to build your first proposal." actionLabel="Go to pipeline" actionTo="/pipeline" />
      ) : (
        quotes.map((q) => {
          const b = quoteBadge(q.effectiveStatus);
          return (
            <Link key={q.id} to={`/quotes/${q.id}`} style={{ color: "inherit" }}>
              <Card onClick={() => {}}>
                <div className="row">
                  <div className="row" style={{ gap: ".75rem", justifyContent: "flex-start" }}>
                    <span className="icon-tile">
                      <Icon name="file-text" size={20} />
                    </span>
                    <div>
                      <strong>{q.title}</strong>
                      <div className="muted" style={{ fontSize: ".78rem" }}>
                        {q.quoteNumber} · {q.contactName || q.contactEmail || "no contact"}
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <StatusBadge label={b.label} kind={b.kind} />
                    <div className="muted" style={{ fontSize: ".82rem", marginTop: 4 }}>{money(q.total)}</div>
                  </div>
                </div>
                <div className="muted" style={{ fontSize: ".75rem", marginTop: 8 }}>
                  {q.signedAt ? `Signed ${dateShort(q.signedAt)}` : q.viewedAt ? `Viewed ${dateShort(q.viewedAt)}` : q.sentAt ? `Sent ${dateShort(q.sentAt)}` : `Created ${dateShort(q.createdAt)}`}
                </div>
              </Card>
            </Link>
          );
        })
      )}
    </div>
  );
}
