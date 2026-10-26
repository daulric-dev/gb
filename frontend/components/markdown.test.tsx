import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./markdown";

const env = process.env as Record<string, string | undefined>;
let prevApi: string | undefined;

beforeAll(() => {
  prevApi = env.NEXT_PUBLIC_API_URL;
  env.NEXT_PUBLIC_API_URL = "https://api.example.com";
});
afterAll(() => {
  env.NEXT_PUBLIC_API_URL = prevApi;
});

const render = (md: string) => renderToStaticMarkup(<Markdown>{md}</Markdown>);

describe("Markdown images", () => {
  test("same-origin and API images render inline", () => {
    expect(render("![logo](/logo.png)")).toContain('<img class="my-3 max-w-full rounded-md" src="/logo.png" alt="logo"');
    expect(render("![a](https://api.example.com/api/images/avatars/u.png)")).toContain(
      'src="https://api.example.com/api/images/avatars/u.png"',
    );
  });

  test("an external image becomes a link and is never loaded", () => {
    const html = render('![chart](https://tracker.example.net/p.gif "Sales")');
    expect(html).not.toContain("<img");
    expect(html).toContain('href="https://tracker.example.net/p.gif"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("chart");
    expect(html).toContain("(tracker.example.net)");
  });

  test("without alt text the link reads 'Image'", () => {
    const html = render("![](//tracker.example.net/p.gif)");
    expect(html).not.toContain("<img");
    expect(html).toContain("Image");
  });

  test("an external image inside a link does not nest anchors", () => {
    const html = render("[![x](https://tracker.example.net/p.gif)](https://example.org)");
    expect(html).not.toContain("<img");
    expect(html.match(/<a /g)?.length).toBe(1);
    expect(html).toContain('href="https://example.org"');
  });
});
