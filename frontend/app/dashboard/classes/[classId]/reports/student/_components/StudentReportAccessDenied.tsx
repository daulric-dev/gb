"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { type ClassInfo } from "./types";

interface StudentReportAccessDeniedProps {
  classInfo: ClassInfo | null;
  onBack: () => void;
}

export function StudentReportAccessDenied({
  classInfo,
  onBack,
}: StudentReportAccessDeniedProps) {
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="mr-2 size-4" /> Back
      </Button>
      <p className="text-muted-foreground py-8 text-center">
        {classInfo && !classInfo.isClassTeacher
          ? "Only the class teacher can view this report."
          : "Class not found."}
      </p>
    </div>
  );
}
