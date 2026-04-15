import Link from "next/link";
import { ModeToggle } from "@/components/layout/mode-toggle";
import { ArrowLeft } from "lucide-react";

interface ListItem {
  bold?: string;
  text?: string;
}

interface PolicySection {
  heading: string;
  paragraphs: string[];
  list?: (string | ListItem)[];
  footer?: string;
}

interface PolicyData {
  title: string;
  lastUpdated: string;
  crossLink: { href: string; label: string };
  sections: PolicySection[];
}

function renderListItem(item: string | ListItem, index: number) {
  if (typeof item === "string") {
    return <li key={index}>{item}</li>;
  }
  return (
    <li key={index}>
      {item.bold && <strong className="text-foreground">{item.bold}</strong>}
      {item.bold && " - "}
      {item.text}
    </li>
  );
}

export function PolicyPage({ data }: { data: PolicyData }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>

      <div className="mx-auto max-w-3xl px-4 py-16">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-8"
        >
          <ArrowLeft className="size-4" />
          Back
        </Link>

        <h1 className="text-3xl font-bold tracking-tight mb-2">{data.title}</h1>
        <p className="text-sm text-muted-foreground mb-10">
          Last updated: {data.lastUpdated}
        </p>

        <div className="space-y-8 text-sm leading-relaxed">
          {data.sections.map((section, i) => (
            <section key={i}>
              <h2 className="text-lg font-semibold mb-3">
                {i + 1}. {section.heading}
              </h2>

              {section.paragraphs.map((p, j) => (
                <p key={j} className={`text-muted-foreground ${section.list && j === section.paragraphs.length - 1 ? "mb-3" : ""}`}>
                  {p}
                </p>
              ))}

              {section.list && (
                <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
                  {section.list.map((item, k) => renderListItem(item, k))}
                </ul>
              )}

              {section.footer && (
                <p className="text-muted-foreground mt-3">{section.footer}</p>
              )}
            </section>
          ))}
        </div>

        <div className="mt-12 pt-6 border-t text-xs text-muted-foreground">
          <Link
            href={data.crossLink.href}
            className="hover:text-foreground underline underline-offset-4"
          >
            {data.crossLink.label}
          </Link>
        </div>
      </div>
    </div>
  );
}
