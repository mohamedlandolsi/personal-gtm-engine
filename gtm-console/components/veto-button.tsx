"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { vetoAccount } from "@/app/(console)/accounts/actions";
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
import { Textarea } from "@/components/ui/textarea";

const REASON_MAX = 300;

export function VetoButton({ accountId, companyName }: { accountId: string; companyName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  function veto() {
    startTransition(async () => {
      const res = await vetoAccount({ accountId, reason: reason.trim() || undefined });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      toast.success("Account vetoed");
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="ghost" className="h-11 text-danger hover:text-danger sm:h-9" onClick={() => setOpen(true)}>
        Veto account
      </Button>
      <Dialog open={open} onOpenChange={(o) => { if (!pending) setOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="leading-snug">Veto {companyName}?</DialogTitle>
            <DialogDescription>
              The account is marked rejected and the engine skips it from the next run. Existing drafts stay as they are.
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1">
            <span className="text-[0.8125rem] font-medium text-muted-foreground">Reason (optional)</span>
            <Textarea
              rows={3}
              maxLength={REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example: competitor, too small, already a customer"
            />
            <span className="tabular block text-right text-[0.8125rem] text-ink-3">
              {reason.length} of {REASON_MAX}
            </span>
          </label>
          <DialogFooter>
            <Button variant="outline" className="h-11 sm:h-9" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" className="h-11 sm:h-9" disabled={pending} onClick={veto}>
              Veto account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
