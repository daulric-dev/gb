import { describe, expect, test } from "bun:test";
import privacy from "@/data/privacy-policy.json";
import terms from "@/data/terms-of-service.json";
import { contactText, controllerText, fill, locationRetentionText, type PrivacyNotice } from "./notice";

const notice = (over: Partial<PrivacyNotice> = {}): PrivacyNotice => ({
  configured: true,
  missing: [],
  recommended: [],
  organisationName: "Example Org",
  controller: { name: "Example Trust", address: "1 High St", privacyEmail: "privacy@trust.example" },
  dpo: null,
  supervisoryAuthority: { name: "ICO", url: "https://ico.org.uk" },
  dataLocation: "UK",
  lawfulBases: [],
  retention: [{ key: "attendance_location", label: "x", period: "Used for the distance check and cleared within 6 hours; only the distance is kept" }],
  recipients: [],
  features: {},
  updatedAt: null,
  ...over,
});

describe("privacy notice placeholders", () => {
  test("fill uses the organisation's details", () => {
    expect(fill("{{controller}} / {{contact}} / {{locationRetention}}", notice())).toBe(
      "Example Trust / privacy@trust.example / 6 hours",
    );
  });

  test("fallbacks before anything is configured", () => {
    expect(controllerText(null)).toBe("the organisation that runs this GradeBook");
    expect(contactText(null)).toBe("your school office");
    expect(locationRetentionText(null)).toBe("24 hours");
    const n = notice({ controller: { name: null, address: null, privacyEmail: null }, dpo: { name: null, email: "dpo@x.example" } });
    expect(controllerText(n)).toBe("Example Org");
    expect(contactText(n)).toBe("dpo@x.example");
  });

  test("no hard-coded controller contact and no unknown placeholders", () => {
    for (const doc of [privacy, terms]) {
      const text = JSON.stringify(doc);
      expect(text).not.toContain("daulric");
      const placeholders = new Set(text.match(/\{\{\w+\}\}/g) ?? []);
      for (const p of placeholders) {
        expect(["{{controller}}", "{{contact}}", "{{locationRetention}}"]).toContain(p);
      }
    }
  });

  test("every dynamic section is one the view renders", () => {
    const known = ["controller", "lawfulBases", "activities", "recipients", "retention", "cookies", "authority", "location", "contact"];
    for (const doc of [privacy, terms]) {
      for (const s of doc.sections as { dynamic?: string }[]) {
        if (s.dynamic) expect(known).toContain(s.dynamic);
      }
    }
  });
});
