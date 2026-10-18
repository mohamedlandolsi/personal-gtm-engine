"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Building2, Ellipsis, Inbox, LogOut, SlidersHorizontal } from "lucide-react";
import { logout } from "@/app/login/actions";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ThemeToggle } from "@/components/theme-toggle";

const LINKS = [
  { href: "/queue", label: "Queue", Icon: Inbox },
  { href: "/accounts", label: "Accounts", Icon: Building2 },
  { href: "/config", label: "Config", Icon: SlidersHorizontal },
  { href: "/runs", label: "Runs", Icon: Activity },
] as const;

type Variant = "top" | "bottom";

const BOTTOM_ITEM = "flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[0.75rem] font-medium text-muted-foreground";

// Phones: theme and Sign out live here instead of the top bar.
function MoreSheet() {
  return (
    <Sheet>
      <SheetTrigger className={BOTTOM_ITEM}>
        <Ellipsis className="size-5" aria-hidden />
        More
      </SheetTrigger>
      <SheetContent side="bottom" className="gap-4 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <SheetHeader className="p-0">
          <SheetTitle>More</SheetTitle>
        </SheetHeader>
        <div className="space-y-2">
          <p className="text-[0.8125rem] font-medium text-muted-foreground">Theme</p>
          <ThemeToggle />
        </div>
        <form action={logout}>
          <Button type="submit" variant="outline" className="h-11 w-full">
            <LogOut aria-hidden />
            Sign out
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function NavLinks({ variant, active }: { variant: Variant; active: string | null }) {
  return (
    <>
      {LINKS.map(({ href, label, Icon }) => {
        const on = active !== null && (active === href || active.startsWith(href + "/"));
        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? "page" : undefined}
            className={
              variant === "top"
                ? cn(
                    "rounded-md px-2.5 py-1.5 text-[0.9375rem] text-muted-foreground hover:text-foreground",
                    on && "font-semibold text-foreground",
                  )
                : cn(BOTTOM_ITEM, on && "text-foreground")
            }
          >
            {variant === "bottom" ? <Icon className="size-5" aria-hidden /> : null}
            {label}
          </Link>
        );
      })}
      {variant === "bottom" ? <MoreSheet /> : null}
    </>
  );
}

// Reads the pathname to mark the current section. Render inside <Suspense>:
// with Cache Components on, usePathname suspends on routes with dynamic params.
export function ConsoleNav({ variant }: { variant: Variant }) {
  return <NavLinks variant={variant} active={usePathname()} />;
}

// Suspense fallback: same links, no current marker.
export function ConsoleNavStatic({ variant }: { variant: Variant }) {
  return <NavLinks variant={variant} active={null} />;
}
