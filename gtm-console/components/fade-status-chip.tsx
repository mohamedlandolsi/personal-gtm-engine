"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { DisplayState } from "@/lib/format";
import { CHIP_FADE_MS, motionMs } from "@/components/motion";
import { StatusChip } from "@/components/status-chip";

// StatusChip that cross-fades when its state changes after mount (a decision landed).
// The first render never animates; remount it (a new key) to switch drafts without a fade.
export function FadeStatusChip({ state }: { state: DisplayState }) {
  const [shown, setShown] = useState(state);
  const [leaving, setLeaving] = useState<DisplayState | null>(null);
  if (state !== shown) {
    setLeaving(shown);
    setShown(state);
  }

  const inRef = useRef<HTMLSpanElement>(null);
  const outRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!leaving) return;
    const timing = { duration: motionMs(CHIP_FADE_MS), easing: "ease-out" };
    const fadeIn = inRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], timing);
    const fadeOut = outRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, fill: "forwards" });
    if (fadeOut) fadeOut.onfinish = () => setLeaving(null);
    return () => {
      fadeIn?.cancel();
      fadeOut?.cancel();
    };
  }, [leaving, shown]);

  return (
    <span className="inline-grid shrink-0">
      {leaving ? (
        <span ref={outRef} aria-hidden className="col-start-1 row-start-1">
          <StatusChip state={leaving} />
        </span>
      ) : null}
      <span ref={inRef} className="col-start-1 row-start-1">
        <StatusChip state={shown} />
      </span>
    </span>
  );
}
