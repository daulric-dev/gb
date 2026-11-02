import { describe, expect, test } from "bun:test";
import {
  deliveryFilters,
  deliveryStatusText,
  draftOf,
  draftProblem,
  eventsSummary,
  groupEventTypes,
  groupState,
  integrationAuditActor,
  integrationAuditChanges,
  isInsecureUrl,
  toggleEvent,
  toggleGroup,
  urlProblem,
  webhookPatch,
  webhooksApi,
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
    { key: "grade.recorded", group: "grades_submissions", label: "Mark", description: "", schema: {}, example: {} },
    { key: "quiz.completed", group: "grades_submissions", label: "Quiz", description: "", schema: {}, example: {} },
    { key: "attendance.recorded", group: "attendance", label: "Att", description: "", schema: {}, example: {} },
    { key: "ping", group: "system", label: "Ping", description: "", schema: {}, example: {} },
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
    expect(draftOf(null)).toEqual({ name: "", url: "", events: [], enabled: true });
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
});
