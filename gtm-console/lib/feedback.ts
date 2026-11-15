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
  ["needs_redraft", "Edit this draft or ask for a re-draft before approving"],
  ["invalid_scope", "Pick why you are rejecting this draft"],
  ["reason_too_long", "The reason is over 500 characters"],
  // Sprint 15: Gigs page (gtm_gig_add, gtm_gig_status)
  ["invalid_url", "Paste the full link to the post"],
  ["title_too_short", "The title needs at least 5 characters"],
  ["body_too_short", "Paste the post text, at least 20 characters"],
  ["invalid_status", "That status is not available for gig posts"],
  ["not_found", "This post is no longer in the list"],
];

export function errorTitle(error: string): string {
  return KNOWN.find(([prefix]) => error.startsWith(prefix))?.[1] ?? "That did not work";
}

export function toastError(error: string) {
  toast.error(errorTitle(error), { description: error });
}
