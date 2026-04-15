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
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DashboardPageHeader } from "@/components/dashboard-page-header";
import { Plus, Pencil, Trash2, GripVertical } from "lucide-react";

interface Subject {
  id: string;
  school_id: string;
  name: string;
  code: string | null;
  is_graded: boolean;
  sort_order: number;
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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

function SortableSubjectRow({
  subject,
  onEdit,
  onDelete,
}: {
  subject: Subject;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: subject.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <TableRow ref={setNodeRef} style={style}>
      <TableCell className="w-10 px-2">
        <button
          type="button"
          className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      </TableCell>
      <TableCell className="font-medium">{subject.name}</TableCell>
      <TableCell>
        {subject.code ? (
          <Badge variant="outline">{subject.code}</Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell>
        {subject.is_graded ? (
          <Badge>Graded</Badge>
        ) : (
          <Badge variant="secondary">Not Graded</Badge>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {subject.sort_order}
      </TableCell>
      <TableCell className="text-right space-x-1">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="size-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete}>
          <Trash2 className="size-4 text-destructive" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function CreateSubjectForm({ onSuccess }: { onSuccess: () => void }) {
  useSignals();
  const name = useSignal("");
  const code = useSignal("");
  const isGraded = useSignal(true);
  const sortOrder = useSignal(0);
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    const body: Record<string, unknown> = {
      name: name.value,
      isGraded: isGraded.value,
      sortOrder: sortOrder.value,
    };
    if (code.value) body.code = code.value;

    try {
      await api("/subjects", { method: "POST", body });
      toast.success("Subject created");
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to create";
      toast.error(msg);
    } finally {
      loading.value = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="name">Subject Name</Label>
          <Input
            id="name"
            placeholder="Mathematics"
            value={name.value}
            onChange={(e) => (name.value = e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="code">Code</Label>
          <Input
            id="code"
            placeholder="MATH"
            value={code.value}
            onChange={(e) => (code.value = e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="isGraded">Grading</Label>
          <select
            id="isGraded"
            className={selectClass}
            value={isGraded.value ? "true" : "false"}
            onChange={(e) => (isGraded.value = e.target.value === "true")}
          >
            <option value="true">Graded</option>
            <option value="false">Not Graded (remarks only)</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="sortOrder">Display Order</Label>
          <Input
            id="sortOrder"
            type="number"
            min={0}
            value={sortOrder.value}
            onChange={(e) => (sortOrder.value = Number(e.target.value))}
          />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Creating..." : "Create Subject"}
      </Button>
    </form>
  );
}

function EditSubjectForm({
  subject,
  onSuccess,
}: {
  subject: Subject;
  onSuccess: () => void;
}) {
  useSignals();
  const name = useSignal(subject.name);
  const code = useSignal(subject.code ?? "");
  const isGraded = useSignal(subject.is_graded);
  const sortOrder = useSignal(subject.sort_order);
  const loading = useSignal(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    loading.value = true;

    const body: Record<string, unknown> = {
      name: name.value,
      code: code.value || null,
      isGraded: isGraded.value,
      sortOrder: sortOrder.value,
    };

    try {
      await api(`/subjects/${subject.id}`, { method: "PATCH", body });
      toast.success("Subject updated");
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to update";
      toast.error(msg);
    } finally {
      loading.value = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="editName">Subject Name</Label>
          <Input
            id="editName"
            value={name.value}
            onChange={(e) => (name.value = e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editCode">Code</Label>
          <Input
            id="editCode"
            value={code.value}
            onChange={(e) => (code.value = e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="editIsGraded">Grading</Label>
          <select
            id="editIsGraded"
            className={selectClass}
            value={isGraded.value ? "true" : "false"}
            onChange={(e) => (isGraded.value = e.target.value === "true")}
          >
            <option value="true">Graded</option>
            <option value="false">Not Graded (remarks only)</option>
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="editSortOrder">Display Order</Label>
          <Input
            id="editSortOrder"
            type="number"
            min={0}
            value={sortOrder.value}
            onChange={(e) => (sortOrder.value = Number(e.target.value))}
          />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading.value}>
        {loading.value ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}
