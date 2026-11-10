import { describe, expect, test } from "bun:test";
import {
  addItem,
  addModule,
  countSelected,
  dueLabel,
  fromDraft,
  move,
  moveItem,
  moveModule,
  parseWhole,
  planProblems,
  removeItem,
  removeModule,
  renameModule,
  selectAll,
  toCreateBody,
  toggleItem,
  toggleModule,
  toggleOutcome,
  updateItem,
  PLAN_MAX_ITEMS,
  type PlanModule,
} from "@/lib/ai-course-plan";

const DRAFT: PlanModule[] = [
  {
    title: "Cells",
    overview: "What cells are.",
    items: [
      { kind: "page", title: "Inside a cell", description: "- nucleus", points: null, dueOffsetWeeks: null, questionCount: null, group: "", submission: null, outcomes: [] },
      { kind: "assignment", title: "Diagram", description: "Draw.", points: 20, dueOffsetWeeks: 1, questionCount: null, group: "Homework", submission: "file", outcomes: ["U1.1", "U1.2"] },
      { kind: "quiz", title: "Quiz", description: "Parts", points: 5, dueOffsetWeeks: 2, questionCount: 5, group: "Quizzes", submission: null, outcomes: [] },
    ],
    outcomes: [
      { code: "U1.1", title: "Describe cells" },
      { code: "U1.2", title: "Label diagrams" },
    ],
  },
  { title: "Genetics", overview: "", items: [], outcomes: [] },
];

describe("plan tree", () => {
  test("fromDraft keys everything and selects it", () => {
    const tree = fromDraft(DRAFT);
    expect(tree.map((m) => m.key)).toEqual(["m0", "m1"]);
    expect(tree[0].items.map((i) => i.key)).toEqual(["m0-i0", "m0-i1", "m0-i2"]);
    expect(countSelected(tree)).toEqual({ modules: 2, items: 3, outcomes: 2 });
    const existing = fromDraft([DRAFT[1]], "mod-1");
    expect(existing[0].existingModuleId).toBe("mod-1");
  });

  test("rename, update and remove never mutate the original", () => {
    const tree = fromDraft(DRAFT);
    const renamed = renameModule(tree, "m0", "Living cells");
    expect(renamed[0].title).toBe("Living cells");
    expect(tree[0].title).toBe("Cells");
    const pts = updateItem(tree, "m0", "m0-i1", { points: 50, title: "Big diagram" });
    expect(pts[0].items[1]).toMatchObject({ points: 50, title: "Big diagram" });
    // Changing the kind to a page clears assessment fields.
    const asPage = updateItem(tree, "m0", "m0-i1", { kind: "page" });
    expect(asPage[0].items[1]).toMatchObject({ points: null, dueOffsetWeeks: null, group: "", submission: null, outcomes: [] });
    const asQuiz = updateItem(tree, "m0", "m0-i0", { kind: "quiz" });
    expect(asQuiz[0].items[0]).toMatchObject({ questionCount: 5, points: 5 });
    expect(removeItem(tree, "m0", "m0-i0")[0].items.map((i) => i.key)).toEqual(["m0-i1", "m0-i2"]);
    expect(removeModule(tree, "m0").map((m) => m.key)).toEqual(["m1"]);
  });

  test("reorder with buttons: up and down, clamped at the ends", () => {
    expect(move([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(move([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(move([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
    const tree = fromDraft(DRAFT);
    expect(moveModule(tree, "m1", -1).map((m) => m.key)).toEqual(["m1", "m0"]);
    expect(moveItem(tree, "m0", "m0-i2", -1)[0].items.map((i) => i.key)).toEqual(["m0-i0", "m0-i2", "m0-i1"]);
    expect(moveItem(tree, "m0", "missing", -1)[0].items).toEqual(tree[0].items);
  });

  test("add modules and items, up to the limits", () => {
    const tree = fromDraft(DRAFT);
    const more = addModule(tree)!;
    expect(more).toHaveLength(3);
    expect(more[2]).toMatchObject({ title: "New module", items: [] });
    const withItem = addItem(tree, "m1", "assignment")!;
    expect(withItem[1].items[0]).toMatchObject({ kind: "assignment", points: 10, submission: "text", selected: true });
    let full = tree;
    for (let i = 0; i < PLAN_MAX_ITEMS; i++) full = addItem(full, "m1", "page") ?? full;
    expect(addItem(full, "m1", "page")).toBeNull();
  });

  test("selection: module toggles its children; an item selects its module", () => {
    const tree = fromDraft(DRAFT);
    const off = toggleModule(tree, "m0", false);
    expect(countSelected(off)).toEqual({ modules: 1, items: 0, outcomes: 0 });
    const back = toggleItem(off, "m0", "m0-i1", true);
    expect(back[0].selected).toBe(true);
    expect(countSelected(back).items).toBe(1);
    expect(countSelected(selectAll(tree, false))).toEqual({ modules: 0, items: 0, outcomes: 0 });
    expect(countSelected(selectAll(off, true)).items).toBe(3);
  });

  test("toCreateBody sends only what is selected, without keys; outcome codes follow selected outcomes", () => {
    let tree = fromDraft(DRAFT);
    tree = toggleItem(tree, "m0", "m0-i0", false);
    tree = toggleOutcome(tree, "m0", "m0-o1", false);
    tree = toggleModule(tree, "m1", false);
    const body = toCreateBody(tree, { startDate: "2027-01-11", draftQuestions: true });
    expect(body.startDate).toBe("2027-01-11");
    expect(body.draftQuestions).toBe(true);
    expect(body.modules).toHaveLength(1);
    expect(body.modules[0].items.map((i) => i.title)).toEqual(["Diagram", "Quiz"]);
    expect(body.modules[0].items[0].outcomes).toEqual(["U1.1"]);
    expect(body.modules[0].outcomes).toEqual([{ code: "U1.1", title: "Describe cells" }]);
    expect(JSON.stringify(body)).not.toContain("key");
    expect(JSON.stringify(body)).not.toContain("selected");
    const noOutcomes = toCreateBody(fromDraft(DRAFT), { createOutcomes: false });
    expect(noOutcomes.modules[0].outcomes).toBeUndefined();
    expect(noOutcomes.modules[0].items[1].outcomes).toEqual([]);
    expect(noOutcomes.createOutcomes).toBe(false);
  });

  test("problems, labels and number parsing", () => {
    const tree = updateItem(renameModule(fromDraft(DRAFT), "m1", " "), "m0", "m0-i0", { title: "" });
    expect(planProblems(tree)).toEqual(['Item 1 in "Cells" needs a title', "Module 2 needs a title"]);
    expect(planProblems(toggleModule(tree, "m1", false))).toHaveLength(1);
    expect(dueLabel(null)).toBe("No due date");
    expect(dueLabel(0)).toBe("Due in week 1");
    expect(parseWhole("", 0, 10)).toBeNull();
    expect(parseWhole("12.6", 0, 10)).toBe(10);
    expect(parseWhole("abc", 0, 10)).toBeNull();
  });
});
