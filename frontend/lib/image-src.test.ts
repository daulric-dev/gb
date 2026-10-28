import { describe, expect, test } from "bun:test";
import { isTrustedImageSrc, trustedImageOrigins, urlOrigin } from "./image-src";

const ORIGINS = ["https://api.example.com", "https://files.example.com"];

describe("isTrustedImageSrc", () => {
  test("relative paths, data: and blob: load inline", () => {
    for (const src of ["/logo.png", "logo.png", "./a/b.png", "?x=1", "data:image/png;base64,AAAA", "blob:https://app/1", "DATA:image/gif;base64,R0"]) {
      expect(isTrustedImageSrc(src, ORIGINS)).toBe(true);
    }
  });

  test("our API and storage origins load inline", () => {
    expect(isTrustedImageSrc("https://api.example.com/api/images/avatars/u.png?t=1", ORIGINS)).toBe(true);
    expect(isTrustedImageSrc("https://files.example.com/bucket/x.png", ORIGINS)).toBe(true);
  });

  test("any other host does not", () => {
    for (const src of [
      "https://tracker.example.net/pixel.gif",
      "http://api.example.com/x.png", // scheme is part of the origin
      "https://api.example.com.evil.net/x.png",
      "https://api.example.com:8443/x.png",
      "//tracker.example.net/pixel.gif",
      "/\\tracker.example.net/pixel.gif",
      " https://tracker.example.net/p.gif",
      "javascript:alert(1)",
      "",
      undefined,
    ]) {
      expect(isTrustedImageSrc(src, ORIGINS)).toBe(false);
    }
  });
});

describe("trustedImageOrigins", () => {
  test("reads the API, storage and image CDN origins, deduplicated", () => {
    const env = process.env as Record<string, string | undefined>;
    const keys = ["NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_STORAGE_URL", "NEXT_PUBLIC_IMAGES_URL"];
    const prev = keys.map((k) => env[k]);
    env.NEXT_PUBLIC_API_URL = "https://api.example.com";
    env.NEXT_PUBLIC_STORAGE_URL = "https://files.example.com/some/path";
    env.NEXT_PUBLIC_IMAGES_URL = "https://api.example.com/";
    try {
      expect(trustedImageOrigins()).toEqual(["https://api.example.com", "https://files.example.com"]);
    } finally {
      keys.forEach((k, i) => (env[k] = prev[i]));
    }
  });

  test("urlOrigin ignores unset and malformed values", () => {
    expect(urlOrigin(undefined)).toBeNull();
    expect(urlOrigin("not a url")).toBeNull();
  });
});
