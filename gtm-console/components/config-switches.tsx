"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { saveConfig } from "@/app/(console)/config/actions";
import { getPath, parseConfig, setPath, tunisRev } from "@/lib/config-text";
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
import { Switch } from "@/components/ui/switch";

const TOGGLES = [
  { path: "enabled", label: "Engine", hint: "Master switch for every engine run" },
  { path: "outreach.enabled", label: "Outreach drafting", hint: "Writes new drafts for review" },
] as const;

const CAP_PATH = "outreach.max_per_day";
const CAP_MIN = 0;
const CAP_MAX = 10;

type Change = { path: string; value: boolean | number; title: string; note: string };

export function ConfigSwitches({ savedText, editorDirty }: { savedText: string; editorDirty: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [change, setChange] = useState<Change | null>(null);

  const parsed = parseConfig(savedText);
  const savedCap = parsed.ok ? Number(getPath(parsed.obj, CAP_PATH) ?? 0) : 0;
  const [cap, setCap] = useState(savedCap);
  const locked = !parsed.ok || editorDirty || pending;

  if (!parsed.ok) {
    return (
      <section className="rounded-lg border bg-card p-4">
        <p className="text-danger">The saved config is not valid JSON, so quick switches are off. Fix it in the editor.</p>
      </section>
    );
  }

  function askToggle(path: string, label: string, on: boolean) {
    setChange({
      path,
      value: on,
      title: `Turn ${on ? "on" : "off"} ${label.toLowerCase()}?`,
      note: `Quick switch: ${path} ${on ? "on" : "off"}`,
    });
  }

  function askCap() {
    setChange({
      path: CAP_PATH,
      value: cap,
      title: `Change the daily cap from ${savedCap} to ${cap}?`,
      note: `Quick switch: ${CAP_PATH} ${savedCap} to ${cap}`,
    });
  }

  function apply(c: Change) {
    if (!parsed.ok) return;
    const rev = tunisRev();
    const text = JSON.stringify(setPath(setPath(parsed.obj, c.path, c.value), "rev", rev), null, 4);
    startTransition(async () => {
      const res = await saveConfig(text, c.note);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      toast.success("Saved");
      setChange(null);
      router.refresh();
    });
  }

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <h2 className="text-[1.0625rem] font-semibold">Quick switches</h2>
      {editorDirty ? (
        <p className="text-[0.8125rem] text-muted-foreground">
          Save or reset your edits in the JSON editor first. A switch saves the last saved version.
        </p>
      ) : null}

      <ul className="divide-y divide-border">
        {TOGGLES.map((t) => {
          const on = getPath(parsed.obj, t.path) === true;
          const id = `switch-${t.path.replace(/\./g, "-")}`;
          return (
            <li key={t.path} className="flex min-h-14 items-center gap-3 py-2 first:pt-0">
              <label htmlFor={id} className="min-w-0 flex-1">
                <span className="block font-medium">{t.label}</span>
                <span className="block text-[0.8125rem] text-muted-foreground">{t.hint}</span>
              </label>
              <span className="tabular w-7 text-right text-[0.8125rem] text-ink-3">{on ? "On" : "Off"}</span>
              <Switch
                id={id}
                aria-label={t.label}
                checked={on}
                disabled={locked}
                onCheckedChange={(next) => askToggle(t.path, t.label, next)}
              />
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 border-t pt-4">
        <p className="font-medium" id="cap-label">Daily outreach cap</p>
        <p className="text-[0.8125rem] text-muted-foreground">Drafts per day, from {CAP_MIN} to {CAP_MAX}.</p>
        <div className="flex items-center gap-2" role="group" aria-labelledby="cap-label">
          <Button
            variant="outline"
            size="icon"
            className="size-11 sm:size-8"
            aria-label="Lower the daily cap"
            disabled={locked || cap <= CAP_MIN}
            onClick={() => setCap((c) => Math.max(CAP_MIN, c - 1))}
          >
            <Minus aria-hidden />
          </Button>
          <span className="tabular w-10 text-center text-lg font-semibold" aria-live="polite">{cap}</span>
          <Button
            variant="outline"
            size="icon"
            className="size-11 sm:size-8"
            aria-label="Raise the daily cap"
            disabled={locked || cap >= CAP_MAX}
            onClick={() => setCap((c) => Math.min(CAP_MAX, c + 1))}
          >
            <Plus aria-hidden />
          </Button>
          {cap !== savedCap ? (
            <>
              <Button className="h-11 sm:h-8" disabled={locked} onClick={askCap}>Save</Button>
              <Button variant="ghost" className="h-11 sm:h-8" disabled={pending} onClick={() => setCap(savedCap)}>
                Reset
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <Dialog open={change !== null} onOpenChange={(o) => { if (!o && !pending) setChange(null); }}>
        <DialogContent>
          {change ? (
            <>
              <DialogHeader>
                <DialogTitle className="leading-snug">{change.title}</DialogTitle>
                <DialogDescription>
                  This saves a new config version with a new rev. The engine picks it up on its next run.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" className="h-11 sm:h-9" disabled={pending} onClick={() => setChange(null)}>
                  Cancel
                </Button>
                <Button className="h-11 sm:h-9" disabled={pending} onClick={() => apply(change)}>
                  Save
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
