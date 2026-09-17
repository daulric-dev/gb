"use client";

import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { ClaimCodeForm } from "@/components/auth/claim-code-form";

/**
 * Direct route to code redemption. Students normally reach the same form on
 * /schools, which is where routing sends them while they have no school.
 */
export default function ClaimPage() {
  return (
    <AuthPageShell>
      <ClaimCodeForm />
    </AuthPageShell>
  );
}
