import { toast } from "sonner";

// Plain-sentence titles for known database error codes. The verbatim error always goes in the description.
const KNOWN: [prefix: string, title: string][] = [
  ["not_approved", "Approve this draft before marking it sent"],
  ["already_sent", "This draft was already sent, so it can no longer change"],
  ["superseded_is_final", "This draft was replaced by a newer one"],
  ["rev_unchanged", "Change the rev before saving"],
  ["invalid_json", "The config is not valid JSON"],
  ["message_draft_too_short", "The message needs at least 20 characters"],
  ["already_rejected", "This account is already vetoed"],
  ["invalid_transition", "That action is not allowed in this state"],
  ["invalid_input", "Some fields are too long or missing"],
];

export function errorTitle(error: string): string {
  return KNOWN.find(([prefix]) => error.startsWith(prefix))?.[1] ?? "That did not work";
}

export function toastError(error: string) {
  toast.error(errorTitle(error), { description: error });
}
