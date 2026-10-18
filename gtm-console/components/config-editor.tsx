"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveConfig } from "@/app/(console)/config/actions";
import { parseConfig, replaceRev, tunisRev } from "@/lib/config-text";
import { toastError } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function ConfigEditor({
  savedText,
  savedRev,
  onDirtyChange,
}: {
  savedText: string;
  savedRev: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [text, setTextState] = useState(savedText);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const parsed = parseConfig(text);
  const rev = parsed.ok ? parsed.rev : null;
  const dirty = text !== savedText;
  const revChanged = rev !== null && rev !== savedRev;
  const canSave = parsed.ok && revChanged && !pending;

  function setText(next: string) {
    setTextState(next);
    onDirtyChange?.(next !== savedText);
  }

  function bump() {
    const next = replaceRev(text, tunisRev());
    if (next === null) {
      toast.error("Could not bump the rev", { description: 'Add a top-level "rev" string to the JSON first.' });
      return;
    }
    setText(next);
  }

  function save() {
    startTransition(async () => {
      const res = await saveConfig(text, note.trim() || undefined);
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      toast.success("Saved");
      onDirtyChange?.(false);
      router.refresh();
    });
  }

  let status: React.ReactNode;
  if (!parsed.ok) {
    status = <span className="font-medium text-danger">Not valid JSON: {parsed.error}</span>;
  } else if (rev === null) {
    status = <span className="font-medium text-danger">Valid JSON, but the top-level &quot;rev&quot; is missing</span>;
  } else if (!revChanged) {
    status = (
      <span>
        Valid JSON, rev <span className="font-mono">{rev}</span>. Bump the rev to save.
      </span>
    );
  } else {
    status = (
      <span>
        Valid JSON, rev <span className="font-mono">{rev}</span>
      </span>
    );
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[1.0625rem] font-semibold">Config JSON</h2>
        <span className="text-[0.8125rem] text-ink-3">
          Saved rev <span className="font-mono">{savedRev}</span>
        </span>
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Config JSON"
        aria-describedby="config-status"
        aria-invalid={!parsed.ok || undefined}
        className="field-sizing-fixed h-[60vh] min-h-80 resize-y font-mono text-[0.8125rem] leading-5 md:text-[0.8125rem]"
      />
      <p id="config-status" role="status" className={cn("text-[0.8125rem]", parsed.ok && "text-muted-foreground")}>
        {status}
      </p>

      <label className="block space-y-1">
        <span className="text-[0.8125rem] font-medium text-muted-foreground">Note (optional)</span>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={300}
          placeholder="What changed and why"
          className="h-11 md:h-9"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button className="h-11 flex-[2] sm:h-9 sm:flex-none" disabled={!canSave} onClick={save}>
          Save
        </Button>
        <Button variant="outline" className="h-11 flex-1 sm:h-9 sm:flex-none" disabled={pending || !parsed.ok} onClick={bump}>
          Bump rev
        </Button>
        <Button variant="ghost" className="h-11 flex-1 sm:h-9 sm:flex-none" disabled={pending || !dirty} onClick={() => setText(savedText)}>
          Reset
        </Button>
      </div>
    </section>
  );
}
