import { describe, expect, test } from "bun:test";
import {
  canRequestNew,
  categorySummary,
  exportPhase,
  exportStatusText,
  exportsFor,
  formatBytes,
  isDownloadable,
  listPath,
  pollDelayMs,
  requestPath,
  shouldPoll,
  staffExportWarnings,
  type DataExport,
} from "./data-export";

const now = new Date("2026-11-13T12:00:00Z");
const base: DataExport = {
  id: "e1",
  kind: "self",
  status: "pending",
  studentId: null,
  studentName: null,
  createdAt: "2026-11-13T11:00:00Z",
  completedAt: null,
  expiresAt: null,
  downloadedAt: null,
  byteSize: null,
  categories: {},
  filesIncluded: 0,
  filesSkipped: 0,
  error: null,
};

describe("data export paths", () => {
  test("request and list paths per target", () => {
    expect(requestPath({ kind: "self" })).toBe("/data-exports/me");
    expect(requestPath({ kind: "student", studentId: "s1" })).toBe("/data-exports/students/s1");
    expect(requestPath({ kind: "child", studentId: "s1" })).toBe("/data-exports/children/s1");
    expect(listPath({ kind: "self" })).toBe("/data-exports");
    expect(listPath({ kind: "child", studentId: "s1" })).toBe("/data-exports?studentId=s1");
  });

  test("the list keeps only this target's exports", () => {
    const rows: DataExport[] = [
      base,
      { ...base, id: "e2", kind: "child", studentId: "s1" },
      { ...base, id: "e3", kind: "child", studentId: "s2" },
      { ...base, id: "e4", kind: "student", studentId: "s1" },
    ];
    expect(exportsFor(rows, { kind: "self" }).map((e) => e.id)).toEqual(["e1"]);
    expect(exportsFor(rows, { kind: "child", studentId: "s1" }).map((e) => e.id)).toEqual(["e2"]);
    expect(exportsFor(rows, { kind: "student", studentId: "s1" }).map((e) => e.id)).toEqual(["e4"]);
  });
});

describe("data export status", () => {
  test("phases: preparing, ready until expiry, then expired; failed", () => {
    expect(exportPhase(base, now)).toBe("preparing");
    expect(exportPhase({ ...base, status: "running" }, now)).toBe("preparing");
    const ready = { ...base, status: "ready", expiresAt: "2026-11-14T12:00:00Z" };
    expect(exportPhase(ready, now)).toBe("ready");
    expect(isDownloadable(ready, now)).toBe(true);
    const lapsed = { ...ready, expiresAt: "2026-11-13T11:59:00Z" };
    expect(exportPhase(lapsed, now)).toBe("expired");
    expect(isDownloadable(lapsed, now)).toBe(false);
    expect(isDownloadable({ ...ready, expiresAt: null }, now)).toBe(false);
    expect(exportPhase({ ...base, status: "failed" }, now)).toBe("failed");
    expect(exportPhase({ ...base, status: "expired" }, now)).toBe("expired");
  });

  test("status text", () => {
    expect(exportStatusText(base, now)).toContain("Waiting");
    expect(exportStatusText({ ...base, status: "running" }, now)).toContain("Being prepared");
    expect(
      exportStatusText({ ...base, status: "ready", expiresAt: "2026-11-14T12:00:00Z" }, now, () => "tomorrow"),
    ).toBe("Ready to download until tomorrow");
    expect(exportStatusText({ ...base, status: "failed", error: "Boom" }, now)).toBe(
      "It could not be prepared: Boom",
    );
    expect(exportStatusText({ ...base, status: "expired" }, now)).toContain("Expired");
  });

  test("polling only while something is being prepared, backing off", () => {
    expect(shouldPoll([base])).toBe(true);
    expect(shouldPoll([{ ...base, status: "ready" }, { ...base, status: "failed" }])).toBe(false);
    expect(shouldPoll([])).toBe(false);
    expect(canRequestNew([{ ...base, status: "running" }])).toBe(false);
    expect(canRequestNew([{ ...base, status: "ready" }])).toBe(true);
    expect(pollDelayMs(0)).toBe(3000);
    expect(pollDelayMs(1)).toBeGreaterThan(pollDelayMs(0));
    expect(pollDelayMs(100)).toBe(30000);
  });

  test("sizes and categories", () => {
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
    expect(categorySummary({ coursework: 3, chat: 0, "x-y": 1 })).toEqual(["Coursework and grades (3)", "x y (1)"]);
  });

  test("staff warnings: withheld notes, incomplete pastoral view, skipped files", () => {
    const ready = { ...base, kind: "student" as const, status: "ready" };
    expect(staffExportWarnings({ ...ready, withheldNotes: 0, pastoralComplete: true })).toEqual([]);
    const w = staffExportWarnings({ ...ready, withheldNotes: 2, pastoralComplete: false, filesSkipped: 1 });
    expect(w).toHaveLength(3);
    expect(w[0]).toContain("2 pastoral notes were withheld");
    expect(staffExportWarnings({ ...base, withheldNotes: 2 })).toEqual([]);
  });
});
