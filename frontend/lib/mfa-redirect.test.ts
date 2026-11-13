import { describe, expect, test } from "bun:test";
import { mfaSetupRedirect, TWO_STEP_SETUP_PATH } from "./mfa-redirect";

describe("mfaSetupRedirect", () => {
  test("never redirects from the set-up page or the sign-in pages", () => {
    expect(mfaSetupRedirect("/two-step-setup")).toBeNull();
    expect(mfaSetupRedirect("/two-step-setup", "?next=%2Fdashboard")).toBeNull();
    expect(mfaSetupRedirect("/login")).toBeNull();
    expect(mfaSetupRedirect("/login/two-step")).toBeNull();
    expect(mfaSetupRedirect("/login/verify", "?x=1")).toBeNull();
  });

  test("other pages go to set-up, carrying where they were", () => {
    expect(mfaSetupRedirect("/dashboard/settings", "?tab=a")).toBe(
      `${TWO_STEP_SETUP_PATH}?next=%2Fdashboard%2Fsettings%3Ftab%3Da`,
    );
    expect(mfaSetupRedirect("/")).toBe(TWO_STEP_SETUP_PATH);
  });

  test("look-alike paths are not treated as the set-up page", () => {
    expect(mfaSetupRedirect("/two-step-setupx")).toBe(`${TWO_STEP_SETUP_PATH}?next=%2Ftwo-step-setupx`);
    expect(mfaSetupRedirect("/loginhelp")).toBe(`${TWO_STEP_SETUP_PATH}?next=%2Floginhelp`);
  });
});
