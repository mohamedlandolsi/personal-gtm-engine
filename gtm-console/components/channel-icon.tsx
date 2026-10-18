import { Mail, UserPlus } from "lucide-react";

// lucide no longer ships brand marks, so LinkedIn (a connection request) uses UserPlus.
export function ChannelIcon({ channel, className = "size-4" }: { channel: string | null; className?: string }) {
  if (channel === "email") return <Mail className={className} aria-label="Email" role="img" />;
  if (channel === "linkedin_manual") return <UserPlus className={className} aria-label="LinkedIn" role="img" />;
  return null;
}

export function channelLabel(channel: string | null): string {
  if (channel === "email") return "Email";
  if (channel === "linkedin_manual") return "LinkedIn";
  return channel ?? "Unknown channel";
}
