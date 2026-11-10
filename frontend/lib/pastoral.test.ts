import { describe, expect, test } from "bun:test";
import { emptyNoteForm, followUpState, noteRequest, notesQuery } from "./pastoral";

describe("pastoral helpers", () => {
  test("follow-ups are overdue, today or upcoming only while open", () => {
    const today = "2026-11-10";
    expect(followUpState({ followUpOn: "2026-11-09", status: "open" }, today)).toBe("overdue");
    expect(followUpState({ followUpOn: today, status: "open" }, today)).toBe("today");
    expect(followUpState({ followUpOn: "2026-12-01", status: "open" }, today)).toBe("upcoming");
    expect(followUpState({ followUpOn: "2026-11-09", status: "resolved" }, today)).toBeNull();
    expect(followUpState({ followUpOn: null, status: "open" }, today)).toBeNull();
  });

  test("the list query leaves out empty filters", () => {
    expect(notesQuery({ status: "open", severity: "", categoryId: " " })).toBe("?status=open");
    expect(notesQuery({})).toBe("");
  });

  test("a new note needs a category, a date and text; empty options are left out", () => {
    const f = emptyNoteForm("2026-11-10");
    expect(noteRequest(f, false)).toEqual({ ok: false, error: "Choose a category" });
    const ok = noteRequest({ ...f, categoryId: "c", body: " Kind " }, false);
    expect(ok).toEqual({
      ok: true,
      body: { categoryId: "c", severity: "low", occurredOn: "2026-11-10", body: "Kind", fileIds: [] },
    });
  });

  test("edits clear options with null, and a follow-up cannot precede the note", () => {
    const f = { ...emptyNoteForm("2026-11-10"), categoryId: "c", body: "x" };
    const edit = noteRequest(f, true);
    expect(edit.ok && edit.body.followUpOn).toBeNull();
    expect(edit.ok && edit.body.assignedTo).toBeNull();
    expect(noteRequest({ ...f, followUpOn: "2026-11-01" }, false)).toEqual({
      ok: false,
      error: "The follow-up date is before the note's date",
    });
  });
});
