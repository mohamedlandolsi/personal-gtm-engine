import { FileText, Mail, MessageSquare, MessagesSquare, UserPlus } from "lucide-react";

// lucide no longer ships brand marks, so LinkedIn (a connection request) uses UserPlus.
// Sprint 15: contact_form (agency directory profile), forum_reply and forum_dm (gig posts).
export function ChannelIcon({ channel, className = "size-4" }: { channel: string | null; className?: string }) {
  if (channel === "email") return <Mail className={className} aria-label="Email" role="img" />;
  if (channel === "linkedin_manual") return <UserPlus className={className} aria-label="LinkedIn" role="img" />;
  if (channel === "contact_form") return <FileText className={className} aria-label="Contact form" role="img" />;
  if (channel === "forum_reply") return <MessagesSquare className={className} aria-label="Forum reply" role="img" />;
  if (channel === "forum_dm") return <MessageSquare className={className} aria-label="Forum message" role="img" />;
  return null;
}

export function channelLabel(channel: string | null): string {
  if (channel === "email") return "Email";
  if (channel === "linkedin_manual") return "LinkedIn";
  if (channel === "contact_form") return "Contact form";
  if (channel === "forum_reply") return "Forum reply";
  if (channel === "forum_dm") return "Forum message";
  return channel ?? "Unknown channel";
}
