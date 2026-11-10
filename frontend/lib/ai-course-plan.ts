/**
 * The AI course plan as an editable tree (API `src/ai/ai-course.service.ts`).
 * Pure helpers: every change returns a new tree, so the builder keeps it in
 * one signal. Nothing here talks to the API; `toCreateBody` shapes what
 * "Create selected" sends (only selected modules, items and outcomes).
 */

export const PLAN_ITEM_KINDS = ["page", "assignment", "quiz"] as const;
export type PlanItemKind = (typeof PLAN_ITEM_KINDS)[number];
export const SUBMISSION_TYPES = ["text", "file", "text_and_file"] as const;
export type SubmissionType = (typeof SUBMISSION_TYPES)[number];

export const PLAN_MAX_MODULES = 20;
export const PLAN_MAX_ITEMS = 15;
export const PLAN_MAX_OUTCOMES = 8;

/** A plan item as the API drafts it. */
export interface PlanItem {
  kind: PlanItemKind;
  title: string;
  description: string;
  points: number | null;
  dueOffsetWeeks: number | null;
  questionCount: number | null;
  group: string;
  submission: SubmissionType | null;
  outcomes: string[];
}

export interface PlanOutcome {
  code: string;
  title: string;
}

export interface PlanModule {
  title: string;
  overview: string;
  items: PlanItem[];
  outcomes: PlanOutcome[];
}

export interface ItemNode extends PlanItem {
  key: string;
  selected: boolean;
}

export interface OutcomeNode extends PlanOutcome {
  key: string;
  selected: boolean;
}

export interface ModuleNode {
  key: string;
  title: string;
  overview: string;
  selected: boolean;
  /** Add to this existing module ("Suggest items for this module"). */
  existingModuleId?: string;
  items: ItemNode[];
  outcomes: OutcomeNode[];
}

export type PlanTree = ModuleNode[];

let seq = 0;
/** A fresh key for a node added by the teacher. */
export function newKey(prefix: string): string {
  seq += 1;
  return `${prefix}-new${seq}`;
}

export const ITEM_KIND_LABEL: Record<PlanItemKind, string> = {
  page: "Page",
  assignment: "Assignment",
  quiz: "Quiz",
};

export const SUBMISSION_LABEL: Record<SubmissionType, string> = {
  text: "Online text",
  file: "File upload",
  text_and_file: "Text and file",
};

export function itemNode(item: PlanItem, key: string): ItemNode {
  return { ...item, outcomes: [...item.outcomes], key, selected: true };
}

/** The drafted plan as a tree, everything selected. */
export function fromDraft(modules: PlanModule[], existingModuleId?: string): PlanTree {
  return modules.map((m, i) => ({
    key: `m${i}`,
    title: m.title,
    overview: m.overview,
    selected: true,
    ...(existingModuleId ? { existingModuleId } : {}),
    items: m.items.map((it, j) => itemNode(it, `m${i}-i${j}`)),
    outcomes: m.outcomes.map((o, j) => ({ ...o, key: `m${i}-o${j}`, selected: true })),
  }));
}

const mapModule = (tree: PlanTree, key: string, fn: (m: ModuleNode) => ModuleNode): PlanTree =>
  tree.map((m) => (m.key === key ? fn(m) : m));

const mapItem = (tree: PlanTree, moduleKey: string, itemKey: string, fn: (i: ItemNode) => ItemNode): PlanTree =>
  mapModule(tree, moduleKey, (m) => ({ ...m, items: m.items.map((i) => (i.key === itemKey ? fn(i) : i)) }));

/** Move entry `index` of `list` by `delta` (clamped); the same list when it cannot move. */
export function move<T>(list: T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length || delta === 0) return list;
  const out = [...list];
  const [it] = out.splice(index, 1);
  out.splice(to, 0, it);
  return out;
}

export function renameModule(tree: PlanTree, key: string, title: string): PlanTree {
  return mapModule(tree, key, (m) => ({ ...m, title }));
}

