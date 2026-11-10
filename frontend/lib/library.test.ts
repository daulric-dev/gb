import { describe, expect, test } from "bun:test";
import {
  browseQuery,
  countsSummary,
  formatBytes,
  importLabel,
  importPercent,
  isWholeCourse,
  parseTags,
} from "./library";

const counts = {
  modules: 3,
  moduleItems: 9,
  pages: 1,
  activities: 3,
  quizzes: 2,
  rubrics: 0,
  questionBanks: 0,
  discussionTopics: 0,
  files: 1,
  externalTools: 0,
};

describe("library helpers", () => {
  test("counts read as a short summary without zeros", () => {
    expect(countsSummary(counts)).toBe("3 modules · 1 assignment · 2 quizzes · 1 page · 1 file");
    expect(countsSummary({ ...counts, modules: 0, pages: 0, activities: 0, quizzes: 0, files: 0 })).toBe("Empty");
  });

  test("bytes are human readable", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });

  test("import progress follows copied files and is 100 only when done", () => {
    expect(importPercent({ status: "queued", filesDone: 0, filesTotal: 4 })).toBe(0);
    expect(importPercent({ status: "copying", filesDone: 2, filesTotal: 4 })).toBe(50);
    expect(importPercent({ status: "copying", filesDone: 4, filesTotal: 4 })).toBe(99);
    expect(importPercent({ status: "done", filesDone: 4, filesTotal: 4 })).toBe(100);
    expect(importLabel({ status: "copying", filesDone: 1, filesTotal: 3 })).toBe("Copying files (1 of 3)…");
    expect(importLabel({ status: "failed", filesDone: 0, filesTotal: 0 })).toBe("Import failed");
  });

  test("tags are trimmed, lower-cased and de-duplicated", () => {
    expect(parseTags(" Cells, cells,\nGenetics ,, ")).toEqual(["cells", "genetics"]);
  });

  test("browse query leaves out empty filters and the default scope", () => {
    expect(browseQuery({ q: " cells ", scope: "all", subject: "" })).toBe("?q=cells");
    expect(browseQuery({ scope: "mine" })).toBe("?scope=mine");
    expect(browseQuery({})).toBe("");
  });

  test("an empty selection is the whole course", () => {
    expect(isWholeCourse(null)).toBe(true);
    expect(isWholeCourse({ moduleIds: [] })).toBe(true);
    expect(isWholeCourse({ pageIds: ["p"] })).toBe(false);
  });
});
