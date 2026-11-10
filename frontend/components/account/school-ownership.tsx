"use client";

import { useCallback, useEffect } from "react";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { ApiError } from "@/lib/api";
import {
  getSchoolTransferInfo,
  ownerLabel,
  schoolTransferredMessage,
  transferSchoolOwnership,
  type SchoolTransferInfo,
} from "@/lib/ownership";
import { TransferOwnershipCard } from "@/components/account/transfer-ownership-card";

/**
 * A school's owner and the "Transfer ownership" picker, for its owner and for
 * organisation admins (the API answers 403 to anyone else, and then nothing
 * is shown). The new owner takes the school's admin seat; a school has one
 * admin, so the previous one stays on as a teacher.
 */
export function SchoolOwnership({
  schoolId,
  onTransferred,
}: {
  schoolId: string | null | undefined;
  onTransferred?: () => void;
}) {
  useSignals();
  const info = useSignal<SchoolTransferInfo | null>(null);

  const load = useCallback(() => {
    if (!schoolId) {
      info.value = null;
      return;
    }
    getSchoolTransferInfo(schoolId)
      .then((data) => (info.value = data))
      .catch((err) => {
        info.value = null;
        // Not theirs to transfer: say nothing.
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) return;
      });
  }, [info, schoolId]);

  useEffect(() => {
    load();
  }, [load]);

  const data = info.value;
  if (!data) return null;

  return (
    <TransferOwnershipCard
      title="School ownership"
      description={
        <>
          The owner runs the school as its administrator and must hand it over
          before leaving it or deleting their account. The new owner becomes the
          school&apos;s administrator; the previous administrator stays on as a
          teacher.
        </>
      }
      ownerLabel={data.owner ? ownerLabel(data.owner) : null}
      candidates={data.candidates.map((c) => ({ userId: c.userId, label: ownerLabel(c) }))}
      canTransfer
      emptyHint="Nobody else on the school's staff can take it yet. Add a staff member first."
      confirmText={(c) =>
        `Make ${c.label} the owner and administrator of ${data.schoolName || "this school"}? You will need to confirm it's you.`
      }
      onTransfer={async (userId) => {
        const result = await transferSchoolOwnership(data.schoolId, userId);
        toast.success(schoolTransferredMessage(data.schoolName, result.owner));
        load();
        onTransferred?.();
      }}
    />
  );
}
