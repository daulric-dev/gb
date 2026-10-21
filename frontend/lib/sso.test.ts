import { describe, expect, test } from "bun:test";
import { buildUrl } from "@/lib/api";
import {
  isSsoRequiredMessage,
  ssoErrorMessage,
  ssoProviderName,
  ssoStartUrl,
} from "@/lib/sso";

describe("ssoStartUrl", () => {
  test("points at the API start route with email and next", () => {
    expect(ssoStartUrl("google", { email: " a@b.edu ", next: "/portal?x=1" })).toBe(
      buildUrl("/auth/sso/google/start?email=a%40b.edu&next=%2Fportal%3Fx%3D1"),
    );
  });

  test("omits empty parameters", () => {
    expect(ssoStartUrl("azure")).toBe(buildUrl("/auth/sso/azure/start"));
    expect(ssoStartUrl("saml", { email: "", next: null })).toBe(
      buildUrl("/auth/sso/saml/start"),
    );
  });
});

describe("ssoErrorMessage", () => {
  test("maps reason codes", () => {
    expect(ssoErrorMessage("cancelled")).toContain("cancelled");
    expect(ssoErrorMessage("expired")).toContain("expired");
    expect(ssoErrorMessage("provider")).toContain("provider");
    expect(ssoErrorMessage("failed")).toContain("went wrong");
  });

  test("passes sentences through", () => {
    const msg = 'Your school signs in with Google. Use "Continue with Google".';
    expect(ssoErrorMessage(msg)).toBe(msg);
  });

  test("hides unknown bare codes and ignores empty", () => {
    expect(ssoErrorMessage("server_error")).toBe(
      "We couldn't sign you in. Please try again.",
    );
    expect(ssoErrorMessage(null)).toBeNull();
    expect(ssoErrorMessage("  ")).toBeNull();
  });
});

test("isSsoRequiredMessage", () => {
  expect(isSsoRequiredMessage("Your school signs in with Microsoft.")).toBe(true);
  expect(isSsoRequiredMessage("Too many requests")).toBe(false);
});

test("ssoProviderName", () => {
  expect(ssoProviderName({ id: "google", label: "Google", kind: "oauth" }, "google")).toBe(
    "Google",
  );
  expect(
    ssoProviderName({ id: "saml", label: "your school (SSO)", kind: "saml" }, "saml"),
  ).toBe("SAML");
  expect(ssoProviderName(undefined, "okta")).toBe("okta");
});
