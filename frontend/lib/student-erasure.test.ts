import { describe, expect, test } from "bun:test";
import { accountOutcomeText, eraseConfirmMatches, eraseConfirmWord } from "./student-erasure";

describe("student erasure confirmation", () => {
  test("type the name; spacing and case do not matter", () => {
    expect(eraseConfirmMatches("ada  LOVELACE ", "Ada Lovelace")).toBe(true);
    expect(eraseConfirmMatches("Ada", "Ada Lovelace")).toBe(false);
    expect(eraseConfirmMatches("", "Ada Lovelace")).toBe(false);
  });
  test("ERASE when the record has no name", () => {
    expect(eraseConfirmWord("  ")).toBe("ERASE");
    expect(eraseConfirmMatches("erase", "")).toBe(true);
  });
  test("each account outcome is explained", () => {
    expect(accountOutcomeText("deleted")).toContain("deleted");
    expect(accountOutcomeText("unlinked")).toContain("kept");
  });
});
