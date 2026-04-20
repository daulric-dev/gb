import { describe, test, expect } from "bun:test";
import { cn } from "@/lib/utils";

describe("cn", () => {
  test("single string returns it", () => {
    expect(cn("text-red-500")).toBe("text-red-500");
  });

  test("merges multiple classes", () => {
    expect(cn("text-red-500", "bg-blue-500")).toBe("text-red-500 bg-blue-500");
  });

  test("handles conditional classes (falsy values filtered)", () => {
    expect(cn("flex", false && "hidden", null, undefined, "items-center")).toBe(
      "flex items-center",
    );
  });

  test("resolves Tailwind conflicts", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });
});
