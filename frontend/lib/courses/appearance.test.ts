import { describe, expect, test } from "bun:test";
import {
  bannerAccent,
  bannerGradient,
  COURSE_BANNER_COLORS,
  COURSE_BANNER_PRESETS,
} from "./appearance";
import { courseColor, courseGradient } from "./format";

const ID = "8b0c7d4e-1111-4222-8333-444455556666";

describe("course banner appearance", () => {
  test("auto (null/undefined) keeps the id-derived gradient", () => {
    expect(bannerGradient({ id: ID, bannerColor: null })).toBe(courseGradient(ID));
    expect(bannerGradient({ id: ID })).toBe(courseGradient(ID));
    expect(bannerAccent({ id: ID })).toBe(courseColor(ID));
  });

  test("a preset key resolves to its gradient and accent", () => {
    const teal = COURSE_BANNER_PRESETS.teal;
    expect(bannerGradient({ id: ID, bannerColor: "teal" })).toBe(
      `linear-gradient(135deg, ${teal.from}, ${teal.to})`,
    );
    expect(bannerAccent({ id: ID, bannerColor: "teal" })).toBe(teal.from);
  });

  test("an unknown key (or a prototype name) falls back to auto", () => {
    for (const bannerColor of ["purple", "toString", "__proto__", ""]) {
      expect(bannerGradient({ id: ID, bannerColor })).toBe(courseGradient(ID));
    }
  });

  test("matches the backend's palette keys", () => {
    expect(COURSE_BANNER_COLORS).toEqual([
      "indigo",
      "violet",
      "blue",
      "sky",
      "teal",
      "green",
      "amber",
      "orange",
      "rose",
      "slate",
    ]);
  });
});
