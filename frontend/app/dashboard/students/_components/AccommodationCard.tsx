"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Accessibility, Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import {
  accommodationBadges,
  accommodationForm,
  accommodationRequest,
  type Accommodation,
} from "@/lib/courses/accommodations";
import { AccommodationFields } from "@/components/accommodations/AccommodationFields";
import { usePermissions } from "@/providers/PermissionsProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * A student's school-wide quiz accommodation: applied to every timed or
 * Lockdown quiz unless a teacher sets one on that quiz. Staff with
 * student:update can change it.
 */
export function AccommodationCard({ studentId }: { studentId: string }) {
  useSignals();
  const { can } = usePermissions();
  const canEdit = can("student", "update");
  const saved = useSignal<Accommodation | null>(null);
  const loaded = useSignal(false);
  const editing = useSignal(false);
  const form = useSignal(accommodationForm(null));
  const working = useSignal(false);
  const path = `/students/${studentId}/accommodation`;

  useEffect(() => {
    let cancelled = false;
    api<Accommodation | null>(path)
      .then((data) => {
        // No default is an empty body, which reads as "".
        if (!cancelled) saved.value = data || null;
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) loaded.value = true;
      });
    return () => {
      cancelled = true;
    };
  }, [path, saved, loaded]);

  function startEditing() {
    form.value = accommodationForm(saved.value);
    editing.value = true;
  }

  async function save() {
    const checked = accommodationRequest(form.value);
    if (!checked.ok) {
      toast.error(checked.error);
      return;
    }
    working.value = true;
    try {
      saved.value = await api<Accommodation>(path, {
        method: "PUT",
        body: checked.body,
      });
      editing.value = false;
      toast.success("Accommodation saved");
    } catch (err) {
      toast.error(userMessage(err, "Failed to save the accommodation"));
    } finally {
      working.value = false;
    }
  }

  async function remove() {
    working.value = true;
    try {
      await api(path, { method: "DELETE" });
      saved.value = null;
      editing.value = false;
      toast.success("Accommodation removed");
    } catch (err) {
      toast.error(userMessage(err, "Failed to remove the accommodation"));
    } finally {
      working.value = false;
    }
  }

  if (!loaded.value) return null;
  const labels = accommodationBadges(saved.value);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Accessibility className="size-4" aria-hidden="true" />
          Quiz accommodations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Applied to every timed or Lockdown quiz, unless a teacher sets a
          different accommodation on that quiz. Students never see each
          other&apos;s accommodations.
        </p>
        {editing.value ? (
          <>
            <AccommodationFields
              idPrefix="student-accommodation"
              value={form.value}
              onChangeAction={(v) => (form.value = v)}
              disabled={working.value}
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save()} disabled={working.value}>
                {working.value && <Loader2 className="mr-2 size-4 animate-spin" />}
                Save
              </Button>
              <Button
                variant="outline"
                onClick={() => (editing.value = false)}
                disabled={working.value}
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            {labels.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {labels.map((label) => (
                  <Badge key={label} variant="outline">
                    {label}
                  </Badge>
                ))}
                {saved.value?.reason && (
                  <span className="text-xs text-muted-foreground">
                    {saved.value.reason}
                  </span>
                )}
              </div>
            ) : (
              <p className="text-sm">None</p>
            )}
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={startEditing}>
                  {saved.value ? "Change" : "Add accommodation"}
                </Button>
                {saved.value && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void remove()}
                    disabled={working.value}
                  >
                    Remove
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
