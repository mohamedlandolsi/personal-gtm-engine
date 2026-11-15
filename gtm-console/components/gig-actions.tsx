"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setGigStatus } from "@/app/(console)/gigs/actions";
import { toastError } from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Action = "replied" | "won" | "lost" | "dismiss";

const LABEL: Record<Action, string> = { replied: "Replied", won: "Won", lost: "Lost", dismiss: "Dismiss" };
const DONE: Record<Action, string> = { replied: "Marked replied", won: "Marked won", lost: "Marked lost", dismiss: "Dismissed" };
const WHAT: Record<Action, string> = {
  replied: "The poster answered you. The post moves to Replied.",
  won: "You got the work. Won is final, apart from switching to Lost.",
  lost: "The post went to someone else or went quiet. Lost is final, apart from switching to Won.",
  dismiss: "The post is set aside and the Gig Finder will not draft it again.",
};

// Which buttons a post offers, by gig_posts.status. Same rules as gtm_gig_status() in Postgres.
function actionsFor(status: string): Action[] {
  if (status === "won") return ["lost"];
  if (status === "lost") return ["won"];
  if (status === "replied") return ["won", "lost"];
  if (status === "sent") return ["replied", "won", "lost"];
  if (status === "drafted" || status === "expired") return ["replied", "won", "lost", "dismiss"];
  if (status === "new") return ["dismiss"];
  return [];
}

export function GigActions({ postKey, status, title }: { postKey: string; status: string; title: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [pending, startTransition] = useTransition();
  const actions = actionsFor(status);
  if (!actions.length) return null;

  function run(action: Action) {
    startTransition(async () => {
      const res = await setGigStatus({ postKey, status: action });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      toast.success(DONE[action]);
      setConfirm(null);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Button
            key={a}
            variant={a === "dismiss" ? "ghost" : "outline"}
            className="h-11 sm:h-8"
            disabled={pending}
            onClick={() => setConfirm(a)}
          >
            {LABEL[a]}
          </Button>
        ))}
      </div>
      <Dialog open={confirm !== null} onOpenChange={(o) => { if (!pending && !o) setConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="leading-snug">
              {confirm ? `${LABEL[confirm]}: ${title}` : ""}
            </DialogTitle>
            <DialogDescription>{confirm ? WHAT[confirm] : ""}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="h-11 sm:h-9" disabled={pending} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button className="h-11 sm:h-9" disabled={pending || !confirm} onClick={() => confirm && run(confirm)}>
              {confirm ? LABEL[confirm] : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
