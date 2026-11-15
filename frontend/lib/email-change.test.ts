import { describe, expect, test } from "bun:test";
import { canAskForEmail, cleanEmailCode } from "./email-change";

describe("email change helpers", () => {
  test("codes are eight digits", () => {
    expect(cleanEmailCode(" 1234-5678 9")).toBe("12345678");
  });
  test("a new, plausible address", () => {
    expect(canAskForEmail("new@example.com", "old@example.com")).toBe(true);
    expect(canAskForEmail(" OLD@example.com ", "old@example.com")).toBe(false);
    expect(canAskForEmail("nope", "old@example.com")).toBe(false);
  });
});
