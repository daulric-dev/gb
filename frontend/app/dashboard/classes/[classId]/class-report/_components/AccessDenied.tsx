"use client";

import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import type { ClassInfo } from "./types";

interface AccessDeniedProps {
  classInfo: ClassInfo | null;
}

export function AccessDenied({ classInfo }: AccessDeniedProps) {
  const router = useRouter();

  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/dashboard/classes")}
      >
        Back to Classes
      </Button>
      <p className="text-center text-muted-foreground py-12">
        {classInfo
          ? "Only the class teacher can view the class report."
          : "Class not found or you don’t have access."}
      </p>
    </div>
  );
}