export function updateModule(tree: PlanTree, key: string, patch: Partial<Pick<ModuleNode, "title" | "overview">>): PlanTree {
  return mapModule(tree, key, (m) => ({ ...m, ...patch }));
}

export function updateItem(
  tree: PlanTree,
  moduleKey: string,
  itemKey: string,
  patch: Partial<Omit<ItemNode, "key">>,
): PlanTree {
  return mapItem(tree, moduleKey, itemKey, (i) => normaliseItem({ ...i, ...patch }));
}

/** Fields that do not apply to the item's kind are cleared; quizzes and assignments get defaults. */
export function normaliseItem(i: ItemNode): ItemNode {
  if (i.kind === "page") {
    return { ...i, points: null, dueOffsetWeeks: null, questionCount: null, submission: null, group: "", outcomes: [] };
  }
  if (i.kind === "quiz") {
    return { ...i, questionCount: i.questionCount ?? 5, points: i.points ?? i.questionCount ?? 5, submission: null };
  }
  return { ...i, questionCount: null, points: i.points ?? 10, submission: i.submission ?? "text" };
}

export function removeModule(tree: PlanTree, key: string): PlanTree {
  return tree.filter((m) => m.key !== key);
}

export function removeItem(tree: PlanTree, moduleKey: string, itemKey: string): PlanTree {
  return mapModule(tree, moduleKey, (m) => ({ ...m, items: m.items.filter((i) => i.key !== itemKey) }));
}

export function moveModule(tree: PlanTree, key: string, delta: number): PlanTree {
  return move(tree, tree.findIndex((m) => m.key === key), delta);
}

export function moveItem(tree: PlanTree, moduleKey: string, itemKey: string, delta: number): PlanTree {
  return mapModule(tree, moduleKey, (m) => ({ ...m, items: move(m.items, m.items.findIndex((i) => i.key === itemKey), delta) }));
}

/** A blank module at the end (null when the plan is full). */
export function addModule(tree: PlanTree, title = "New module"): PlanTree | null {
  if (tree.length >= PLAN_MAX_MODULES) return null;
  return [...tree, { key: newKey("m"), title, overview: "", selected: true, items: [], outcomes: [] }];
}

/** A blank item of `kind` at the end of the module (null when the module is full). */
export function addItem(tree: PlanTree, moduleKey: string, kind: PlanItemKind, title?: string): PlanTree | null {
  const mod = tree.find((m) => m.key === moduleKey);
  if (!mod || mod.items.length >= PLAN_MAX_ITEMS) return null;
  const blank = normaliseItem({
    key: newKey(`${moduleKey}-i`),
    selected: true,
    kind,
    title: title ?? `New ${ITEM_KIND_LABEL[kind].toLowerCase()}`,
    description: "",
    points: null,
    dueOffsetWeeks: null,
    questionCount: null,
    group: "",
    submission: null,
    outcomes: [],
  });
  return mapModule(tree, moduleKey, (m) => ({ ...m, selected: true, items: [...m.items, blank] }));
}

/** Selecting or clearing a module does the same to its items and outcomes. */
export function toggleModule(tree: PlanTree, key: string, selected: boolean): PlanTree {
  return mapModule(tree, key, (m) => ({
    ...m,
    selected,
    items: m.items.map((i) => ({ ...i, selected })),
    outcomes: m.outcomes.map((o) => ({ ...o, selected })),
  }));
}

/** Selecting an item selects its module too (it has to be created to hold it). */
export function toggleItem(tree: PlanTree, moduleKey: string, itemKey: string, selected: boolean): PlanTree {
  return mapModule(tree, moduleKey, (m) => ({
    ...m,
    selected: selected ? true : m.selected,
    items: m.items.map((i) => (i.key === itemKey ? { ...i, selected } : i)),
  }));
}

export function toggleOutcome(tree: PlanTree, moduleKey: string, outcomeKey: string, selected: boolean): PlanTree {
  return mapModule(tree, moduleKey, (m) => ({
    ...m,
    outcomes: m.outcomes.map((o) => (o.key === outcomeKey ? { ...o, selected } : o)),
  }));
}

