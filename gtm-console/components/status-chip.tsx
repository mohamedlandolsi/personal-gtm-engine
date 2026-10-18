import { STATE_CLASSES, displayState, type DisplayState } from "@/lib/format";
import { cn } from "@/lib/utils";

const LABEL: Record<DisplayState, string> = {
  pending: "Pending",
  edited: "Edited",
  approved: "Approved",
  rejected: "Rejected",
  sent: "Sent",
  superseded: "Superseded",
};

// Text plus tint, no dot, no pill. Pass the raw columns or an already resolved state.
export function StatusChip({
  approval,
  send = "not_sent",
  state,
  label,
  className,
}: {
  approval?: string;
  send?: string;
  state?: DisplayState;
  label?: string;
  className?: string;
}) {
  const s = state ?? displayState(approval ?? "pending", send);
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded px-2 text-[0.8125rem] font-medium",
        STATE_CLASSES[s],
        className,
      )}
    >
      {label ?? LABEL[s]}
    </span>
  );
}
