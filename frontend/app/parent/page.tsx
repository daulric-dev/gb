"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useParentChildren } from "./_components/parent-context";

/** The parent home: the first child's overview (the layout handles none). */
export default function ParentHomePage() {
  const router = useRouter();
  const { selected } = useParentChildren();

  useEffect(() => {
    if (selected) router.replace(`/parent/${selected.id}`);
  }, [selected, router]);

  return null;
}
