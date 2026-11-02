import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  activeSchoolOf,
  canSwitchSchools,
  loadMySchools,
  managingViaOrganisation,
  mySchools,
  schoolLabel,
  switchActiveSchool,
  type MySchool,
} from "./active-school";

const school = (over: Partial<MySchool> = {}): MySchool => ({
  id: "a",
  name: "Alpha",
  logoUrl: null,
  role: "teacher",
  viaOrganisation: false,
  isActive: false,
  ...over,
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  mySchools.value = null;
});

describe("active school helpers", () => {
  test("a switcher needs more than one school", () => {
    expect(canSwitchSchools(null)).toBe(false);
    expect(canSwitchSchools([school()])).toBe(false);
    expect(canSwitchSchools([school(), school({ id: "b" })])).toBe(true);
  });

  test("finds the active school and whether it is managed via the organisation", () => {
    const list = [
      school(),
      school({ id: "b", role: null, viaOrganisation: true, isActive: true }),
    ];
    expect(activeSchoolOf(list)?.id).toBe("b");
    expect(managingViaOrganisation(list)).toBe(true);
    expect(managingViaOrganisation([school({ isActive: true })])).toBe(false);
    expect(activeSchoolOf([])).toBeNull();
    expect(managingViaOrganisation(undefined)).toBe(false);
  });

  test("a school without a name still has a label", () => {
    expect(schoolLabel({ name: "  " })).toBe("Unnamed school");
    expect(schoolLabel({ name: "Alpha" })).toBe("Alpha");
  });
});

describe("active school API", () => {
  test("switching PUTs the school id", async () => {
    const fetchMock = mock(async () =>
      new Response(JSON.stringify({ id: "u1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await switchActiveSchool("b");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toEndWith("/me/active-school");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ schoolId: "b" });
  });

  test("loading stores the list for the active school, or an empty list on failure", async () => {
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify([school({ isActive: true })]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    await loadMySchools("a");
    expect(mySchools.value).toEqual({ forSchool: "a", list: [school({ isActive: true })] });

    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ message: "down" }), { status: 500 }),
    ) as unknown as typeof fetch;
    await loadMySchools("b");
    expect(mySchools.value).toEqual({ forSchool: "b", list: [] });
  });
});
