import { afterEach, describe, expect, test } from "bun:test";
import { GET } from "./route";

const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

describe("GET /.well-known/gradebook.json", () => {
  test("publishes the configured public backend origin", async () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_API_URL = "https://api.school.example.com/";

    const response = GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      apiUrl: "https://api.school.example.com",
    });
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
  });

  test("returns an explicit error when the backend URL is unset", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;

    const response = GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "instance_not_configured",
    });
  });

  test("rejects insecure public backend URLs", () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_API_URL = "http://api.school.example.com";

    expect(() => GET()).toThrow("must use HTTPS");
  });

  test("allows localhost during a production build", async () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_API_URL = "http://localhost:3001";

    const response = GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      apiUrl: "http://localhost:3001",
    });
  });

  test("rejects insecure .local backend URLs in production", () => {
    process.env.NODE_ENV = "production";
    process.env.NEXT_PUBLIC_API_URL = "http://school.local";

    expect(() => GET()).toThrow("must use HTTPS");
  });
});
