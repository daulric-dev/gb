import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BackTitleToolbar({ title, description, onBack, actions }: { title: string; description: ReactNode; onBack: () => void; actions?: ReactNode }) { 
  return (
    <div className="flex animate-fade-in-up items-center justify-between">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack} type="button">
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="mt-1 text-muted-foreground">{description}</p>
        </div>
      </div>
      {actions}
    </div>
  );
}
