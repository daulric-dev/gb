import { describe, expect, test } from "bun:test";
import { formatScore, roundScore } from "./format-number";

describe("formatScore", () => {
  test("rounds long fractions to two places", () => {
    expect(formatScore(6.666666666)).toBe("6.67");
    expect(formatScore(73.0158730158)).toBe("73.02");
  });
  test("drops trailing zeros", () => {
    expect(formatScore(9.5)).toBe("9.5");
    expect(formatScore(90)).toBe("90");
    expect(formatScore(1.005)).toBe("1.01");
  });
  test("missing values show a dash", () => {
    expect(formatScore(null)).toBe("—");
    expect(formatScore(undefined)).toBe("—");
    expect(formatScore(Number.NaN)).toBe("—");
  });
  test("roundScore keeps numbers numeric", () => {
    expect(roundScore(2 / 3)).toBe(0.67);
  });
});
