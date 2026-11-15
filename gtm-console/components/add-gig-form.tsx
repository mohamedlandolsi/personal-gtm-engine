"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addGig } from "@/app/(console)/gigs/actions";
import { toastError } from "@/lib/feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const BODY_MAX = 4000;

// Sprint 15 (Phase 0): the forums cannot be fetched by a program, so a post you find yourself is pasted here.
// The next GTM Gig Finder run gates, scores and drafts it like any other post.
export function AddGigForm() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const ready = /^https?:\/\/\S+$/i.test(url.trim()) && title.trim().length >= 5 && body.trim().length >= 20;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || pending) return;
    startTransition(async () => {
      const res = await addGig({ url: url.trim(), title: title.trim(), body: body.trim() });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      toast.success("Gig added", { description: "The next Gig Finder run scores it and drafts a reply if it qualifies." });
      setUrl("");
      setTitle("");
      setBody("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block space-y-1">
        <span className="text-[0.8125rem] font-medium text-muted-foreground">Link to the post</span>
        <Input
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://community.n8n.io/t/..."
          className="h-11 bg-card md:h-9"
          maxLength={500}
          required
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[0.8125rem] font-medium text-muted-foreground">Title</span>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-11 bg-card md:h-9" maxLength={300} required />
      </label>
      <label className="block space-y-1">
        <span className="text-[0.8125rem] font-medium text-muted-foreground">Post text</span>
        <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={BODY_MAX} required />
        <span className="tabular block text-right text-[0.8125rem] text-ink-3">
          {body.length} of {BODY_MAX}
        </span>
      </label>
      <Button type="submit" className="h-11 w-full sm:h-9 sm:w-auto" disabled={!ready || pending}>
        Add gig
      </Button>
    </form>
  );
}
