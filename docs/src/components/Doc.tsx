import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { hasDoc, loadDoc, parseFrontmatter, titleFromSlug } from "../lib/content";
import { resolveLink, slugifyHeading } from "../lib/links";

/** What `/` renders. Deliberately not a sidebar entry - the brand links here. */
const HOME_SLUG = "home";

/** The text of a heading, so it can be turned into an anchor id. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in (node as never)) {
    return textOf((node as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

function Heading({ level, children }: { level: 2 | 3 | 4; children: ReactNode }) {
  const id = slugifyHeading(textOf(children));
  const Tag = `h${level}` as "h2" | "h3" | "h4";
  return (
    <Tag id={id}>
      <a className="anchor" href={`#${id}`} aria-label="Link to this section">
        #
      </a>
      {children}
    </Tag>
  );
}

export function Doc() {
  const params = useParams();
  const { hash } = useLocation();
  const slug = params["*"] || HOME_SLUG;

  const [body, setBody] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    setBody(null);
    setMissing(false);

    if (!hasDoc(slug)) {
      setMissing(true);
      return;
    }

    void loadDoc(slug).then((raw) => {
      if (!live) return;
      setBody(raw === null ? null : parseFrontmatter(raw).body);
      if (raw === null) setMissing(true);
    });

    return () => {
      live = false;
    };
  }, [slug]);

  // Jump to the anchor once the document it belongs to is on the page.
  useEffect(() => {
    if (!body || !hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [body, hash]);

  useEffect(() => {
    document.title =
      slug === HOME_SLUG
        ? "GradeBook Docs"
        : `${titleFromSlug(slug)} · GradeBook Docs`;
  }, [slug]);

  if (missing) {
    return (
      <article className="doc">
        <h1>Not found</h1>
        <p>
          There is no page at <code>{slug}</code>.{" "}
          <Link to="/">Back to the docs</Link>.
        </p>
      </article>
    );
  }

  if (body === null) {
    return (
      <article className="doc">
        <p className="muted">Loading…</p>
      </article>
    );
  }

  return (
    <article className="doc">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h2: ({ children }) => <Heading level={2}>{children}</Heading>,
          h3: ({ children }) => <Heading level={3}>{children}</Heading>,
          h4: ({ children }) => <Heading level={4}>{children}</Heading>,
          a: ({ href, children }) => {
            const target = resolveLink(href ?? "", slug);

            if (target.kind === "internal") {
              return (
                <Link to={`/${target.slug}${target.hash}`}>{children}</Link>
              );
            }
            if (target.kind === "anchor") {
              return <a href={target.href}>{children}</a>;
            }
            return (
              <a href={target.href} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
        }}
      >
        {body}
      </ReactMarkdown>
    </article>
  );
}
