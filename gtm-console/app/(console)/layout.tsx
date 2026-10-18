import Link from "next/link";
import { Suspense } from "react";
import { requireSession } from "@/lib/session";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountMenu } from "@/components/account-menu";
import { ConsoleNav, ConsoleNavStatic } from "@/components/console-nav";
import { SyncHealth } from "@/components/sync-health";

// Every console page is private, per-request data: let the segment block on the server.
export const instant = false;

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  await requireSession();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-4 px-4 md:px-6">
          <Link href="/queue" className="shrink-0 font-semibold">GTM Console</Link>
          <nav aria-label="Sections" className="hidden items-center gap-1 sm:flex">
            <Suspense fallback={<ConsoleNavStatic variant="top" />}>
              <ConsoleNav variant="top" />
            </Suspense>
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <Suspense fallback={<Skeleton className="h-4 w-28" />}>
              <SyncHealth />
            </Suspense>
            <div className="hidden sm:block">
              <AccountMenu />
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1200px] px-4 pt-4 pb-24 sm:pb-8 md:px-6">{children}</main>
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-card pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        <Suspense fallback={<ConsoleNavStatic variant="bottom" />}>
          <ConsoleNav variant="bottom" />
        </Suspense>
      </nav>
    </div>
  );
}
