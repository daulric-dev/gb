"use client";

import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export function StudentsSearchField({
  value,
  onChange,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="relative animate-fade-in-up-delay-1">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder="Search by name..."
        className="pl-9"
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
