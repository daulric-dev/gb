import { describe, expect, test } from "bun:test";
import { normalizeServerUrl } from "./server-url";

describe("normalizeServerUrl", () => {
  test("adds HTTPS to a school hostname and removes a trailing slash", () => {
    expect(normalizeServerUrl("school.example.com/")).toBe(
      "https://school.example.com",
    );
  });

  test("accepts a URL ending in the API path but stores the instance root", () => {
    expect(normalizeServerUrl("https://school.example.com/api")).toBe(
      "https://school.example.com",
    );
  });

  test("rejects insecure public URLs", () => {
    expect(() => normalizeServerUrl("http://school.example.com")).toThrow(
      "HTTPS",
    );
  });

  test("allows local HTTP development servers", () => {
    expect(normalizeServerUrl("http://192.168.1.20:3001", true)).toBe(
      "http://192.168.1.20:3001",
    );
  });

  test("rejects credentials, query strings, and non-API paths", () => {
    expect(() =>
      normalizeServerUrl("https://user:pass@school.example.com"),
    ).toThrow("username or password");
    expect(() =>
      normalizeServerUrl("https://school.example.com?tenant=1"),
    ).toThrow("query or fragment");
    expect(() =>
      normalizeServerUrl("https://school.example.com/platform"),
    ).toThrow("base URL");
  });
});
