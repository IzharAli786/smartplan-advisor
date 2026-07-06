import { useEffect, useRef, useState } from "react";
import { api } from "../api/client.ts";

interface HighFive {
  id: string;
  fromName: string | null;
  message: string | null;
  createdAt: string;
}

/** Plays a short celebratory chord via Web Audio (no asset needed). Best-effort. */
function playChord() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const t = now + i * 0.07;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.6);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1400);
  } catch {
    /* audio blocked — visual still shows */
  }
}

/** Global overlay: polls for high-fives sent to the current user and animates them. */
export default function HighFiveOverlay() {
  const [current, setCurrent] = useState<HighFive | null>(null);
  const queue = useRef<HighFive[]>([]);

  function present(list: HighFive[]) {
    if (list.length === 0) return;
    queue.current = list.slice(1);
    setCurrent(list[0]!);
    playChord();
  }

  useEffect(() => {
    let active = true;
    const poll = async () => {
      if (current) return;
      try {
        const res = await api.get<{ highFives: HighFive[] }>("/api/high-fives/pending");
        if (active && res.highFives.length) present(res.highFives);
      } catch {
        /* ignore */
      }
    };
    poll();
    const t = setInterval(poll, 20000);
    return () => {
      active = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  async function dismiss() {
    const c = current;
    if (c) {
      try {
        await api.post(`/api/high-fives/${c.id}/seen`);
      } catch {
        /* ignore */
      }
    }
    const next = queue.current.shift() ?? null;
    setCurrent(next);
    if (next) playChord();
  }

  if (!current) return null;
  return (
    <div className="hf-overlay" onClick={dismiss}>
      <div className="hf-card">
        <div className="hf-hand">🙌</div>
        <div className="hf-title">High Five!</div>
        <div className="hf-sub">{current.message || `${current.fromName ?? "Your manager"} says great work!`}</div>
        <div className="hf-wave">
          {Array.from({ length: 9 }).map((_, i) => (
            <span key={i} style={{ animationDelay: `${i * 0.08}s` }} />
          ))}
        </div>
        <div className="hf-hint">Tap anywhere to continue</div>
      </div>
    </div>
  );
}
