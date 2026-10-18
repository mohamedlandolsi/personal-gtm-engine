"use client";

import { useState } from "react";
import { ConfigEditor } from "@/components/config-editor";
import { ConfigSwitches } from "@/components/config-switches";

// Holds the one piece of shared state: switches stay locked while the editor has unsaved edits.
export function ConfigWorkspace({ savedText, savedRev }: { savedText: string; savedRev: string }) {
  const [editorDirty, setEditorDirty] = useState(false);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <ConfigSwitches savedText={savedText} editorDirty={editorDirty} />
      <ConfigEditor savedText={savedText} savedRev={savedRev} onDirtyChange={setEditorDirty} />
    </div>
  );
}
