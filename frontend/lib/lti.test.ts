import { describe, expect, test } from "bun:test";
import { ApiError } from "./api";
import {
  deploymentLabel,
  formatCustomParams,
  launchErrorMessage,
  ltiItemBody,
  ltiLaunchPath,
  ltiToolApi,
  parseCustomParams,
  parseLines,
  safeLaunchUrl,
  toolCreateBody,
  toolDraftOf,
  toolDraftProblem,
  toolPatch,
  toolUrlProblem,
  type LtiTool,
  type ToolDraft,
} from "./lti";

const tool: LtiTool = {
  id: "t-1",
  name: "Quizzes",
  description: null,
  clientId: "gb-abc",
  loginUrl: "https://tool.test/login",
  targetLinkUri: "https://tool.test/launch",
  redirectUris: ["https://tool.test/launch"],
  jwksUrl: "https://tool.test/jwks",
  publicKeyPem: null,
  agsEnabled: false,
  sendName: false,
  sendEmail: false,
  customParams: { a: "1" },
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deployments: [{ id: "d-1", deploymentId: "gbd-1", schoolId: null, schoolName: null }],
  linkCount: 0,
};

function validDraft(patch: Partial<ToolDraft> = {}): ToolDraft {
  return { ...toolDraftOf(tool), ...patch };
}

describe("lines and custom parameters", () => {
  test("parseLines trims and drops blanks", () => {
    expect(parseLines(" a \n\n b\r\n")).toEqual(["a", "b"]);
  });

  test("parseCustomParams reads name=value lines", () => {
    expect(parseCustomParams("a=1\n b = x=y \n\n")).toEqual({
      params: { a: "1", b: "x=y" },
      problem: null,
    });
  });

  test("parseCustomParams rejects bad lines and names", () => {
    expect(parseCustomParams("nope").problem).toContain("name=value");
    expect(parseCustomParams("bad-key=1").problem).toContain("letters, digits and _");
    expect(parseCustomParams(`a=${"x".repeat(1025)}`).problem).toContain("1024");
    const many = Array.from({ length: 51 }, (_, i) => `k${i}=v`).join("\n");
    expect(parseCustomParams(many).problem).toContain("50");
  });

  test("formatCustomParams round-trips", () => {
    const text = formatCustomParams({ a: "1", b: "2" });
    expect(text).toBe("a=1\nb=2");
    expect(parseCustomParams(text).params).toEqual({ a: "1", b: "2" });
    expect(formatCustomParams(null)).toBe("");
  });
});

describe("toolUrlProblem", () => {
  test("accepts http(s), rejects the rest", () => {
    expect(toolUrlProblem("https://x.test/a", "URL")).toBeNull();
    expect(toolUrlProblem("x.test", "URL")).toContain("full address");
    expect(toolUrlProblem("ftp://x.test", "URL")).toContain("https");
    expect(toolUrlProblem("https://u:p@x.test", "URL")).toContain("password");
    expect(toolUrlProblem("https://x.test/#a", "URL")).toContain("fragment");
  });
});

describe("tool drafts", () => {
  test("a new draft needs a name first", () => {
    expect(toolDraftProblem(toolDraftOf(null))).toBe("Give the tool a name");
  });

  test("an existing tool's draft is valid", () => {
    expect(toolDraftProblem(validDraft())).toBeNull();
  });

  test("checks redirects, keys and schools", () => {
    expect(toolDraftProblem(validDraft({ redirectUris: "" }))).toContain("redirect");
    expect(toolDraftProblem(validDraft({ keyMode: "pem", publicKeyPem: "x" }))).toContain("PEM");
    expect(toolDraftProblem(validDraft({ allSchools: false }))).toContain("school");
    expect(toolDraftProblem(validDraft({ customParams: "x" }))).toContain("name=value");
  });

  test("create body", () => {
    const body = toolCreateBody(
      validDraft({ description: "  ", allSchools: false, schoolIds: ["s1", "s1", "s2"] }),
    );
    expect(body).toEqual({
      name: "Quizzes",
      loginUrl: "https://tool.test/login",
      targetLinkUri: "https://tool.test/launch",
      redirectUris: ["https://tool.test/launch"],
      agsEnabled: false,
      sendName: false,
      sendEmail: false,
      enabled: true,
      customParams: { a: "1" },
      jwksUrl: "https://tool.test/jwks",
      schoolIds: ["s1", "s2"],
    });
    expect(toolCreateBody(validDraft()).schoolIds).toBeUndefined();
  });

  test("patch sends only changes", () => {
    expect(toolPatch(tool, validDraft())).toBeNull();
    expect(toolPatch(tool, validDraft({ sendEmail: true, customParams: "a=1\nb=2" }))).toEqual({
      sendEmail: true,
      customParams: { a: "1", b: "2" },
    });
    expect(toolPatch(tool, validDraft({ description: "Hi" }))).toEqual({ description: "Hi" });
  });

  test("switching to a PEM clears the JWKS URL", () => {
    const pem = "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----";
    expect(toolPatch(tool, validDraft({ keyMode: "pem", publicKeyPem: pem }))).toEqual({
      publicKeyPem: pem,
      jwksUrl: null,
    });
  });
});

describe("course items and launches", () => {
  test("ltiItemBody", () => {
    expect(ltiItemBody({ toolId: "", title: "x", customParams: "", points: "", agsEnabled: false }).problem).toBe(
      "Choose a tool",
    );
    expect(ltiItemBody({ toolId: "t", title: " ", customParams: "", points: "", agsEnabled: false }).problem).toContain(
      "title",
    );
    expect(
      ltiItemBody({ toolId: "t", title: " A ", customParams: "k=v", points: "10", agsEnabled: true }).body,
    ).toEqual({ toolId: "t", title: "A", customParams: { k: "v" }, points: 10 });
    // Points are ignored for tools without grade passback.
    expect(
      ltiItemBody({ toolId: "t", title: "A", customParams: "", points: "10", agsEnabled: false }).body,
    ).toEqual({ toolId: "t", title: "A" });
    expect(
      ltiItemBody({ toolId: "t", title: "A", customParams: "", points: "0", agsEnabled: true }).problem,
    ).toContain("between");
  });

  test("paths", () => {
    expect(ltiToolApi("a/b")).toBe("/organisation/lti/tools/a%2Fb");
    expect(ltiLaunchPath("c", "i")).toBe("/lti/launch?course=c&item=i");
  });

  test("safeLaunchUrl only allows http(s)", () => {
    expect(safeLaunchUrl("https://tool.test/login?x=1")).toBe("https://tool.test/login?x=1");
    expect(safeLaunchUrl("javascript:alert(1)")).toBeNull();
    expect(safeLaunchUrl(42)).toBeNull();
  });

  test("launchErrorMessage", () => {
    expect(launchErrorMessage(new ApiError(403, "x", { code: "FEATURE_DISABLED" }))).toContain("turned off");
    expect(launchErrorMessage(new ApiError(404, "x"))).toContain("no longer available");
    expect(launchErrorMessage(new Error("boom"))).toContain("could not be opened");
  });

  test("deploymentLabel", () => {
    expect(deploymentLabel(tool.deployments[0])).toBe("Every school");
    expect(deploymentLabel({ id: "d", deploymentId: "x", schoolId: "s", schoolName: "Hill" })).toBe("Hill");
  });
});
