import { describe, expect, test } from "bun:test";
import {
  createBody,
  customSecretProblem,
  deliveryFilters,
  deliveryStatusText,
  draftOf,
  draftProblem,
  eventsSummary,
  groupEventTypes,
  groupState,
  headerNameProblem,
  headersBody,
  headersChanged,
  headersProblem,
  headersSummary,
  headerValueProblem,
  integrationAuditActor,
  integrationAuditChanges,
  isInsecureUrl,
  rotateBody,
  toggleEvent,
  toggleGroup,
  urlProblem,
  webhookPatch,
  webhooksApi,
  deliveryHeaders,
  caCertProblem,
  tlsBadge,
  draftProblem,
  payloadMessage,
  payloadSchoolId,
  type EventTypeCatalog,
  type IntegrationAuditEntry,
  type Webhook,
} from "./webhooks";

const catalog: EventTypeCatalog = {
  apiVersion: 1,
  groups: [
    { key: "grades_submissions", label: "Grades & submissions" },
    { key: "attendance", label: "Attendance" },
    { key: "system", label: "System" },
  ],
  eventTypes: [
    { key: "grade.recorded", group: "grades_submissions", label: "Mark", description: "", schema: {}, example: {}, exampleMessage: "" },
    { key: "quiz.completed", group: "grades_submissions", label: "Quiz", description: "", schema: {}, example: {}, exampleMessage: "" },
    { key: "attendance.recorded", group: "attendance", label: "Att", description: "", schema: {}, example: {}, exampleMessage: "" },
    { key: "ping", group: "system", label: "Ping", description: "", schema: {}, example: {}, exampleMessage: "" },
  ],
};

const hook: Webhook = {
  id: "h-1",
  name: "SIS",
  url: "https://sis.example/hook",
  insecure: false,
  events: ["grade.recorded"],
  enabled: true,
  disabledReason: null,
  consecutiveFailures: 0,
  hasSecret: true,
  secretUnreadable: false,
  headers: [],
  tls: { verify: true, caFingerprints: [] },
  createdBy: null,
  createdAt: "",
  updatedAt: "",
  lastDelivery: null,
};

