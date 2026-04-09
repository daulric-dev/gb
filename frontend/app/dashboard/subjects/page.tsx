"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, ApiError } from "@/lib/api";
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
import { Plus, Pencil, Trash2 } from "lucide-react";

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
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editSubject, setEditSubject] = useState<Subject | null>(null);

  const fetchSubjects = useCallback(() => {
    api<Subject[]>("/subjects")
      .then(setSubjects)
      .catch(() => toast.error("Failed to load subjects"))
      .finally(() => setLoading(false));
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between animate-fade-in-up">
        <div>
          <h1 className="text-3xl font-bold">subjects</h1>
          <p className="text-muted-foreground mt-1">
            manage subjects for your school
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
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
                setCreateOpen(false);
                fetchSubjects();
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : subjects.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No subjects yet. Create your first one.
        </div>
      ) : (
        <div className="rounded-md border animate-fade-in-up-delay-1">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Graded</TableHead>
                <TableHead>Order</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subjects.map((subject) => (
                <TableRow key={subject.id}>
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
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditSubject(subject)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(subject.id, subject.name)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog
        open={editSubject !== null}
        onOpenChange={(open) => {
          if (!open) setEditSubject(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Subject</DialogTitle>
            <DialogDescription>Update subject details</DialogDescription>
          </DialogHeader>
          {editSubject && (
            <EditSubjectForm
              subject={editSubject}
              onSuccess={() => {
                setEditSubject(null);
                fetchSubjects();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateSubjectForm({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [isGraded, setIsGraded] = useState(true);
  const [sortOrder, setSortOrder] = useState(0);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const body: Record<string, unknown> = {
      name,
      isGraded,
      sortOrder,
    };
    if (code) body.code = code;

    try {
      await api("/subjects", { method: "POST", body });
      toast.success("Subject created");
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to create";
      toast.error(msg);
    } finally {
      setLoading(false);
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
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="code">Code</Label>
          <Input
            id="code"
            placeholder="MATH"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="isGraded">Grading</Label>
          <select
            id="isGraded"
            className={selectClass}
            value={isGraded ? "true" : "false"}
            onChange={(e) => setIsGraded(e.target.value === "true")}
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
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
          />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Creating..." : "Create Subject"}
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
  const [name, setName] = useState(subject.name);
  const [code, setCode] = useState(subject.code ?? "");
  const [isGraded, setIsGraded] = useState(subject.is_graded);
  const [sortOrder, setSortOrder] = useState(subject.sort_order);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const body: Record<string, unknown> = {
      name,
      code: code || null,
      isGraded,
      sortOrder,
    };

    try {
      await api(`/subjects/${subject.id}`, { method: "PATCH", body });
      toast.success("Subject updated");
      onSuccess();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to update";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="editName">Subject Name</Label>
          <Input
            id="editName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="editCode">Code</Label>
          <Input
            id="editCode"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="editIsGraded">Grading</Label>
          <select
            id="editIsGraded"
            className={selectClass}
            value={isGraded ? "true" : "false"}
            onChange={(e) => setIsGraded(e.target.value === "true")}
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
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
          />
        </div>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Saving..." : "Save Changes"}
      </Button>
    </form>
  );
}
