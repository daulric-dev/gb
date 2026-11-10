"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import {
  ArrowLeft,
  Boxes,
  Check,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { QuestionCard } from "./QuestionCard";
import { QuestionForm, type QuestionPayload } from "./QuestionForm";
import type { QuizQuestion } from "./types";

interface CourseBank {
  id: string;
  courseId: string;
  title: string;
  questionCount: number;
  createdAt: string;
  updatedAt: string;
}

interface BankDetail extends CourseBank {
  questions: (QuizQuestion & { locked?: boolean })[];
}

export function QuestionBanksDialog({
  open,
  courseId,
  canManage,
  onOpenChangeAction,
}: {
  open: boolean;
  courseId: string;
  canManage: boolean;
  onOpenChangeAction: (open: boolean) => void;
}) {
  useSignals();
  const banks = useSignal<CourseBank[]>([]);
  const loadingSignal = useSignal<boolean>(false);
  const loading = loadingSignal.value;
  const setLoading = (value: boolean) => (loadingSignal.value = value);
  const selectedBankIdSignal = useSignal<string | null>(null);
  const selectedBankId = selectedBankIdSignal.value;
  const setSelectedBankId = (value: string | null) => (selectedBankIdSignal.value = value);
  const bankDetailSignal = useSignal<BankDetail | null>(null);
  const bankDetail = bankDetailSignal.value;
  const setBankDetail = (value: BankDetail | null) => (bankDetailSignal.value = value);
  const loadingDetailSignal = useSignal<boolean>(false);
  const loadingDetail = loadingDetailSignal.value;
  const setLoadingDetail = (value: boolean) => (loadingDetailSignal.value = value);

  // New bank form
  const newTitle = useSignal("");
  const creating = useSignal(false);

  // Rename bank
  const editingTitleSignal = useSignal<boolean>(false);
  const editingTitle = editingTitleSignal.value;
  const setEditingTitle = (value: boolean) => (editingTitleSignal.value = value);
  const renameValueSignal = useSignal<string>("");
  const renameValue = renameValueSignal.value;
  const setRenameValue = (value: string) => (renameValueSignal.value = value);
  const savingRename = useSignal(false);

  // Delete bank
  const confirmDeleteId = useSignal<string | null>(null);
  const deleting = useSignal(false);

  // Add question to bank
  const addingQuestion = useSignal(false);

  useEffect(() => {
    if (!open) {
      setSelectedBankId(null);
      setBankDetail(null);
      setEditingTitle(false);
      return;
    }
    loadBanks();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when opened
  }, [open, courseId]);

  useEffect(() => {
    if (!selectedBankId) {
      setBankDetail(null);
      return;
    }
    loadDetail(selectedBankId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on selection
  }, [selectedBankId]);

  function loadBanks() {
    setLoading(true);
    api<CourseBank[]>(`/courses/${courseId}/question-banks`)
      .then((data) => (banks.value = data ?? []))
      .catch((err) => toast.error(userMessage(err, "Failed to load question banks")))
      .finally(() => setLoading(false));
  }

  function loadDetail(bankId: string) {
    setLoadingDetail(true);
    api<BankDetail>(`/question-banks/${bankId}`)
      .then((data) => {
        setBankDetail(data);
        setRenameValue(data.title);
      })
      .catch((err) => {
        toast.error(userMessage(err, "Failed to load bank questions"));
        setSelectedBankId(null);
      })
      .finally(() => setLoadingDetail(false));
  }

  async function handleCreateBank(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.value.trim();
    if (!title) return;
    creating.value = true;
    try {
      const created = await api<CourseBank>(`/courses/${courseId}/question-banks`, {
        method: "POST",
        body: { title },
      });
      toast.success("Question bank created");
      newTitle.value = "";
      loadBanks();
      setSelectedBankId(created.id);
    } catch (err) {
      toast.error(userMessage(err, "Failed to create question bank"));
    } finally {
      creating.value = false;
    }
  }

  async function handleRename() {
    if (!selectedBankId || !bankDetail) return;
    const title = renameValue.trim();
    if (!title || title === bankDetail.title) {
      setEditingTitle(false);
      return;
    }
    savingRename.value = true;
    try {
      await api(`/question-banks/${selectedBankId}`, {
        method: "PATCH",
        body: { title },
      });
      toast.success("Renamed question bank");
      setBankDetail({ ...bankDetail, title });
      setEditingTitle(false);
      loadBanks();
    } catch (err) {
      toast.error(userMessage(err, "Failed to rename"));
    } finally {
      savingRename.value = false;
    }
  }

  async function handleDeleteBank(bankId: string) {
    deleting.value = true;
    try {
      await api(`/question-banks/${bankId}`, {
        method: "DELETE",
      });
      toast.success("Question bank deleted");
      confirmDeleteId.value = null;
      if (selectedBankId === bankId) {
        setSelectedBankId(null);
      }
      loadBanks();
    } catch (err) {
      toast.error(userMessage(err, "Failed to delete question bank"));
    } finally {
      deleting.value = false;
    }
  }

  async function handleAddQuestion(payload: QuestionPayload) {
    if (!selectedBankId) return;
    addingQuestion.value = true;
    try {
      await api(`/question-banks/${selectedBankId}/questions`, {
        method: "POST",
        body: {
          prompt: payload.prompt,
          kind: payload.kind,
          points: payload.points,
          options: payload.options,
          numericAnswer: payload.numericAnswer,
          numericTolerance: payload.numericTolerance,
          scoring: payload.scoring,
          rubricId: payload.rubricId,
          fileTypes: payload.fileTypes,
          fileMaxMb: payload.fileMaxMb,
        },
      });
      toast.success("Question added to bank");
      loadDetail(selectedBankId);
      loadBanks();
    } catch (err) {
      toast.error(userMessage(err, "Failed to add question"));
    } finally {
      addingQuestion.value = false;
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChangeAction}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <div className="flex items-center gap-2">
              {selectedBankId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => setSelectedBankId(null)}
                >
                  <ArrowLeft className="size-4 mr-1" />
                  Banks
                </Button>
              )}
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <Boxes className="size-5" />
                  {selectedBankId && bankDetail
                    ? bankDetail.title
                    : "Course question banks"}
                </DialogTitle>
                <DialogDescription>
                  {selectedBankId
                    ? "Manage reusable questions stored in this bank."
                    : "Create and manage pools of questions to draw randomly into quizzes."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto pr-1 space-y-4">
            {!selectedBankId ? (
              // Bank list view
              <>
                {canManage && (
                  <form
                    onSubmit={handleCreateBank}
                    className="flex items-end gap-2 p-3 rounded-lg border bg-muted/30"
                  >
                    <div className="flex-1 space-y-1">
                      <Label htmlFor="bankTitle" className="text-xs">
                        New question bank
                      </Label>
                      <Input
                        id="bankTitle"
                        placeholder="e.g. Chapter 4 Fractions, World War II Quiz..."
                        value={newTitle.value}
                        onChange={(e) => (newTitle.value = e.target.value)}
                        disabled={creating.value}
                      />
                    </div>
                    <Button type="submit" disabled={creating.value || !newTitle.value.trim()}>
                      {creating.value ? (
                        <Loader2 className="size-4 animate-spin mr-1" />
                      ) : (
                        <Plus className="size-4 mr-1" />
                      )}
                      Create bank
                    </Button>
                  </form>
                )}

                {loading ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  </div>
                ) : banks.value.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted-foreground border border-dashed rounded-lg">
                    No question banks created yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {banks.value.map((b) => (
                      <div
                        key={b.id}
                        className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                      >
                        <button
                          type="button"
                          className="flex-1 text-left"
                          onClick={() => setSelectedBankId(b.id)}
                        >
                          <div className="font-medium text-sm hover:underline">
                            {b.title}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {b.questionCount} question{b.questionCount === 1 ? "" : "s"}
                          </div>
                        </button>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedBankId(b.id)}
                          >
                            View questions
                          </Button>
                          {canManage && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => (confirmDeleteId.value = b.id)}
                            >
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              // Bank detail & questions view
              <>
                {loadingDetail || !bankDetail ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Header bar / title rename */}
                    <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
                      {editingTitle ? (
                        <div className="flex items-center gap-2 flex-1">
                          <Input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className="h-8"
                            autoFocus
                          />
                          <Button
                            size="sm"
                            className="h-8"
                            onClick={handleRename}
                            disabled={savingRename.value}
                          >
                            {savingRename.value ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <Check className="size-3" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8"
                            onClick={() => {
                              setRenameValue(bankDetail.title);
                              setEditingTitle(false);
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{bankDetail.title}</span>
                          <Badge variant="secondary">
                            {bankDetail.questions.length} question
                            {bankDetail.questions.length === 1 ? "" : "s"}
                          </Badge>
                          {canManage && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              onClick={() => setEditingTitle(true)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      )}

                      {canManage && !editingTitle && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive h-8 px-2"
                          onClick={() => (confirmDeleteId.value = bankDetail.id)}
                        >
                          <Trash2 className="size-4 mr-1" />
                          Delete bank
                        </Button>
                      )}
                    </div>

                    {/* Question list */}
                    <div className="space-y-3">
                      {bankDetail.questions.map((q, idx) => (
                        <QuestionCard
                          key={q.id}
                          question={q}
                          index={idx}
                          bankId={bankDetail.id}
                          canEdit={canManage}
                          onChangedAction={() => {
                            loadDetail(bankDetail.id);
                            loadBanks();
                          }}
                        />
                      ))}
                    </div>

                    {/* Add question form */}
                    {canManage && (
                      <Card className="mt-4">
                        <CardHeader className="py-3">
                          <CardTitle className="text-sm">
                            Add a question to this bank
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <QuestionForm
                            key={bankDetail.questions.length}
                            submitLabel="Add to bank"
                            busy={addingQuestion.value}
                            onSubmitAction={handleAddQuestion}
                          />
                        </CardContent>
                      </Card>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmDeleteId.value !== null}
        onOpenChange={(v) => !v && (confirmDeleteId.value = null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete question bank?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the question bank and all unused questions in it.
              Quizzes drawing from this bank will stop drawing from it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting.value}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting.value}
              onClick={() => confirmDeleteId.value && handleDeleteBank(confirmDeleteId.value)}
            >
              {deleting.value && <Loader2 className="size-4 animate-spin mr-1" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