export function selectAll(tree: PlanTree, selected: boolean): PlanTree {
  return tree.map((m) => ({
    ...m,
    selected,
    items: m.items.map((i) => ({ ...i, selected })),
    outcomes: m.outcomes.map((o) => ({ ...o, selected })),
  }));
}

export function countSelected(tree: PlanTree): { modules: number; items: number; outcomes: number } {
  const mods = tree.filter((m) => m.selected);
  return {
    modules: mods.length,
    items: mods.reduce((n, m) => n + m.items.filter((i) => i.selected).length, 0),
    outcomes: mods.reduce((n, m) => n + m.outcomes.filter((o) => o.selected).length, 0),
  };
}

/** What a teacher must fix before creating: empty titles in what is selected. */
export function planProblems(tree: PlanTree): string[] {
  const out: string[] = [];
  tree.forEach((m, i) => {
    if (!m.selected) return;
    if (!m.title.trim()) out.push(`Module ${i + 1} needs a title`);
    m.items.forEach((it, j) => {
      if (it.selected && !it.title.trim()) out.push(`Item ${j + 1} in "${m.title || `module ${i + 1}`}" needs a title`);
    });
  });
  return out;
}

export interface CreatePlanBody {
  modules: {
    title: string;
    overview?: string;
    existingModuleId?: string;
    items: {
      kind: PlanItemKind;
      title: string;
      description?: string;
      points?: number | null;
      dueOffsetWeeks?: number | null;
      questionCount?: number | null;
      group?: string;
      submission?: SubmissionType | null;
      outcomes?: string[];
    }[];
    outcomes?: PlanOutcome[];
  }[];
  startDate?: string;
  createOutcomes?: boolean;
  overviewPages?: boolean;
  draftQuestions?: boolean;
}

/**
 * The selected part of the tree in the shape `POST /courses/:id/ai/plan/create`
 * takes (keys and selection flags dropped; an item's outcome codes limited
 * to its module's selected outcomes).
 */
export function toCreateBody(
  tree: PlanTree,
  opts: { startDate?: string; createOutcomes?: boolean; overviewPages?: boolean; draftQuestions?: boolean } = {},
): CreatePlanBody {
  const modules = tree
    .filter((m) => m.selected)
    .map((m) => {
      const outcomes = opts.createOutcomes === false ? [] : m.outcomes.filter((o) => o.selected);
      const codes = new Set(outcomes.map((o) => o.code.trim().toLowerCase()));
      return {
        title: m.title.trim(),
        ...(m.overview.trim() ? { overview: m.overview.trim() } : {}),
        ...(m.existingModuleId ? { existingModuleId: m.existingModuleId } : {}),
        items: m.items
          .filter((i) => i.selected)
          .map((i) => ({
            kind: i.kind,
            title: i.title.trim(),
            description: i.description,
            points: i.points,
            dueOffsetWeeks: i.dueOffsetWeeks,
            questionCount: i.questionCount,
            group: i.group.trim(),
            submission: i.submission,
            outcomes: i.outcomes.filter((c) => codes.has(c.trim().toLowerCase())),
          })),
        ...(outcomes.length ? { outcomes: outcomes.map((o) => ({ code: o.code.trim(), title: o.title.trim() })) } : {}),
      };
    });
  return {
    modules,
    ...(opts.startDate ? { startDate: opts.startDate } : {}),
    ...(opts.createOutcomes !== undefined ? { createOutcomes: opts.createOutcomes } : {}),
    ...(opts.overviewPages ? { overviewPages: true } : {}),
    ...(opts.draftQuestions ? { draftQuestions: true } : {}),
  };
}

/** "Week 3" style label for a due offset (0 = the first week). */
export function dueLabel(offsetWeeks: number | null): string {
  return offsetWeeks === null ? "No due date" : `Due in week ${offsetWeeks + 1}`;
}

/** A whole number from a form field, or null when empty / invalid. */
export function parseWhole(value: string, min: number, max: number): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.max(Math.round(n), min), max);
}
