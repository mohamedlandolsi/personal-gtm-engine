"use client";

import { useEffect, useEffectEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { review } from "@/app/(console)/queue/actions";
import { STATE_RULE, displayState } from "@/lib/format";
import { toastError } from "@/lib/feedback";
import { cn } from "@/lib/utils";
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
import { StatusChip } from "@/components/status-chip";

const FIELDS = [
  "email_subject",
  "message_draft",
  "follow_up_1",
  "follow_up_2",
  "follow_up_3",
  "linkedin_note",
  "notes",
] as const;
type Field = (typeof FIELDS)[number];
type Draft = Record<Field, string | null>;
type Action = "approve" | "reject" | "reopen" | "save_edits" | "mark_sent" | "redraft";
type Confirmable = "reject" | "redraft" | "mark_sent";

const CONTENT_FIELDS: Field[] = ["email_subject", "message_draft", "follow_up_1", "follow_up_2", "follow_up_3", "linkedin_note"];
const FOLLOW_UPS = ["follow_up_1", "follow_up_2", "follow_up_3"] as const;
const LINKEDIN_MAX = 300;
const LINKEDIN_WARN = 280;

// Toast titles match the button verbs.
const DONE: Record<Exclude<Action, "save_edits">, string> = {
  approve: "Approved",
  reject: "Rejected",
  reopen: "Reopened",
  mark_sent: "Marked sent",
  redraft: "Re-draft requested",
};

function toValues(d: Draft): Record<Field, string> {
  return Object.fromEntries(FIELDS.map((f) => [f, d[f] ?? ""])) as Record<Field, string>;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied");
  } catch {
    toast.error("Copy did not work", { description: "The clipboard is not available in this browser." });
  }
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="ml-1 hidden rounded border border-current/30 px-1 font-sans text-[0.6875rem] leading-4 opacity-70 lg:inline">
      {children}
    </kbd>
  );
}

