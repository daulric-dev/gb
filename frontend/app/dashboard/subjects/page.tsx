"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Plus } from "lucide-react";
import { type Subject } from "./_components/types";
import { SortableSubjectRow } from "./_components/SortableSubjectRow";
import { CreateSubjectForm } from "./_components/CreateSubjectForm";
import { EditSubjectForm } from "./_components/EditSubjectForm";

export default function SubjectsPage() {
  useSignals();
  const subjects = useSignal<Subject[]>([]);
  const loading = useSignal(true);
  const createOpen = useSignal(false);
  const editSubject = useSignal<Subject | null>(null);
  const reordering = useSignal(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const fetchSubjects = useCallback(() => {
    api<Subject[]>("/subjects")
      .then((data) => (subjects.value = data))
      .catch(() => toast.error("Failed to load subjects"))
      .finally(() => (loading.value = false));
  }, []);

  useEffect(() => {
    fetchSubjects();
  }, [fetchSubjects]);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    try {
      await api(`/subjects/${id}`, { method: "DELETE" });
      toast.success("Subject deleted");
      fetchSubjects();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to delete";
      toast.error(msg);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = subjects.value.findIndex((s) => s.id === active.id);
    const newIndex = subjects.value.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(subjects.value, oldIndex, newIndex);
    subjects.value = reordered;

    const items = reordered.map((s, i) => ({ id: s.id, sortOrder: i }));

    reordering.value = true;
    try {
      await api("/subjects/reorder", { method: "PATCH", body: { items } });
      subjects.value = reordered.map((s, i) => ({ ...s, sort_order: i }));
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to reorder";
      toast.error(msg);
      fetchSubjects();
    } finally {
      reordering.value = false;
    }
  }

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Subjects"
        description="Manage Subjects for Your School"
        action={
          <Dialog
            open={createOpen.value}
            onOpenChange={(v) => (createOpen.value = v)}
          >
            <DialogTrigger render={<Button />}>
              <Plus className="mr-2 size-4" />
              New Subject
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Subject</DialogTitle>
                <DialogDescription>
                  Add a new subject for your school
                </DialogDescription>
              </DialogHeader>
              <CreateSubjectForm
                onSuccess={() => {
                  createOpen.value = false;
                  fetchSubjects();
                }}
              />
            </DialogContent>
          </Dialog>
        }
      />

      {loading.value ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : subjects.value.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No subjects yet. Create your first one.
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={subjects.value.map((s) => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="rounded-md border animate-fade-in-up-delay-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Name</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Graded</TableHead>
                    <TableHead>Order</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subjects.value.map((subject) => (
                    <SortableSubjectRow
                      key={subject.id}
                      subject={subject}
                      onEdit={() => (editSubject.value = subject)}
                      onDelete={() =>
                        handleDelete(subject.id, subject.name)
                      }
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </SortableContext>
        </DndContext>
      )}

      <Dialog
        open={editSubject.value !== null}
        onOpenChange={(open) => {
          if (!open) editSubject.value = null;
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Subject</DialogTitle>
            <DialogDescription>Update subject details</DialogDescription>
          </DialogHeader>
          {editSubject.value && (
            <EditSubjectForm
              subject={editSubject.value}
              onSuccess={() => {
                editSubject.value = null;
                fetchSubjects();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
