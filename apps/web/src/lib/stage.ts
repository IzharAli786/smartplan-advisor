import type { StatusStage } from "../api/types.ts";

/** Distinct colours for non-terminal stages, assigned by pipeline position. */
const STAGE_TONES = ["tone-sky", "tone-amber", "tone-violet", "tone-teal", "tone-rose"] as const;

/** Map a pipeline stage to a <StatusBadge> kind so every status gets its own
 *  colour: conversion → green, terminal (lost) → red, the rest cycle a fixed
 *  palette by sortOrder so a stage keeps its colour on every page. */
export function stageTone(stage: StatusStage | undefined): string | undefined {
  if (!stage) return undefined;
  if (stage.isConversion) return "success";
  if (stage.isTerminal) return "overdue";
  const i = Math.max(0, Math.round(stage.sortOrder) - 1);
  return STAGE_TONES[i % STAGE_TONES.length];
}
