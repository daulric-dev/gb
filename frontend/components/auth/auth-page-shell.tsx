import type { ReactNode } from "react";
import { ModeToggle } from "@/components/layout/mode-toggle";

export function AuthPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>
      {children}
    </div>
  );
}