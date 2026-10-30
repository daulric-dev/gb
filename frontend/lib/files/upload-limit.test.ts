import { describe, test, expect } from "bun:test";
import {
  formatLimitMb,
  formatMb,
  uploadLimitStops,
  uploadSizeError,
} from "@/lib/files/upload-limit";

const MB = 1024 * 1024;

describe("uploadSizeError", () => {
  test("names the school's limit", () => {
    expect(uploadSizeError(10 * MB + 1, 10 * MB)).toBe("File must be 10MB or smaller");
  });
  test("a file at the limit fits", () => {
    expect(uploadSizeError(100 * MB, 100 * MB)).toBeNull();
  });
  test("no limit loaded means no pre-check", () => {
    expect(uploadSizeError(500 * MB, null)).toBeNull();
  });
});

describe("formatMb", () => {
  test("whole MB", () => {
    expect(formatMb(25 * MB)).toBe("25MB");
  });
});

describe("uploadLimitStops", () => {
  test("snaps up to 1 GB", () => {
    expect(uploadLimitStops(1024)).toEqual([1, 5, 10, 25, 50, 100, 250, 500, 750, 1024]);
  });

  test("stops at a lower platform ceiling, which stays reachable", () => {
    expect(uploadLimitStops(300)).toEqual([1, 5, 10, 25, 50, 100, 250, 300]);
  });

  test("keeps the school's current value", () => {
    expect(uploadLimitStops(1024, 64)).toContain(64);
    expect(uploadLimitStops(100, 500)).not.toContain(500);
  });
});

describe("formatLimitMb", () => {
  test("shows whole gigabytes as GB", () => {
    expect(formatLimitMb(100)).toBe("100 MB");
    expect(formatLimitMb(1024)).toBe("1 GB");
  });
});
