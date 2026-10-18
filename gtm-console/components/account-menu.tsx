"use client";

import { CircleUser, LogOut } from "lucide-react";
import { logout } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";

// Desktop account menu: theme control and Sign out.
export function AccountMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
        <CircleUser aria-hidden />
        Account
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 space-y-3 p-3">
        <div className="space-y-2">
          <p className="text-[0.8125rem] font-medium text-muted-foreground">Theme</p>
          <ThemeToggle />
        </div>
        <form action={logout}>
          <Button type="submit" variant="outline" className="w-full">
            <LogOut aria-hidden />
            Sign out
          </Button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
