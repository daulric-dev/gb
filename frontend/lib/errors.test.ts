import { describe, expect, test } from "bun:test";
import { ApiError } from "@/lib/api";
import {
  FriendlyError,
  GENERIC_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  RATE_LIMIT_MESSAGE,
  safeText,
  userMessage,
} from "@/lib/errors";
import { UploadError } from "@/lib/files/upload";

const FALLBACK = "Failed to save";

describe("userMessage", () => {
  test("a 4xx keeps the API's message", () => {
    expect(userMessage(new ApiError(400, "Name is required"), FALLBACK)).toBe(
      "Name is required",
    );
    expect(
      userMessage(
        new ApiError(403, "Turned off", { code: "FEATURE_DISABLED", message: "Turned off" }),
        FALLBACK,
      ),
    ).toBe("Turned off");
  });

  test("validation lists show their first message", () => {
    const err = new ApiError(400, "a,b", { message: ["name must be a string", "b"] });
    expect(userMessage(err, FALLBACK)).toBe("name must be a string");
  });

  test("stack-like text is rejected", () => {
    const stack =
      "Cannot read properties of undefined\n    at Foo.bar (/app/src/foo.ts:12:3)\n    at async x";
    expect(userMessage(new ApiError(400, stack), FALLBACK)).toBe(FALLBACK);
    expect(userMessage(new ApiError(400, "at Object.run (index.js:1:2)"), FALLBACK)).toBe(
      FALLBACK,
    );
    expect(userMessage(new ApiError(400, "TypeError: x is not a function"), FALLBACK)).toBe(
      FALLBACK,
    );
  });

  test("Prisma and SQL text is rejected", () => {
    for (const text of [
      "Invalid `prisma.user.findUnique()` invocation: something",
      "prisma.course.update failed",
      'duplicate key value violates unique constraint "x_pkey"',
      "SQLSTATE 23505",
      "connect ECONNREFUSED 127.0.0.1:5432",
    ]) {
      expect(userMessage(new ApiError(409, text), FALLBACK)).toBe(FALLBACK);
    }
  });

  test("HTML error pages and JSON parse errors are rejected", () => {
    expect(userMessage(new ApiError(404, "<!DOCTYPE html><html>…"), FALLBACK)).toBe(FALLBACK);
    expect(userMessage(new ApiError(400, "Unexpected token < in JSON"), FALLBACK)).toBe(
      FALLBACK,
    );
    expect(userMessage(new ApiError(404, "Cannot GET /api/nope"), FALLBACK)).toBe(FALLBACK);
  });

  test("a 5xx is the generic message, with the error id as a reference", () => {
    expect(userMessage(new ApiError(500, "Invalid `prisma.x()`"), FALLBACK)).toBe(
      GENERIC_ERROR_MESSAGE,
    );
    const err = new ApiError(500, GENERIC_ERROR_MESSAGE, {
      statusCode: 500,
      message: GENERIC_ERROR_MESSAGE,
      errorId: "a1b2c3d4",
    });
    expect(userMessage(err, FALLBACK)).toBe(`${GENERIC_ERROR_MESSAGE} Reference: a1b2c3d4`);
    expect(
      userMessage(new ApiError(503, "x", { errorId: "<script>" }), FALLBACK),
    ).toBe(GENERIC_ERROR_MESSAGE);
  });

  test("no response is the network message", () => {
    expect(userMessage(new ApiError(0, "whatever"), FALLBACK)).toBe(NETWORK_ERROR_MESSAGE);
    expect(userMessage(new TypeError("Failed to fetch"), FALLBACK)).toBe(NETWORK_ERROR_MESSAGE);
    expect(userMessage(new TypeError("Load failed"), FALLBACK)).toBe(NETWORK_ERROR_MESSAGE);
  });

  test("a 429 without a usable message gets the rate-limit message", () => {
    expect(
      userMessage(new ApiError(429, "ThrottlerException: Too Many Requests"), FALLBACK),
    ).toBe(RATE_LIMIT_MESSAGE);
    expect(userMessage(new ApiError(429, "Wait a minute"), FALLBACK)).toBe("Wait a minute");
  });

  test("long messages are cut to one short line", () => {
    const out = userMessage(new ApiError(400, `Too   long\n${"x".repeat(400)}`), FALLBACK);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).not.toContain("\n");
    expect(out.startsWith("Too long x")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });

  test("other errors never show their message", () => {
    expect(userMessage(new Error("secret internals"), FALLBACK)).toBe(FALLBACK);
    expect(userMessage(new TypeError("x is undefined"), FALLBACK)).toBe(FALLBACK);
    expect(userMessage("raw string", FALLBACK)).toBe(FALLBACK);
    expect(userMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });

  test("errors written for the user are shown", () => {
    expect(userMessage(new FriendlyError("Location access was blocked."), FALLBACK)).toBe(
      "Location access was blocked.",
    );
    expect(userMessage(new UploadError("Upload cancelled", 0), FALLBACK)).toBe(
      "Upload cancelled",
    );
  });
});

describe("safeText", () => {
  test("keeps plain text, drops non-strings and blanks", () => {
    expect(safeText("  Hello  there ")).toBe("Hello there");
    expect(safeText("")).toBeNull();
    expect(safeText(42)).toBeNull();
  });

  test("rejects multi-line dumps", () => {
    expect(safeText("a\nb\nc\nd")).toBeNull();
  });
});
