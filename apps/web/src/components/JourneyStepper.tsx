import { useState } from "react";
import { useApi } from "../hooks/useApi.ts";
import { api } from "../api/client.ts";
import { Card } from "./ui.tsx";
import { Icon } from "./Icon.tsx";
import { dateShort } from "../lib/format.ts";
import type { JourneyItem } from "../api/types.ts";

/**
 * Graphical "Stages" stepper for an opportunity — the configurable touchpoint journey
 * (Intro Call → Intro Email → … → Trial Started). Click a step to mark it done/undone.
 */
export default function JourneyStepper({ opportunityId }: { opportunityId: string }) {
  const { data, reload } = useApi<{ journey: JourneyItem[] }>(`/api/opportunities/${opportunityId}/journey`, [opportunityId]);
  const [busy, setBusy] = useState<string | null>(null);
  const journey = data?.journey ?? [];

  async function toggle(item: JourneyItem) {
    setBusy(item.stageId);
    try {
      await api.post(`/api/opportunities/${opportunityId}/journey/${item.stageId}`, { done: !item.completedAt });
      reload();
    } finally {
      setBusy(null);
    }
  }

  if (journey.length === 0) return null;
  const doneCount = journey.filter((s) => s.completedAt).length;

  return (
    <Card>
      <div className="row">
        <h3 style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
          <Icon name="activity" size={17} /> Stages
        </h3>
        <span className="muted" style={{ fontSize: ".8rem" }}>
          {doneCount}/{journey.length} complete
        </span>
      </div>
      <div className="journey">
        {journey.map((s, i) => (
          <button
            key={s.stageId}
            type="button"
            className={`journey-step ${s.completedAt ? "done" : ""}`}
            onClick={() => toggle(s)}
            disabled={busy === s.stageId}
            title={s.completedAt ? `Completed ${dateShort(s.completedAt)} — click to undo` : "Click to mark complete"}
          >
            <span className="journey-dot">{s.completedAt ? <Icon name="check" size={16} /> : i + 1}</span>
            <span className="journey-label">{s.label}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
