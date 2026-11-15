import { afterEach, describe, expect, test } from "bun:test";
import { ApiError } from "@/lib/api";
import {
  cleanMfaCode,
  routeToTwoStepSetup,
  startTwoStepChallenge,
  takeChallenge,
} from "./mfa-api";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  sessionStorage.clear();
});

describe("two-step sign-in hand-offs", () => {
  test("MFA_REQUIRED keeps the token out of the URL and goes to the code step", () => {
    const pushed: string[] = [];
    const err = new ApiError(403, "…", { code: "MFA_REQUIRED", mfaToken: "tok" });
    expect(startTwoStepChallenge(err, (p) => pushed.push(p), "/dashboard/grades")).toBe(true);
    expect(pushed).toEqual(["/login/two-step?next=%2Fdashboard%2Fgrades"]);
    expect(takeChallenge()).toBe("tok");
    // Read once.
    expect(takeChallenge()).toBeNull();
  });

  test("other errors are left to the caller", () => {
    const pushed: string[] = [];
    expect(startTwoStepChallenge(new ApiError(401, "Invalid"), (p) => pushed.push(p), null)).toBe(false);
    expect(startTwoStepChallenge(new Error("x"), (p) => pushed.push(p), null)).toBe(false);
    expect(pushed).toEqual([]);
  });

  test("an enrolment-limited session goes to set-up", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ enrolmentRequired: true }), { status: 200 })) as unknown as typeof fetch;
    const pushed: string[] = [];
    expect(await routeToTwoStepSetup((p) => pushed.push(p), null)).toBe(true);
    expect(pushed).toEqual(["/two-step-setup"]);

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ enrolmentRequired: false }), { status: 200 })) as unknown as typeof fetch;
    expect(await routeToTwoStepSetup((p) => pushed.push(p), null)).toBe(false);
  });

  test("codes keep digits only, six at most", () => {
    expect(cleanMfaCode("12 34-567")).toBe("123456");
  });
});
