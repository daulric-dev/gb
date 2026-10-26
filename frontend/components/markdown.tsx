"use client";

import { createContext, useContext, type ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ImageIcon } from "lucide-react";
import { isTrustedImageSrc } from "@/lib/image-src";
import { cn } from "@/lib/utils";

/**
 * Renders course content written in Markdown (pages, instructions,
 * announcements).
 *
 * Raw HTML in the source is never rendered - react-markdown escapes it unless
 * a rehype-raw plugin is added, and none is - so a teacher's page cannot
 * carry script. Links open in a new tab since they almost always leave the
 * course.
 *
 * Images load inline only from this site or the origins we host images on
 * (lib/image-src.ts, the same list the CSP img-src allows). Any other image
 * becomes a link, so a post cannot embed a tracking pixel that logs every
 * reader's IP when the page opens.
 */

// Set inside a Markdown link, where an image fallback must not add a nested <a>.
const InLink = createContext(false);

function hostname(src: string): string | null {
  try {
    const url = new URL(src);
    return url.protocol === "https:" || url.protocol === "http:" ? url.hostname : null;
  } catch {
    return null;
  }
}

function MarkdownImage({
  className,
  src,
  alt,
  title,
}: Pick<ComponentProps<"img">, "className" | "src" | "alt" | "title">) {
  const inLink = useContext(InLink);
  const href = typeof src === "string" ? src : undefined;

  if (isTrustedImageSrc(href)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={cn("my-3 max-w-full rounded-md", className)} src={href} alt={alt ?? ""} title={title} />;
  }

  // An external image: show what it is and link to it, never load it.
  const host = href ? hostname(href) : null;
  const label = (
    <>
      <ImageIcon className="size-4 shrink-0" aria-hidden />
      <span>{alt?.trim() || "Image"}</span>
      {host && <span className="text-muted-foreground">({host})</span>}
    </>
  );
  const labelClass = "inline-flex items-center gap-1 align-middle";

  if (!host || inLink) return <span className={labelClass}>{label}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      title={title}
      className={cn(labelClass, "font-medium text-primary underline underline-offset-4")}
    >
      {label}
    </a>
  );
}

const components: Components = {
  h1: ({ className, ...props }) => (
    <h1 className={cn("mt-6 mb-3 text-2xl font-bold first:mt-0", className)} {...props} />
  ),
  h2: ({ className, ...props }) => (
    <h2 className={cn("mt-6 mb-2 text-xl font-semibold first:mt-0", className)} {...props} />
  ),
  h3: ({ className, ...props }) => (
    <h3 className={cn("mt-4 mb-2 text-lg font-semibold first:mt-0", className)} {...props} />
  ),
  p: ({ className, ...props }) => (
    <p className={cn("my-3 leading-7 first:mt-0 last:mb-0", className)} {...props} />
  ),
  a: ({ className, children, ...props }) => (
    <a
      className={cn("font-medium text-primary underline underline-offset-4", className)}
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      <InLink.Provider value={true}>{children}</InLink.Provider>
    </a>
  ),
  ul: ({ className, ...props }) => (
    <ul className={cn("my-3 ml-6 list-disc space-y-1", className)} {...props} />
  ),
  ol: ({ className, ...props }) => (
    <ol className={cn("my-3 ml-6 list-decimal space-y-1", className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn("my-3 border-l-2 pl-4 text-muted-foreground italic", className)}
      {...props}
    />
  ),
  code: ({ className, ...props }) => (
    <code
      className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-sm", className)}
      {...props}
    />
  ),
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "my-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-sm [&_code]:bg-transparent [&_code]:p-0",
        className,
      )}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="my-3 overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  ),
  th: ({ className, ...props }) => (
    <th className={cn("border px-3 py-1.5 text-left font-semibold", className)} {...props} />
  ),
  td: ({ className, ...props }) => (
    <td className={cn("border px-3 py-1.5", className)} {...props} />
  ),
  hr: ({ className, ...props }) => <hr className={cn("my-6", className)} {...props} />,
  img: ({ src, alt, title, className }) => (
    <MarkdownImage src={src} alt={alt} title={title} className={className} />
  ),
};

export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={cn("text-sm break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
