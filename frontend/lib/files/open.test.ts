import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  isInlineSafeType,
  openOrDownloadFile,
  retypeForOpen,
  safeExternalUrl,
  sanitizeLinks,
} from "./open";

const registeredDomHere = !GlobalRegistrator.isRegistered;
if (registeredDomHere) GlobalRegistrator.register();

afterAll(async () => {
  if (registeredDomHere) await GlobalRegistrator.unregister();
});

describe("isInlineSafeType", () => {
  test("PDFs and plain raster images open inline", () => {
    for (const t of ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "IMAGE/PNG; charset=binary"]) {
      expect(isInlineSafeType(t)).toBe(true);
    }
  });

  test("anything that can run script does not", () => {
    for (const t of ["text/html", "image/svg+xml", "application/xhtml+xml", "text/xml", "application/octet-stream", "", null, undefined]) {
      expect(isInlineSafeType(t)).toBe(false);
    }
  });
});

describe("retypeForOpen", () => {
  test("pins safe types and neuters the rest", () => {
    const pdf = retypeForOpen(new Blob(["%PDF"], { type: "application/pdf" }));
    expect(pdf).toMatchObject({ inline: true });
    expect(pdf.blob.type).toBe("application/pdf");

    const html = retypeForOpen(new Blob(["<script>"], { type: "text/html" }));
    expect(html.inline).toBe(false);
    expect(html.blob.type).toBe("application/octet-stream");

    const svg = retypeForOpen(new Blob(["<svg>"], { type: "image/svg+xml" }));
    expect(svg.inline).toBe(false);
    expect(svg.blob.type).toBe("application/octet-stream");
  });
});

describe("openOrDownloadFile", () => {
  const realOpen = window.open;
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;

  afterEach(() => {
    window.open = realOpen;
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  });

  function fakeWindow() {
    const win = { close: mock(() => {}), location: { href: "" } };
    window.open = mock(() => win as unknown as Window) as typeof window.open;
    const created: Blob[] = [];
    URL.createObjectURL = mock((b: Blob) => {
      created.push(b);
      return "blob:test/1";
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = mock(() => {}) as typeof URL.revokeObjectURL;
    return { win, created };
  }

  test("an image opens in the new tab", async () => {
    const { win, created } = fakeWindow();
    await openOrDownloadFile(async () => new Blob(["x"], { type: "image/png" }), "a.png");
    expect(win.location.href).toBe("blob:test/1");
    expect(win.close).not.toHaveBeenCalled();
    expect(created[0].type).toBe("image/png");
  });

  test("HTML is downloaded as octet-stream and the tab closed", async () => {
    const { win, created } = fakeWindow();
    await openOrDownloadFile(async () => new Blob(["<b>"], { type: "text/html" }), "a.html");
    expect(win.close).toHaveBeenCalled();
    expect(win.location.href).toBe("");
    expect(created[0].type).toBe("application/octet-stream");
  });

  test("a failed load closes the tab and rejects", async () => {
    const { win } = fakeWindow();
    await expect(
      openOrDownloadFile(async () => {
        throw new Error("gone");
      }, "a.pdf"),
    ).rejects.toThrow("gone");
    expect(win.close).toHaveBeenCalled();
  });
});

describe("safeExternalUrl", () => {
  test("keeps http(s) URLs", () => {
    expect(safeExternalUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeExternalUrl(" http://example.com ")).toBe("http://example.com");
  });

  test("drops everything else", () => {
    for (const u of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,<b>", "vbscript:x", "/relative", "example.com", "", null, undefined]) {
      expect(safeExternalUrl(u)).toBeNull();
    }
  });
});

describe("sanitizeLinks", () => {
  test("removes unsafe hrefs and hardens external links", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <a id="js" href="javascript:alert(1)">x</a>
      <a id="data" href="data:text/html,hi">x</a>
      <a id="rel" href="#bookmark">x</a>
      <a id="web" href="https://example.com">x</a>
      <a id="mail" href="mailto:a@example.com">x</a>`;
    sanitizeLinks(root);
    const get = (id: string) => root.querySelector(`#${id}`)!;
    expect(get("js").hasAttribute("href")).toBe(false);
    expect(get("data").hasAttribute("href")).toBe(false);
    expect(get("rel").hasAttribute("href")).toBe(false);
    expect(get("web").getAttribute("href")).toBe("https://example.com");
    expect(get("web").getAttribute("rel")).toBe("noopener noreferrer");
    expect(get("web").getAttribute("target")).toBe("_blank");
    expect(get("mail").getAttribute("href")).toBe("mailto:a@example.com");
  });
});
