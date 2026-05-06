"use client";

import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Check, Loader2, UserPlus, X } from "lucide-react";
import type { JoinRequest } from "./types";

type Role = "admin" | "teacher" | "member";

function getRequestName(request: JoinRequest) {
  return (
    [request.user?.first_name, request.user?.last_name]
      .filter(Boolean)
      .join(" ") ||
    request.user?.email ||
    "Unknown user"
  );
}

function PendingRequestsSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-8 w-16" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function PendingRequestsEmpty() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <UserPlus className="mb-3 size-10 text-muted-foreground/40" />
        <p className="font-medium">No pending join requests</p>
        <p className="mt-1 text-sm text-muted-foreground">
          When someone requests to join your school, it will appear here.
        </p>
      </CardContent>
    </Card>
  );
}

export function PendingRequestsTab({
  requests,
  loading,
  onChange,
  onApproved,
}: {
  requests: JoinRequest[];
  loading: boolean;
  onChange: (next: JoinRequest[]) => void;
  onApproved?: () => void;
}) {
  useSignals();

  const approveDialogOpen = useSignal(false);
  const selectedRequest = useSignal<JoinRequest | null>(null);
  const selectedRole = useSignal<Role>("member");
  const actionLoading = useSignal(false);

  function openApproveDialog(request: JoinRequest) {
    selectedRequest.value = request;
    selectedRole.value = "member";
    approveDialogOpen.value = true;
  }

  async function handleApprove() {
    const request = selectedRequest.value;
    if (!request) return;
    actionLoading.value = true;
    try {
      await api(`/schools/join-requests/${request.id}/approve`, {
        method: "PATCH",
        body: { role: selectedRole.value },
      });
      onChange(requests.filter((r) => r.id !== request.id));
      approveDialogOpen.value = false;
      toast.success(
        `${getRequestName(request)} has been approved as ${selectedRole.value}.`,
      );
      onApproved?.();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to approve request";
      toast.error(message);
    } finally {
      actionLoading.value = false;
    }
  }

  async function handleReject(request: JoinRequest) {
    actionLoading.value = true;
    try {
      await api(`/schools/join-requests/${request.id}/reject`, {
        method: "PATCH",
      });
      onChange(requests.filter((r) => r.id !== request.id));
      toast.success(`${getRequestName(request)}'s request has been rejected.`);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Failed to reject request";
      toast.error(message);
    } finally {
      actionLoading.value = false;
    }
  }

  if (loading) return <PendingRequestsSkeleton />;
  if (requests.length === 0) return <PendingRequestsEmpty />;

  return (
    <>
      <div className="space-y-3">
        {requests.map((request) => {
          const name = getRequestName(request);
          const date = new Date(request.requested_at).toLocaleDateString(
            undefined,
            { year: "numeric", month: "short", day: "numeric" },
          );

          return (
            <Card key={request.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium leading-tight">{name}</p>
                  {request.user?.email && (
                    <p className="text-sm text-muted-foreground truncate">
                      {request.user.email}
                    </p>
                  )}
                  {request.message && (
                    <p className="text-sm text-muted-foreground italic">
                      &ldquo;{request.message}&rdquo;
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Requested {date}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    onClick={() => openApproveDialog(request)}
                    disabled={actionLoading.value}
                  >
                    <Check className="mr-1.5 size-3.5" />
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleReject(request)}
                    disabled={actionLoading.value}
                  >
                    <X className="mr-1.5 size-3.5" />
                    Reject
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={approveDialogOpen.value}
        onOpenChange={(v) => (approveDialogOpen.value = v)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Join Request</DialogTitle>
            <DialogDescription>
              Assign a role to{" "}
              {selectedRequest.value
                ? getRequestName(selectedRequest.value)
                : "this user"}
              .
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="role">Role</Label>
            <select
              id="role"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={selectedRole.value}
              onChange={(e) =>
                (selectedRole.value = e.target.value as Role)
              }
            >
              <option value="member">Member</option>
              <option value="teacher">Teacher</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => (approveDialogOpen.value = false)}
              disabled={actionLoading.value}
            >
              Cancel
            </Button>
            <Button onClick={handleApprove} disabled={actionLoading.value}>
              {actionLoading.value && (
                <Loader2 className="mr-2 size-4 animate-spin" />
              )}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
