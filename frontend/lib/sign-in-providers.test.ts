import { describe, expect, test } from "bun:test";
import {
  draftOf,
  pickLabel,
  pickableProviders,
  providerStatus,
  providerUpdate,
  samlApp,
  secretStatus,
  selectDraft,
  selectValue,
  signInApps,
  switchOn,
  ssoProvidersApi,
  unavailableApps,
  usesEmailCodesOnly,
  type SchoolSsoProvider,
} from "@/lib/sign-in-providers";
import { emailDomainsApi } from "@/lib/email-domains";
import { ssoProviderName } from "@/lib/sso";
import { auditChanges, auditSubject } from "@/lib/sso-audit";

/** Google through the server's app: the school has not saved its own. */
const google: SchoolSsoProvider = {
  key: "google",
  label: "Google",
  kind: "oauth",
  enabled: true,
  available: true,
  configSource: "env",
  needsClient: true,
  clientId: "env-id",
  hasSecret: true,
  secretSource: "env",
  secretUnreadable: false,
  settings: {},
  settingFields: [],
  redirectUri: "https://api.test/api/auth/sso/callback",
  saml: null,
  notes: null,
  updatedAt: null,
};

const own: SchoolSsoProvider = {
  ...google,
  configSource: "school",
  clientId: "school-id",
  secretSource: "school",
  updatedAt: "2026-11-01T00:00:00Z",
};

const microsoft: SchoolSsoProvider = {
  ...google,
  key: "azure",
  label: "Microsoft",
  enabled: false,
  available: false,
  clientId: null,
  hasSecret: false,
  secretSource: null,
};

const saml: SchoolSsoProvider = {
  ...google,
  key: "saml",
  label: "SAML 2.0",
  kind: "saml",
  needsClient: false,
  clientId: null,
  hasSecret: false,
  secretSource: null,
  redirectUri: null,
  saml: { metadataUrl: "m", acsUrl: "a", entityId: "e" },
};

describe("sign-in app rows", () => {
  test("an untouched row sends nothing", () => {
    expect(providerUpdate(google, draftOf(google))).toBeNull();
    expect(providerUpdate(own, draftOf(own))).toBeNull();
  });

  test("the server's values are not copied into the school's form", () => {
    expect(draftOf(google)).toMatchObject({ clientId: "", clientSecret: "", enabled: true });
    expect(draftOf(own)).toMatchObject({ clientId: "school-id" });
  });

  test("saving over the server's app sends the switch too, so it stays on", () => {
    const draft = { ...draftOf(google), clientId: " mine ", clientSecret: " s3cret " };
    expect(providerUpdate(google, draft)).toEqual({
      clientId: "mine",
      clientSecret: "s3cret",
      enabled: true,
    });
  });

  test("the school's own row sends only what changed; clearing the secret sends empty", () => {
    expect(providerUpdate(own, { ...draftOf(own), clientSecret: "new" })).toEqual({ clientSecret: "new" });
    expect(providerUpdate(own, { ...draftOf(own), clearSecret: true })).toEqual({ clientSecret: "" });
    // Nothing of the server's to clear.
    expect(providerUpdate(google, { ...draftOf(google), clearSecret: true })).toBeNull();
    expect(providerUpdate(own, { ...draftOf(own), enabled: false })).toEqual({ enabled: false });
  });

  test("status: Not set up by default", () => {
    expect(providerStatus(microsoft)).toEqual({ label: "Not set up", tone: "off" });
    expect(providerStatus(google).label).toBe("On - server's app");
    expect(providerStatus(own)).toEqual({ label: "On", tone: "ok" });
    expect(providerStatus({ ...own, available: false }).tone).toBe("warn");
    expect(providerStatus({ ...own, available: false, enabled: false }).label).toBe("Off");
  });

  test("secret labels never show a secret", () => {
    expect(secretStatus(google)).toBe("Using the server's app");
    expect(secretStatus(own)).toBe("Saved");
    expect(secretStatus(microsoft)).toBe("Not set");
    expect(secretStatus({ ...own, secretUnreadable: true })).toContain("enter it again");
  });
});

describe("what a school's domains may use", () => {
  const list = [google, microsoft, saml];

  test("only providers available to the school, SAML included", () => {
    expect(pickableProviders(list).map((p) => p.id)).toEqual(["google", "saml"]);
    expect(signInApps(list).map((p) => p.key)).toEqual(["google", "azure"]);
    expect(unavailableApps(list).map((p) => p.key)).toEqual(["azure"]);
  });

  test("a school with nothing set up signs in with email codes", () => {
    expect(usesEmailCodesOnly(list, [{ ssoProvider: null }])).toBe(true);
    expect(usesEmailCodesOnly(list, [{ ssoProvider: "google" }])).toBe(false);
    expect(usesEmailCodesOnly([own, microsoft], [])).toBe(false);
  });

  test("names without a provider list", () => {
    expect(ssoProviderName(undefined, "azure")).toBe("Microsoft");
    expect(ssoProviderName(undefined, "saml")).toBe("SAML");
    expect(ssoProviderName(undefined, "keycloak")).toBe("keycloak");
  });
});

