import { AuthShell } from "@/components/auth/AuthShell";
import { ClaimCodeForm } from "@/components/auth/ClaimCodeForm";

/**
 * Direct route to code redemption. Students normally reach the same form on
 * the schools screen, which is where routing sends them while they have no
 * school.
 */
export default function ClaimScreen() {
  return (
    <AuthShell>
      <ClaimCodeForm />
    </AuthShell>
  );
}
