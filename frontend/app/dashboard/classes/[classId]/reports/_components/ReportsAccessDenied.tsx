"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { type ClassInfo } from "./types";

interface ReportsAccessDeniedProps {
  classInfo: ClassInfo | null;
  onBack: () => void;
}

export function ReportsAccessDenied({
  classInfo,
  onBack,
}: ReportsAccessDeniedProps) {
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="mr-2 size-4" /> Back to Classes
      </Button>
      <p className="text-center text-muted-foreground py-12">
        {classInfo
          ? "Only the class teacher can view reports."
          : "Class not found or you don’t have access."}
      </p>
    </div>
  );
}