describe("routes", () => {
  test("the active school's by default, one school's from the console", () => {
    expect(emailDomainsApi()).toBe("/schools/email-domains");
    expect(emailDomainsApi("/organisation/schools/abc")).toBe("/organisation/schools/abc/email-domains");
    expect(ssoProvidersApi()).toBe("/schools/current/sso/providers");
    expect(ssoProvidersApi("/organisation/schools/abc")).toBe("/organisation/schools/abc/sso/providers");
  });
});

/** A school's own OpenID Connect provider, set up and on. */
const oidc: SchoolSsoProvider = {
  ...own,
  key: "oidc",
  label: "Custom OpenID Connect",
  buttonLabel: "Riverside ID",
  settings: { displayName: "Riverside ID", issuer: "https://id.riverside.edu" },
  settingFields: [
    { key: "displayName", label: "Button name", description: "" },
    { key: "issuer", label: "Issuer URL", description: "", type: "url" },
    {
      key: "emailClaim",
      label: "Email claim",
      description: "",
      type: "select",
      options: [
        { value: "email", label: "email (verified)" },
        { value: "upn", label: "upn" },
      ],
    },
    { key: "allowPrivateNetwork", label: "Private network", description: "", type: "switch" },
  ],
};

describe("custom OpenID Connect and SAML rows", () => {
  test("OpenID Connect is a sign-in app; SAML is its own read-only row", () => {
    const list = [google, microsoft, oidc, saml];
    expect(signInApps(list).map((p) => p.key)).toEqual(["google", "azure", "oidc"]);
    expect(samlApp(list)?.key).toBe("saml");
    expect(samlApp([google])).toBeNull();
  });

  test("the domain picker offers it once set up, under the school's button name", () => {
    expect(pickableProviders([oidc, saml])).toEqual([
      { id: "oidc", label: "Riverside ID (OpenID Connect)", kind: "oauth" },
      { id: "saml", label: "SAML 2.0", kind: "saml" },
    ]);
    expect(pickableProviders([{ ...oidc, available: false }]).map((p) => p.id)).toEqual([]);
    expect(pickLabel({ ...oidc, settings: {} })).toBe("Custom OpenID Connect");
    expect(pickLabel(google)).toBe("Google");
    expect(ssoProviderName(undefined, "oidc")).toBe("OpenID Connect");
  });

  test("select: the default is shown but saved as empty", () => {
    const field = oidc.settingFields[2];
    expect(selectValue(field, "")).toBe("email");
    expect(selectValue(field, "upn")).toBe("upn");
    expect(selectValue(field, "bogus")).toBe("email");
    expect(selectDraft(field, "email")).toBe("");
    expect(selectDraft(field, "upn")).toBe("upn");
  });

  test("settings changes are sent; a switch turned off clears its setting", () => {
    const draft = draftOf(oidc);
    expect(draft.settings).toEqual({
      displayName: "Riverside ID",
      issuer: "https://id.riverside.edu",
      emailClaim: "",
      allowPrivateNetwork: "",
    });
    expect(providerUpdate(oidc, draft)).toBeNull();
    expect(
      providerUpdate(oidc, {
        ...draft,
        settings: { ...draft.settings, issuer: " https://kc.riverside.edu/realms/s ", emailClaim: "upn" },
      }),
    ).toEqual({ settings: { issuer: "https://kc.riverside.edu/realms/s", emailClaim: "upn" } });
    const on = { ...oidc, settings: { ...oidc.settings, allowPrivateNetwork: "true" } };
    expect(switchOn(draftOf(on).settings.allowPrivateNetwork)).toBe(true);
    expect(
      providerUpdate(on, { ...draftOf(on), settings: { ...draftOf(on).settings, allowPrivateNetwork: "" } }),
    ).toEqual({ settings: { allowPrivateNetwork: null } });
  });

  test("audit entries name the app and its settings", () => {
    const entry = {
      id: "1",
      createdAt: "2026-11-11T00:00:00Z",
      action: "app_changed" as const,
      domain: null,
      actor: null,
      actorVia: "school_admin" as const,
      changes: { app: "oidc", issuer: { before: "https://a.edu", after: "https://b.edu" } },
    };
    expect(auditSubject(entry)).toBe("OpenID Connect app");
    expect(auditChanges(entry)).toEqual(["Issuer: https://a.edu → https://b.edu"]);
  });
});