describe("webhooks helpers", () => {
  test("routes for the active school and the organisation console", () => {
    expect(webhooksApi()).toBe("/schools/current/webhooks");
    expect(webhooksApi("/organisation/schools/s-1")).toBe("/organisation/schools/s-1/webhooks");
  });

  test("event types grouped in catalog order, ping left out", () => {
    const groups = groupEventTypes(catalog);
    expect(groups.map((g) => g.key)).toEqual(["grades_submissions", "attendance"]);
    expect(groups[0].types.map((t) => t.key)).toEqual(["grade.recorded", "quiz.completed"]);
  });

  test("group toggles select or clear a whole group and report partial state", () => {
    const keys = ["grade.recorded", "quiz.completed"];
    expect(groupState([], keys)).toBe("none");
    expect(groupState(["quiz.completed"], keys)).toBe("some");
    expect(groupState(keys, keys)).toBe("all");
    expect(toggleGroup(["attendance.recorded", "quiz.completed"], keys, true).sort()).toEqual(
      ["attendance.recorded", ...keys].sort(),
    );
    expect(toggleGroup(["attendance.recorded", ...keys], keys, false)).toEqual(["attendance.recorded"]);
    expect(toggleEvent(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleEvent(["a", "b"], "a", false)).toEqual(["b"]);
    expect(toggleEvent(["a"], "a", true)).toEqual(["a"]);
  });

  test("URLs: syntax only, any http(s) host; plain http is flagged", () => {
    expect(urlProblem("http://10.0.0.5:8080/x")).toBeNull();
    expect(urlProblem("https://localhost/x")).toBeNull();
    expect(urlProblem("")).not.toBeNull();
    expect(urlProblem("ftp://x")).not.toBeNull();
    expect(urlProblem("nope")).not.toBeNull();
    expect(isInsecureUrl(" HTTP://sis.internal")).toBe(true);
    expect(isInsecureUrl("https://sis")).toBe(false);
  });

  test("drafts and the PATCH body hold only what changed", () => {
    expect(draftOf(null)).toEqual({
      name: "", url: "", events: [], enabled: true, headers: [], signingSecret: "", tlsVerify: true, tlsCaCert: "", clearCa: false,
    });
    const d = draftOf(hook);
    expect(webhookPatch(hook, d)).toBeNull();
    expect(webhookPatch(hook, { ...d, events: ["grade.recorded", "quiz.completed"], enabled: false })).toEqual({
      events: ["grade.recorded", "quiz.completed"],
      enabled: false,
    });
    expect(webhookPatch(hook, { ...d, name: " SIS 2 " })).toEqual({ name: "SIS 2" });
    expect(draftProblem({ ...d, events: [] })).toBe("Choose at least one event");
    expect(draftProblem({ ...d, name: " " })).toBe("Give the webhook a name");
    expect(draftProblem(d)).toBeNull();
  });

  test("summaries", () => {
    expect(eventsSummary(["a"], 17)).toBe("1 event");
    expect(eventsSummary(["a", "b"], 17)).toBe("2 events");
    expect(eventsSummary(Array(17).fill("x"), 17)).toBe("All 17 events");
    expect(deliveryStatusText({ status: "pending", attempts: 2, maxAttempts: 8 })).toContain("2 of 8");
    expect(deliveryStatusText({ status: "abandoned", attempts: 8, maxAttempts: 8 })).toBe("Gave up after 8 attempts");
    expect(deliveryStatusText({ status: "succeeded", attempts: 1, maxAttempts: 8 })).toBe("Delivered");
  });

  test("deliveries QUERY body holds only the filters in use", () => {
    expect(deliveryFilters()).toEqual({ limit: 50 });
    expect(deliveryFilters({ status: "", eventType: "" })).toEqual({ limit: 50 });
    expect(deliveryFilters({ status: "failed", eventType: "grade.recorded", before: "d-9" })).toEqual({
      limit: 50,
      status: "failed",
      eventType: "grade.recorded",
      before: "d-9",
    });
  });

  test("activity rows", () => {
    const e: IntegrationAuditEntry = {
      id: "a",
      createdAt: "",
      action: "webhook_updated",
      webhookId: "h-1",
      webhook: "SIS",
      actor: null,
      actorVia: "system",
      changes: { url: { before: "http://a", after: "https://b" }, events: { before: ["x"], after: ["x", "y"] }, note: 1 },
    };
    expect(integrationAuditChanges(e)).toEqual(["URL: http://a → https://b", "Events: 1 event → 2 events"]);
    expect(integrationAuditActor(e)).toBe("GradeBook");
    expect(integrationAuditActor({ ...e, actorVia: "school_admin", actor: { id: "u", name: null, email: "a@b" } })).toBe("a@b");
  });

  test("header names and values follow the API's rules", () => {
    expect(headerNameProblem("Authorization")).toBeNull();
    expect(headerNameProblem("X-API-Key")).toBeNull();
    for (const bad of ["", "X API", "X_Key", "a".repeat(101)]) expect(headerNameProblem(bad)).not.toBeNull();
    for (const reserved of ["Content-Type", "host", "User-Agent", "Transfer-Encoding", "connection", "Content-Length", "X-GradeBook-Event"]) {
      expect(headerNameProblem(reserved)).toContain("can't be replaced");
    }
    expect(headerValueProblem("X", "Bearer abc")).toBeNull();
    expect(headerValueProblem("X", "")).not.toBeNull();
    expect(headerValueProblem("X", "a\r\nb")).toContain("line breaks");
    expect(headerValueProblem("X", "a".repeat(4097))).not.toBeNull();
  });

  test("headers editor: new rows need a value, saved rows keep theirs when blank, names unique ignoring case", () => {
    expect(headersProblem([{ key: "n", name: "X-Key", value: "" }])).toBe("Enter a value for X-Key");
    expect(headersProblem([{ key: "s", id: "h1", name: "X-Key", value: "" }])).toBeNull();
    expect(
      headersProblem([
        { key: "a", name: "X-Key", value: "1" },
        { key: "b", name: "x-key", value: "2" },
      ]),
    ).toBe("x-key is listed twice");
    expect(headersProblem(Array.from({ length: 21 }, (_, i) => ({ key: `${i}`, name: `X-${i}`, value: "v" })))).toContain("at most 20");
  });

  test("headers body: saved by id (value only when replaced), new with a value; changes detected", () => {
    const saved = [{ id: "h1", name: "Authorization", hasValue: true as const, valueUnreadable: false }];
    const w = { ...hook, headers: saved };
    const d = draftOf(w);
    expect(d.headers).toEqual([{ key: "h1", id: "h1", name: "Authorization", value: "" }]);
    expect(headersChanged(saved, d.headers)).toBe(false);
    expect(webhookPatch(w, d)).toBeNull();
    const rows = [
      { key: "h1", id: "h1", name: " Authorization ", value: "" },
      { key: "n1", name: "X-API-Key", value: "k" },
    ];
    expect(headersBody(rows)).toEqual([{ id: "h1", name: "Authorization" }, { name: "X-API-Key", value: "k" }]);
    expect(webhookPatch(w, { ...d, headers: rows })).toEqual({ headers: headersBody(rows) });
    // Replaced value, rename and removal all count as changes.
    expect(headersChanged(saved, [{ key: "h1", id: "h1", name: "Authorization", value: "new" }])).toBe(true);
    expect(headersChanged(saved, [{ key: "h1", id: "h1", name: "X-Auth", value: "" }])).toBe(true);
    expect(webhookPatch(w, { ...d, headers: [] })).toEqual({ headers: [] });
  });

  test("create body: headers and an own signing secret only when given", () => {
    const d = { ...draftOf(null), name: " SIS ", url: " https://a.b ", events: ["grade.recorded"] };
    expect(createBody(d)).toEqual({ name: "SIS", url: "https://a.b", events: ["grade.recorded"], enabled: true });
    expect(createBody({ ...d, headers: [{ key: "n", name: "X-Key", value: "v" }], signingSecret: "s".repeat(16) })).toMatchObject({
      headers: [{ name: "X-Key", value: "v" }],
      signingSecret: "s".repeat(16),
    });
    expect(draftProblem({ ...d, signingSecret: "short" })).toContain("16-256");
    expect(draftProblem({ ...d, headers: [{ key: "n", name: "Host", value: "x" }] })).toContain("can't be replaced");
  });

  test("own signing secret rules and rotate body", () => {
    expect(customSecretProblem("a".repeat(16))).toBeNull();
    expect(customSecretProblem("a".repeat(15))).not.toBeNull();
    expect(customSecretProblem("a".repeat(257))).not.toBeNull();
    expect(customSecretProblem(" " + "a".repeat(20))).toContain("space");
    expect(customSecretProblem("é".repeat(20))).toContain("printable");
    expect(rotateBody("")).toEqual({});
    expect(rotateBody("x".repeat(20))).toEqual({ signingSecret: "x".repeat(20) });
  });

  test("header badge and header activity rows (names only)", () => {
    expect(headersSummary([])).toBeNull();
    expect(headersSummary([1])).toBe("1 header");
    expect(headersSummary([1, 2])).toBe("2 headers");
    const e: IntegrationAuditEntry = {
      id: "a",
      createdAt: "",
      action: "webhook_updated",
      webhookId: "h-1",
      webhook: "SIS",
      actor: null,
      actorVia: "school_admin",
      changes: {
        headers: { added: ["X-Tenant"], removed: ["X-Old"], renamed: [{ before: "X-A", after: "X-B" }], valueChanged: ["Authorization"] },
      },
    };
    expect(integrationAuditChanges(e)).toEqual([
      "Header added: X-Tenant",
      "Header removed: X-Old",
      "Header renamed: X-A → X-B",
      "Header value changed: Authorization",
    ]);
    expect(integrationAuditChanges({ ...e, action: "secret_rotated", changes: { customSigningSecret: true } })).toEqual([
      "Own signing secret used",
    ]);
  });
});

describe("delivery payloads", () => {
  const SCHOOL = "11111111-1111-4111-8111-111111111111";
  const payload = {
    event_type: "grade.recorded",
    message: "Ada Lovelace received 18/20 for Essay in Maths",
    data: { school: { id: SCHOOL, name: "Riverside" } },
  };

  test("message and school id come from the three-key body; old-shape payloads have no message", () => {
    expect(payloadMessage(payload)).toBe("Ada Lovelace received 18/20 for Essay in Maths");
    expect(payloadSchoolId(payload)).toBe(SCHOOL);
    expect(payloadMessage({ id: "e", type: "grade.recorded", data: {} })).toBeNull();
    expect(payloadMessage(null)).toBeNull();
    expect(payloadSchoolId({ data: {} })).toBeNull();
  });

  test("the GradeBook headers shown for a delivery", () => {
    const d = { id: "d-1", eventId: "e-1", eventType: "grade.recorded" };
    expect(deliveryHeaders(d, SCHOOL)).toEqual([
      ["X-GradeBook-Event", "grade.recorded"],
      ["X-GradeBook-Event-Id", "e-1"],
      ["X-GradeBook-School-Id", SCHOOL],
      ["X-GradeBook-Api-Version", "1"],
      ["X-GradeBook-Delivery", "d-1"],
    ]);
    expect(deliveryHeaders(d, null).map(([n]) => n)).not.toContain("X-GradeBook-School-Id");
  });
});

describe("TLS settings", () => {
  const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";

  test("on by default; the create body only carries tls when it differs", () => {
    const d = draftOf(null);
    expect(d.tlsVerify).toBe(true);
    const base = { ...d, name: "SIS", url: "https://sis.example/x", events: ["grade.recorded"] };
    expect(createBody(base).tls).toBeUndefined();
    expect(createBody({ ...base, tlsVerify: false }).tls).toEqual({ verify: false });
    expect(createBody({ ...base, tlsCaCert: ` ${PEM} ` }).tls).toEqual({ verify: true, caCert: PEM });
  });

  test("the patch: verify toggled, a new CA, clearing the saved one; nothing when unchanged", () => {
    expect(webhookPatch(hook, draftOf(hook))).toBeNull();
    expect(webhookPatch(hook, { ...draftOf(hook), tlsVerify: false })).toEqual({ tls: { verify: false } });
    expect(webhookPatch(hook, { ...draftOf(hook), tlsCaCert: PEM })).toEqual({ tls: { caCert: PEM } });
    const withCa: Webhook = { ...hook, tls: { verify: true, caFingerprints: ["AB:CD"] } };
    expect(webhookPatch(withCa, { ...draftOf(withCa), clearCa: true })).toEqual({ tls: { caCert: "" } });
    expect(webhookPatch(hook, { ...draftOf(hook), clearCa: true })).toBeNull();
  });

  test("CA bundle check: blank or certificates only", () => {
    expect(caCertProblem("")).toBeNull();
    expect(caCertProblem(`${PEM}\n${PEM}`)).toBeNull();
    expect(caCertProblem("hello")).toContain("PEM");
    expect(caCertProblem(`${PEM}\nextra`)).toContain("PEM");
    expect(caCertProblem(`${PEM}\n-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----`)).toContain("private key");
    expect(caCertProblem(PEM.repeat(3000))).toContain("64 KB");
    expect(draftProblem({ ...draftOf(hook), tlsCaCert: "nope" })).toContain("PEM");
  });

  test("the list badge shows only for https with verification off", () => {
    expect(tlsBadge(hook)).toBeNull();
    expect(tlsBadge({ ...hook, tls: { verify: false, caFingerprints: [] } })).toBe("TLS not verified");
    expect(tlsBadge({ url: "http://10.0.0.5/x", tls: { verify: false, caFingerprints: [] } })).toBeNull();
  });

  test("audit lines for TLS changes show fingerprints, never PEM", () => {
    const e: IntegrationAuditEntry = {
      id: "a", createdAt: "", action: "tls_ca_changed", webhookId: "h-1", webhook: "SIS", actor: null, actorVia: "school_admin",
      changes: { caFingerprints: { before: [], after: ["AB:CD:EF:01:23"] } },
    };
    expect(integrationAuditChanges(e)).toEqual(["Trusted CA: none → 1 certificate (AB:CD:EF…)"]);
    expect(
      integrationAuditChanges({ ...e, action: "tls_verification_disabled", changes: { verifyTls: { before: true, after: false } } }),
    ).toEqual(["Verify TLS: on → off"]);
  });
});
