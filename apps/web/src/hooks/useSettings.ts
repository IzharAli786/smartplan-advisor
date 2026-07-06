import { useApi } from "./useApi.ts";
import type { JourneyStage, Product, StatusStage } from "../api/types.ts";

export function useStages() {
  return useApi<{ stages: StatusStage[] }>("/api/settings/status-stages");
}

export function useProducts() {
  return useApi<{ products: Product[] }>("/api/settings/products");
}

export function useJourneyStages() {
  return useApi<{ stages: JourneyStage[] }>("/api/settings/journey-stages");
}

/** Build a key→label map for displaying stages with their (possibly renamed) label. */
export function stageLabelMap(stages: StatusStage[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  for (const s of stages ?? []) map[s.key] = s.label;
  return map;
}

export function prettyKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
