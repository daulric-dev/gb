"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/providers/AuthProvider";

/** Codes are issued as 12 characters shown in three groups: RXKT-9WMB-2FQH. */
const CODE_LENGTH = 12;

function normalize(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Re-group as the user types so the field mirrors the printed code. */
function format(value: string) {
  const clean = normalize(value).slice(0, CODE_LENGTH);
  return (clean.match(/.{1,4}/g) ?? []).join("-");
}

/**
 * The student's way into a school.
 *
 * `school` redeems the school-wide join code and creates their record;
 * `student` redeems a code issued against one existing roster row. Same shape
 * and same field, so the caller picks which endpoint the code goes to.
 */
export function ClaimCodeForm({
  mode = "school",
}: {
  mode?: "school" | "student";
}) {
  useSignals();

  const router = useRouter();
  const { refresh } = useAuth();
  const code = useSignal("");
  const loading = useSignal(false);

  const ready = normalize(code.value).length === CODE_LENGTH;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    loading.value = true;

    try {
      await api(mode === "school" ? "/auth/join-school" : "/auth/claim-student", {
        method: "POST",
        body: { code: code.value },
      });
      // The claim sets school and account type server-side, so the cached
      // profile is stale until this resolves.
      await refresh();
      toast.success("Account linked");
      router.push("/portal");
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Could not redeem that code";
      toast.error(message);
    } finally {
      loading.value = false;
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Enter your join code</CardTitle>
        <CardDescription>
          {mode === "school"
            ? "Your school gives you a code that lets you join it."
            : "Your school gives you a code that links this login to your student record."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">Join code</Label>
            <Input
              id="code"
              placeholder="RXKT-9WMB-2FQH"
              value={code.value}
              onChange={(e) => (code.value = format(e.target.value))}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="text-center font-mono text-lg tracking-widest"
              required
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Dashes and letter case do not matter.
            </p>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={loading.value || !ready}
          >
            {loading.value ? "Joining..." : "Join school"}
          </Button>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Do not have a code? Ask a teacher or the school office for one.
        </p>
      </CardContent>
    </Card>
  );
}
