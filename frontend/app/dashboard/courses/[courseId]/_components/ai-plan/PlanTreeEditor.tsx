"use client";

import { useId } from "react";
import { ArrowDown, ArrowUp, ClipboardList, FileText, ListChecks, Plus, Trash2 } from "lucide-react";
import {
  ITEM_KIND_LABEL,
  PLAN_ITEM_KINDS,
  PLAN_MAX_ITEMS,
  SUBMISSION_LABEL,
  SUBMISSION_TYPES,
  addItem,
  moveItem,
  moveModule,
  parseWhole,
  removeItem,
  removeModule,
  toggleItem,
  toggleModule,
  toggleOutcome,
  updateItem,
  updateModule,
  type ItemNode,
  type ModuleNode,
  type PlanItemKind,
  type PlanTree,
  type SubmissionType,
} from "@/lib/ai-course-plan";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

const KIND_ICON: Record<PlanItemKind, typeof FileText> = {
  page: FileText,
  assignment: ClipboardList,
  quiz: ListChecks,
};

/**
 * An AI plan as an editable tree: modules and their items (and outcomes),
 * each with a checkbox (only ticked ones are created), rename fields, move
 * up / down and remove buttons, and item details (description, points,
 * due week, questions, group, submission). Everything is a native control,
 * so the tree is fully keyboard-operable; there is no drag-only action.
 */
