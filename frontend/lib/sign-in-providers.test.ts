import { describe, expect, test } from "bun:test";
import {
  draftOf,
  pickableProviders,
  providerStatus,
  providerUpdate,
  secretStatus,
  signInApps,
  ssoProvidersApi,
  unavailableApps,
  usesEmailCodesOnly,
  type SchoolSsoProvider,
} from "@/lib/sign-in-providers";
import { emailDomainsApi } from "@/lib/email-domains";
import { ssoProviderName } from "@/lib/sso";

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
