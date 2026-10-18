import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { DraftDetail } from "@/components/draft-detail";

// Per-request private data: the layout's `instant = false` does not cover pages below it.
export const instant = false;

export default async function DraftPage({ params }: PageProps<"/queue/[id]">) {
  await requireSession();
  let id: string;
  try {
    id = decodeURIComponent((await params).id);
  } catch {
    notFound();
  }

  return <DraftDetail id={id} mode="page" />;
}
