"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ParentJoinForm } from "../_components/join-form";

function Accept() {
  const token = useSearchParams()?.get("token") ?? null;
  if (!token) {
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        This link is incomplete. Open the invitation email again and use its button.
      </p>
    );
  }
  return <ParentJoinForm token={token} />;
}

/** `/parent/accept?token=...`: the link in the school's invitation email. */
export default function ParentAcceptPage() {
  return (
    <Suspense>
      <Accept />
    </Suspense>
  );
}
