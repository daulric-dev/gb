"use client";

import { ModeToggle } from "@/components/layout/mode-toggle";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export function Header({ title }: { title?: string }) {
  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b bg-background/80 backdrop-blur-sm px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-4" />
      {title && (
        <span className="text-sm font-medium text-muted-foreground truncate">{title}</span>
      )}
      <div className="ml-auto flex items-center gap-1">
        <ModeToggle />
      </div>
    </header>
  );
}
