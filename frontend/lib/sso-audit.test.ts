import { describe, expect, test } from "bun:test";
import { auditActor, auditChanges, auditSubject, ssoAuditFilters, type SsoAuditEntry } from "@/lib/sso-audit";

const entry = (over: Partial<SsoAuditEntry> = {}): SsoAuditEntry => ({
  id: "e1",
  createdAt: "2026-11-02T10:00:00.000Z",
  action: "saml_changed",
  domain: "riverside.edu",
  actor: { id: "u1", name: "Ada Lovelace", email: "ada@riverside.edu" },
  actorVia: "school_admin",
  changes: { samlCertificate: { before: "AA:BB", after: "CC:DD" } },
  ...over,
});

describe("sso-audit", () => {
  test("ssoAuditFilters pages by the last entry", () => {
    expect(ssoAuditFilters()).toEqual({ limit: 50 });
    expect(ssoAuditFilters({ before: "e9" })).toEqual({ limit: 50, before: "e9" });
    expect(ssoAuditFilters({ limit: 10 })).toEqual({ limit: 10 });
  });

  test("describes changes, subject and actor", () => {
    expect(auditChanges(entry())).toEqual(["Certificate (SHA-256): AA:BB → CC:DD"]);
    expect(
      auditChanges(entry({ changes: { app: "google", clientSecret: { before: "set", after: "cleared" } } })),
    ).toEqual(["Client secret: set → cleared"]);
    expect(auditSubject(entry({ domain: null, changes: { app: "azure" } }))).toBe("Microsoft app");
    expect(auditActor(entry())).toBe("Ada Lovelace");
    expect(auditActor(entry({ actor: null }))).toBe("System");
  });
});
