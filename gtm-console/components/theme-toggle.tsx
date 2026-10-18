"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

const subscribe = () => () => {};

// Three-way segmented control. Before mount the stored theme is unknown, so no segment is selected.
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  // false on the server and during hydration, true afterwards (no effect + setState needed).
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);

  return (
    <div role="group" aria-label="Theme" className={cn("flex rounded-full bg-secondary p-0.5", className)}>
      {OPTIONS.map(({ value, label, Icon }) => {
        const on = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={on}
            onClick={() => setTheme(value)}
            className={cn(
              "flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full border border-transparent px-3 text-[0.8125rem] font-medium text-muted-foreground sm:h-8",
              on && "border-border bg-card text-foreground",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