export function PlanTreeEditor({
  tree,
  onChangeAction,
  singleModule = false,
  groupNames = [],
  showDueWeeks = true,
}: {
  tree: PlanTree;
  onChangeAction: (tree: PlanTree) => void;
  /** Suggestions for one existing module: no module controls. */
  singleModule?: boolean;
  /** Assignment group names offered in the group field. */
  groupNames?: string[];
  showDueWeeks?: boolean;
}) {
  const id = useId();
  const listId = `${id}-groups`;
  const allGroups = [...new Set([...groupNames, ...tree.flatMap((m) => m.items.map((i) => i.group).filter(Boolean))])];

  return (
    <div className="space-y-4">
      <datalist id={listId}>
        {allGroups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      <ol className="space-y-4" aria-label={singleModule ? "Suggested items" : "Modules"}>
        {tree.map((m, mi) => (
          <ModuleEditor
            key={m.key}
            m={m}
            index={mi}
            count={tree.length}
            tree={tree}
            onChangeAction={onChangeAction}
            singleModule={singleModule}
            groupList={listId}
            showDueWeeks={showDueWeeks}
          />
        ))}
      </ol>
    </div>
  );
}

function ModuleEditor({
  m,
  index,
  count,
  tree,
  onChangeAction,
  singleModule,
  groupList,
  showDueWeeks,
}: {
  m: ModuleNode;
  index: number;
  count: number;
  tree: PlanTree;
  onChangeAction: (tree: PlanTree) => void;
  singleModule: boolean;
  groupList: string;
  showDueWeeks: boolean;
}) {
  const id = useId();
  const label = m.title.trim() || `Module ${index + 1}`;
  const add = (kind: PlanItemKind) => {
    const next = addItem(tree, m.key, kind);
    if (next) onChangeAction(next);
  };

  return (
    <li className={`space-y-3 rounded-lg border p-3 ${m.selected ? "" : "opacity-60"}`} aria-label={singleModule ? undefined : label}>
      {!singleModule && (
        <div className="flex flex-wrap items-center gap-2">
          <Checkbox
            id={`${id}-sel`}
            checked={m.selected}
            onCheckedChange={(v) => onChangeAction(toggleModule(tree, m.key, v === true))}
            aria-label={`Create module ${label}`}
          />
          <Label htmlFor={`${id}-title`} className="sr-only">
            Module {index + 1} title
          </Label>
          <Input
            id={`${id}-title`}
            className="min-w-48 flex-1 font-medium"
            value={m.title}
            maxLength={200}
            onChange={(e) => onChangeAction(updateModule(tree, m.key, { title: e.target.value }))}
          />
          <div className="flex gap-1">
            <Button type="button" size="icon" variant="ghost" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onChangeAction(moveModule(tree, m.key, -1))}>
              <ArrowUp className="size-4" aria-hidden />
            </Button>
            <Button type="button" size="icon" variant="ghost" aria-label={`Move ${label} down`} disabled={index === count - 1} onClick={() => onChangeAction(moveModule(tree, m.key, 1))}>
              <ArrowDown className="size-4" aria-hidden />
            </Button>
            <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${label}`} onClick={() => onChangeAction(removeModule(tree, m.key))}>
              <Trash2 className="size-4 text-destructive" aria-hidden />
            </Button>
          </div>
        </div>
      )}
      {!singleModule && (
        <div className="space-y-1">
          <Label htmlFor={`${id}-overview`} className="text-xs text-muted-foreground">
            Overview
          </Label>
          <Textarea
            id={`${id}-overview`}
            rows={2}
            maxLength={1000}
            value={m.overview}
            onChange={(e) => onChangeAction(updateModule(tree, m.key, { overview: e.target.value }))}
          />
        </div>
      )}

      {m.outcomes.length > 0 && (
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-muted-foreground">Learning outcomes</legend>
          <ul className="space-y-1">
            {m.outcomes.map((o) => (
              <li key={o.key} className="flex items-start gap-2 text-sm">
                <Checkbox
                  id={`${id}-${o.key}`}
                  checked={o.selected}
                  onCheckedChange={(v) => onChangeAction(toggleOutcome(tree, m.key, o.key, v === true))}
                />
                <Label htmlFor={`${id}-${o.key}`} className="font-normal">
                  <span className="font-mono text-xs">{o.code}</span> {o.title}
                </Label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      <ol className="space-y-2" aria-label={`Items in ${label}`}>
        {m.items.map((it, ii) => (
          <ItemEditor
            key={it.key}
            m={m}
            it={it}
            index={ii}
            tree={tree}
            onChangeAction={onChangeAction}
            groupList={groupList}
            showDueWeeks={showDueWeeks}
          />
        ))}
      </ol>
      {m.items.length === 0 && <p className="text-sm text-muted-foreground">No items.</p>}

      <div className="flex flex-wrap gap-2">
        {PLAN_ITEM_KINDS.map((k) => (
          <Button key={k} type="button" size="sm" variant="outline" disabled={m.items.length >= PLAN_MAX_ITEMS} onClick={() => add(k)}>
            <Plus className="mr-1 size-3.5" aria-hidden />
            {ITEM_KIND_LABEL[k]}
          </Button>
        ))}
      </div>
    </li>
  );
}

function ItemEditor({
  m,
  it,
  index,
  tree,
  onChangeAction,
  groupList,
  showDueWeeks,
}: {
  m: ModuleNode;
  it: ItemNode;
  index: number;
  tree: PlanTree;
  onChangeAction: (tree: PlanTree) => void;
  groupList: string;
  showDueWeeks: boolean;
}) {
  const id = useId();
  const Icon = KIND_ICON[it.kind];
  const label = it.title.trim() || `item ${index + 1}`;
  const set = (patch: Partial<ItemNode>) => onChangeAction(updateItem(tree, m.key, it.key, patch));
  const assessment = it.kind !== "page";

  return (
    <li className={`rounded-md border bg-muted/20 p-2 ${it.selected ? "" : "opacity-60"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Checkbox
          id={`${id}-sel`}
          checked={it.selected}
          onCheckedChange={(v) => onChangeAction(toggleItem(tree, m.key, it.key, v === true))}
          aria-label={`Create ${label}`}
        />
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <Label htmlFor={`${id}-kind`} className="sr-only">
          Kind of {label}
        </Label>
        <NativeSelect id={`${id}-kind`} className="w-36" value={it.kind} onChange={(e) => set({ kind: e.target.value as PlanItemKind })}>
          {PLAN_ITEM_KINDS.map((k) => (
            <NativeSelectOption key={k} value={k}>
              {ITEM_KIND_LABEL[k]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Label htmlFor={`${id}-title`} className="sr-only">
          Title of item {index + 1}
        </Label>
        <Input id={`${id}-title`} className="min-w-40 flex-1" value={it.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />
        <div className="flex gap-1">
          <Button type="button" size="icon" variant="ghost" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onChangeAction(moveItem(tree, m.key, it.key, -1))}>
            <ArrowUp className="size-4" aria-hidden />
          </Button>
          <Button type="button" size="icon" variant="ghost" aria-label={`Move ${label} down`} disabled={index === m.items.length - 1} onClick={() => onChangeAction(moveItem(tree, m.key, it.key, 1))}>
            <ArrowDown className="size-4" aria-hidden />
          </Button>
          <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${label}`} onClick={() => onChangeAction(removeItem(tree, m.key, it.key))}>
            <Trash2 className="size-4 text-destructive" aria-hidden />
          </Button>
        </div>
      </div>
      <details className="mt-2 pl-6">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Details
          {assessment && it.points !== null ? ` · ${it.points} pts` : ""}
          {it.kind === "quiz" && it.questionCount ? ` · ${it.questionCount} questions` : ""}
          {showDueWeeks && assessment && it.dueOffsetWeeks !== null ? ` · week ${it.dueOffsetWeeks + 1}` : ""}
          {it.group ? ` · ${it.group}` : ""}
        </summary>
        <div className="mt-2 space-y-2">
          <div className="space-y-1">
            <Label htmlFor={`${id}-desc`} className="text-xs">
              {it.kind === "page" ? "Outline (the page's starting text)" : it.kind === "quiz" ? "Topic" : "Instructions"}
            </Label>
            <Textarea id={`${id}-desc`} rows={3} maxLength={10000} value={it.description} onChange={(e) => set({ description: e.target.value })} />
          </div>
          {assessment && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor={`${id}-points`} className="text-xs">
                  Points
                </Label>
                <Input
                  id={`${id}-points`}
                  type="number"
                  min={0}
                  max={1000}
                  value={it.points ?? ""}
                  onChange={(e) => set({ points: parseWhole(e.target.value, 0, 1000) })}
                />
              </div>
              {showDueWeeks && (
                <div className="space-y-1">
                  <Label htmlFor={`${id}-due`} className="text-xs">
                    Due in week (blank: none)
                  </Label>
                  <Input
                    id={`${id}-due`}
                    type="number"
                    min={1}
                    max={105}
                    value={it.dueOffsetWeeks === null ? "" : it.dueOffsetWeeks + 1}
                    onChange={(e) => {
                      const w = parseWhole(e.target.value, 1, 105);
                      set({ dueOffsetWeeks: w === null ? null : w - 1 });
                    }}
                  />
                </div>
              )}
              {it.kind === "quiz" && (
                <div className="space-y-1">
                  <Label htmlFor={`${id}-qs`} className="text-xs">
                    Questions
                  </Label>
                  <Input
                    id={`${id}-qs`}
                    type="number"
                    min={1}
                    max={10}
                    value={it.questionCount ?? ""}
                    onChange={(e) => set({ questionCount: parseWhole(e.target.value, 1, 10) })}
                  />
                </div>
              )}
              {it.kind === "assignment" && (
                <div className="space-y-1">
                  <Label htmlFor={`${id}-sub`} className="text-xs">
                    Hand in
                  </Label>
                  <NativeSelect id={`${id}-sub`} value={it.submission ?? "text"} onChange={(e) => set({ submission: e.target.value as SubmissionType })}>
                    {SUBMISSION_TYPES.map((s) => (
                      <NativeSelectOption key={s} value={s}>
                        {SUBMISSION_LABEL[s]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor={`${id}-group`} className="text-xs">
                  Assignment group
                </Label>
                <Input id={`${id}-group`} list={groupList} maxLength={100} value={it.group} onChange={(e) => set({ group: e.target.value })} />
              </div>
            </div>
          )}
          {assessment && m.outcomes.length > 0 && (
            <fieldset className="space-y-1">
              <legend className="text-xs">Measures outcomes</legend>
              <div className="flex flex-wrap gap-3">
                {m.outcomes.map((o) => {
                  const on = it.outcomes.some((c) => c.toLowerCase() === o.code.toLowerCase());
                  return (
                    <span key={o.key} className="flex items-center gap-1.5 text-sm">
                      <Checkbox
                        id={`${id}-oc-${o.key}`}
                        checked={on}
                        onCheckedChange={(v) =>
                          set({
                            outcomes: v === true ? [...it.outcomes, o.code] : it.outcomes.filter((c) => c.toLowerCase() !== o.code.toLowerCase()),
                          })
                        }
                      />
                      <Label htmlFor={`${id}-oc-${o.key}`} className="font-mono text-xs font-normal">
                        {o.code}
                      </Label>
                    </span>
                  );
                })}
              </div>
            </fieldset>
          )}
        </div>
      </details>
    </li>
  );
}