function Copy({ value }: { value: string | null }) {
  return value ? (
    <p className="max-w-[64ch] font-serif text-[1.0625rem] leading-[1.6] whitespace-pre-wrap">{value}</p>
  ) : (
    <p className="text-ink-3">Empty</p>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[0.8125rem] font-medium text-muted-foreground">{children}</p>;
}

// Hairline that fills toward 300; turns danger past 280.
function NoteCounter({ length }: { length: number }) {
  const warn = length > LINKEDIN_WARN;
  return (
    <div className="space-y-1">
      <div className="h-px bg-border" aria-hidden>
        <div
          className={cn("h-px", warn ? "bg-danger" : "bg-meter-fill")}
          style={{ width: `${Math.min(100, (length / LINKEDIN_MAX) * 100)}%` }}
        />
      </div>
      <p className={cn("tabular text-[0.8125rem]", warn ? "font-medium text-danger" : "text-ink-3")}>
        {length} of {LINKEDIN_MAX} characters
      </p>
    </div>
  );
}

export function ReviewActions({
  id,
  approvalStatus,
  sendStatus,
  channel,
  companyName,
  contactName,
  contactEmail,
  prevId,
  nextId,
  draft,
}: {
  id: string;
  approvalStatus: string;
  sendStatus: string;
  channel: string | null;
  companyName: string;
  contactName: string;
  contactEmail: string | null;
  prevId: string | null;
  nextId: string | null;
  draft: Draft;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState(() => toValues(draft));
  const [confirm, setConfirm] = useState<Confirmable | null>(null);

  const state = displayState(approvalStatus, sendStatus);
  const notSent = sendStatus === "not_sent";
  const readOnly = !notSent || approvalStatus === "superseded";
  const reviewable = notSent && (approvalStatus === "pending" || approvalStatus === "edited");
  const approved = notSent && approvalStatus === "approved";
  const rejected = notSent && approvalStatus === "rejected";
  const canEdit = reviewable || approved;
  const linkedinFirst = channel === "linkedin_manual";

  const noteLength = (editing ? values.linkedin_note : (draft.linkedin_note ?? "")).length;
  const noteTooLong = editing && noteLength > LINKEDIN_MAX;
  const email = [draft.email_subject, draft.message_draft].filter(Boolean).join("\n\n");

  function run(action: Action, edits?: Partial<Record<Field, string>>) {
    startTransition(async () => {
      const res = await review({ id, action, edits });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      if (action === "save_edits") {
        const contentChanged = Object.keys(edits ?? {}).some((k) => CONTENT_FIELDS.includes(k as Field));
        toast.success(approved && contentChanged ? "Changes saved, needs approval again" : "Changes saved");
      } else {
        toast.success(DONE[action]);
      }
      setConfirm(null);
      setEditing(false);
      router.refresh();
    });
  }

  function startEdit() {
    setValues(toValues(draft));
    setEditing(true);
  }

  function save() {
    if (noteTooLong) return;
    const edits: Partial<Record<Field, string>> = {};
    for (const f of FIELDS) if (values[f] !== (draft[f] ?? "")) edits[f] = values[f];
    if (Object.keys(edits).length === 0) {
      toast("No changes to save");
      setEditing(false);
      return;
    }
    run("save_edits", edits);
  }

  // Keyboard-first review on desktop: A approve, E edit, R reject, J next, K previous.
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || editing || confirm || pending) return;
    const key = e.key.toLowerCase();
    if (key === "a" && reviewable) run("approve");
    else if (key === "e" && canEdit) startEdit();
    else if (key === "r" && (reviewable || approved)) setConfirm("reject");
    else if (key === "j" && nextId) router.push(`/queue/${encodeURIComponent(nextId)}`);
    else if (key === "k" && prevId) router.push(`/queue/${encodeURIComponent(prevId)}`);
    else return;
    e.preventDefault();
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const set = (f: Field) => (e: React.ChangeEvent<HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [f]: e.target.value }));

  const btn = "h-11 sm:h-9";
  let buttons: React.ReactNode;
  if (readOnly) {
    buttons = (
      <p className="flex items-center gap-2 text-[0.9375rem] text-muted-foreground">
        <StatusChip state={state} />
        No further actions for this draft.
      </p>
    );
  } else if (editing) {
    buttons = (
      <>
        <Button className={cn(btn, "flex-[2] sm:flex-none")} disabled={pending || noteTooLong} onClick={save}>
          Save
        </Button>
        <Button variant="outline" className={cn(btn, "flex-1 sm:flex-none")} disabled={pending} onClick={() => setEditing(false)}>
          Cancel
        </Button>
        {noteTooLong ? (
          <p className="hidden text-[0.8125rem] font-medium text-danger sm:block">The LinkedIn note is over 300 characters.</p>
        ) : null}
      </>
    );
  } else if (rejected) {
    buttons = (
      <>
        <Button className={cn(btn, "flex-[2] sm:flex-none")} disabled={pending} onClick={() => run("reopen")}>
          Reopen
        </Button>
        <Button variant="ghost" className={cn(btn, "flex-1 sm:flex-none")} disabled={pending} onClick={() => setConfirm("redraft")}>
          Re-draft
        </Button>
      </>
    );
  } else {
    buttons = (
      <>
        {approved ? (
          <Button className={cn(btn, "flex-[2] sm:flex-none")} disabled={pending} onClick={() => setConfirm("mark_sent")}>
            Mark sent
          </Button>
        ) : (
          <Button className={cn(btn, "flex-[2] sm:flex-none")} disabled={pending} onClick={() => run("approve")}>
            Approve<Kbd>A</Kbd>
          </Button>
        )}
        <Button variant="outline" className={cn(btn, "flex-1 sm:flex-none")} disabled={pending} onClick={startEdit}>
          Edit<Kbd>E</Kbd>
        </Button>
        <Button variant="outline" className={cn(btn, "flex-1 sm:flex-none")} disabled={pending} onClick={() => setConfirm("reject")}>
          Reject<Kbd>R</Kbd>
        </Button>
        <Button variant="ghost" className={cn(btn, "flex-1 sm:flex-none")} disabled={pending} onClick={() => setConfirm("redraft")}>
          Re-draft
        </Button>
      </>
    );
  }

  const confirmCopy: Record<Confirmable, { title: string; body: string; button: string }> = {
    reject: {
      title: `Reject the draft to ${contactName} at ${companyName}?`,
      body: "It leaves the review queue. You can reopen it later.",
      button: "Reject",
    },
    redraft: {
      title: `Ask for a new draft to ${contactName} at ${companyName}?`,
      body: "This draft becomes superseded, which is final, and the contact is freed so the next engine run writes a new one.",
      button: "Re-draft",
    },
    mark_sent: {
      title: `Mark the message to ${contactName} at ${companyName} as sent?`,
      body: "Only do this after you sent it yourself. It cannot be undone.",
      button: "Mark sent",
    },
  };

  const noteBlock = (
    <div className="space-y-2">
      <Label>LinkedIn note</Label>
      {editing ? (
        <Textarea rows={4} value={values.linkedin_note} onChange={set("linkedin_note")} aria-label="LinkedIn note" className="font-serif text-[1.0625rem] md:text-[1.0625rem]" />
      ) : (
        <Copy value={draft.linkedin_note} />
      )}
      <NoteCounter length={noteLength} />
      {noteTooLong ? <p className="text-[0.8125rem] font-medium text-danger sm:hidden">Shorten the note to save.</p> : null}
    </div>
  );

  const emailBlock = (
    <div className="space-y-3">
      {editing ? (
        <>
          <div className="space-y-1">
            <Label>Subject</Label>
            <Textarea rows={1} maxLength={160} value={values.email_subject} onChange={set("email_subject")} aria-label="Subject" className="font-serif text-[1.1875rem] font-medium md:text-[1.1875rem]" />
          </div>
          <div className="space-y-1">
            <Label>{linkedinFirst ? "Message" : "Body"}</Label>
            <Textarea rows={8} maxLength={2500} value={values.message_draft} onChange={set("message_draft")} aria-label="Message body" className="font-serif text-[1.0625rem] leading-[1.6] md:text-[1.0625rem]" />
          </div>
        </>
      ) : (
        <>
          {draft.email_subject ? (
            <p className="max-w-[64ch] font-serif text-[1.1875rem] leading-[1.35] font-medium">{draft.email_subject}</p>
          ) : null}
          {linkedinFirst ? <Label>Message</Label> : null}
          <Copy value={draft.message_draft} />
        </>
      )}
    </div>
  );

  return (
    <>
      {/* Phones: fixed above the tab bar (h-14). From sm up: a toolbar at the top of the detail pane. */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t bg-card px-3 py-2 shadow-lg sm:static sm:z-auto sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
        <div className="flex items-center gap-2">{buttons}</div>
      </div>

      <article className={cn("space-y-5 rounded-sm border border-l-[3px] bg-card p-4 sm:p-6", STATE_RULE[state])}>
        <div className="flex flex-wrap gap-2">
          {linkedinFirst && draft.linkedin_note ? (
            <Button size="sm" variant="outline" className="h-11 sm:h-7" onClick={() => copy(draft.linkedin_note ?? "")}>Copy note</Button>
          ) : null}
          {email ? (
            <Button size="sm" variant="outline" className="h-11 sm:h-7" onClick={() => copy(email)}>Copy email</Button>
          ) : null}
          {!linkedinFirst && draft.linkedin_note ? (
            <Button size="sm" variant="outline" className="h-11 sm:h-7" onClick={() => copy(draft.linkedin_note ?? "")}>Copy note</Button>
          ) : null}
          {contactEmail ? (
            <Button size="sm" variant="outline" className="h-11 sm:h-7" onClick={() => copy(contactEmail)}>Copy address</Button>
          ) : null}
        </div>

        {linkedinFirst ? (
          <>
            {noteBlock}
            {emailBlock}
          </>
        ) : (
          <>
            {emailBlock}
            {draft.linkedin_note || editing ? noteBlock : null}
          </>
        )}

        <div className="space-y-2 border-t pt-4">
          <Label>Follow-ups</Label>
          <ol className="space-y-3">
            {FOLLOW_UPS.map((f, i) => (
              <li key={f} className="grid grid-cols-[1.5rem_1fr] gap-1">
                <span className="tabular pt-0.5 font-semibold text-ink-3">{i + 1}.</span>
                {editing ? (
                  <Textarea rows={3} maxLength={1200} value={values[f]} onChange={set(f)} aria-label={`Follow-up ${i + 1}`} className="font-serif text-[1.0625rem] md:text-[1.0625rem]" />
                ) : (
                  <Copy value={draft[f]} />
                )}
              </li>
            ))}
          </ol>
        </div>
      </article>

      <section className="space-y-2 rounded-lg border bg-card p-4">
        <h2 className="text-[1.0625rem] font-semibold">Notes</h2>
        {editing ? (
          <Textarea rows={3} maxLength={2000} value={values.notes} onChange={set("notes")} aria-label="Notes" />
        ) : draft.notes ? (
          <p className="whitespace-pre-wrap">{draft.notes}</p>
        ) : (
          <p className="text-ink-3">No notes.</p>
        )}
      </section>

      <Dialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <DialogContent>
          {confirm ? (
            <>
              <DialogHeader>
                <DialogTitle className="leading-snug">{confirmCopy[confirm].title}</DialogTitle>
                <DialogDescription>{confirmCopy[confirm].body}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" className="h-11 sm:h-9" disabled={pending} onClick={() => setConfirm(null)}>
                  Cancel
                </Button>
                <Button
                  variant={confirm === "mark_sent" ? "default" : "destructive"}
                  className="h-11 sm:h-9"
                  disabled={pending}
                  onClick={() => run(confirm)}
                >
                  {confirmCopy[confirm].button}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
