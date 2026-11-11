"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { ModeToggle } from "@/components/layout/mode-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CATEGORY_LABELS,
  FIELD_LABELS,
  contactText,
  fetchPrivacyNotice,
  fill,
  type PrivacyNotice,
} from "../_lib/notice";

interface ListItem {
  key?: string;
  bold?: string;
  text?: string;
}

export interface NoticeSection {
  id: string;
  heading: string;
  dynamic?: string;
  paragraphs: string[];
  list?: (string | ListItem)[];
  footer?: string;
}

export interface NoticeCookie {
  name: string;
  where: string;
  purpose: string;
  duration: string;
  kind: string;
}

export interface NoticeDocument {
  title: string;
  lastUpdated: string;
  crossLink: { href: string; label: string };
  sections: NoticeSection[];
  cookies?: NoticeCookie[];
}

/** Capitalises a sentence that starts with a filled-in placeholder. */
function sentence(text: string): string {
  return text.replace(/(^|[.!?]\s+)([a-z])/g, (_, lead: string, c: string) => lead + c.toUpperCase());
}

function Para({ text, notice }: { text: string; notice: PrivacyNotice | null }) {
  return <p className="text-muted-foreground">{sentence(fill(text, notice))}</p>;
}

function Missing({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-amber-100 px-1 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      {children}
    </span>
  );
}

function Value({ value, field }: { value: string | null | undefined; field: string }) {
  return value?.trim() ? <>{value}</> : <Missing>Not set: {FIELD_LABELS[field] ?? field}</Missing>;
}

function ControllerBlock({ notice }: { notice: PrivacyNotice | null }) {
  return (
    <dl className="mt-3 grid gap-x-4 gap-y-2 text-muted-foreground sm:grid-cols-[14rem_1fr]">
      <dt className="font-medium text-foreground">Controller</dt>
      <dd>
        <Value value={notice?.controller.name} field="controllerName" />
      </dd>
      <dt className="font-medium text-foreground">Address</dt>
      <dd className="whitespace-pre-line">
        <Value value={notice?.controller.address} field="controllerAddress" />
      </dd>
      <dt className="font-medium text-foreground">Privacy contact</dt>
      <dd>
        {notice?.controller.privacyEmail ? (
          <a className="underline underline-offset-4" href={`mailto:${notice.controller.privacyEmail}`}>
            {notice.controller.privacyEmail}
          </a>
        ) : (
          <Value value={null} field="privacyEmail" />
        )}
      </dd>
      <dt className="font-medium text-foreground">Data protection officer</dt>
      <dd>
        {notice?.dpo ? (
          <>
            {notice.dpo.name}
            {notice.dpo.name && notice.dpo.email ? ", " : ""}
            {notice.dpo.email && (
              <a className="underline underline-offset-4" href={`mailto:${notice.dpo.email}`}>
                {notice.dpo.email}
              </a>
            )}
          </>
        ) : (
          "Not appointed or not stated; contact the privacy contact above"
        )}
      </dd>
    </dl>
  );
}

function AuthorityBlock({ notice }: { notice: PrivacyNotice | null }) {
  const a = notice?.supervisoryAuthority;
  return (
    <p className="mt-3 text-muted-foreground">
      <span className="font-medium text-foreground">Supervisory authority for {notice?.controller.name || "this organisation"}: </span>
      {a?.name ? (
        a.url ? (
          <a className="underline underline-offset-4" href={a.url} target="_blank" rel="noreferrer">
            {a.name}
          </a>
        ) : (
          a.name
        )
      ) : (
        <Missing>Not set: {FIELD_LABELS.supervisoryAuthorityName}</Missing>
      )}
    </p>
  );
}

function LawfulBasesTable({ notice }: { notice: PrivacyNotice | null }) {
  if (!notice) return null;
  return (
    <div className="mt-3 rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Purpose</TableHead>
            <TableHead>Lawful basis</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {notice.lawfulBases.map((p) => (
            <TableRow key={p.purpose}>
              <TableCell className="align-top whitespace-normal">{p.label}</TableCell>
              <TableCell className="align-top whitespace-normal text-muted-foreground">
                <ul className="space-y-1">
                  {p.bases.map((b) => (
                    <li key={b.key}>{b.label}</li>
                  ))}
                </ul>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ActivitiesList({ section, notice }: { section: NoticeSection; notice: PrivacyNotice | null }) {
  return (
    <ul className="mt-3 list-disc space-y-2 pl-6 text-muted-foreground">
      {(section.list ?? []).map((item, i) => {
        if (typeof item === "string") return <li key={i}>{fill(item, notice)}</li>;
        const on = item.key && notice ? notice.features[item.key] : undefined;
        return (
          <li key={i}>
            <strong className="text-foreground">{item.bold}</strong>
            {on !== undefined && (
              <Badge variant={on ? "secondary" : "outline"} className="ml-2 align-middle">
                {on ? "In use" : "Off"}
              </Badge>
            )}
            {" - "}
            {fill(item.text ?? "", notice)}
          </li>
        );
      })}
    </ul>
  );
}

function RecipientsTable({ notice }: { notice: PrivacyNotice | null }) {
  if (!notice) return null;
  if (notice.recipients.length === 0) {
    return (
      <p className="mt-3 text-muted-foreground">
        No external services are configured on this installation yet.
      </p>
    );
  }
  return (
    <div className="mt-3 rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Recipient</TableHead>
            <TableHead>What for</TableHead>
            <TableHead>Where</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {notice.recipients.map((r, i) => (
            <TableRow key={`${r.category}-${r.host ?? r.name}-${i}`}>
              <TableCell className="align-top whitespace-normal">
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">{CATEGORY_LABELS[r.category]}</div>
              </TableCell>
              <TableCell className="align-top whitespace-normal text-muted-foreground">{r.purpose}</TableCell>
              <TableCell className="align-top whitespace-normal text-muted-foreground">
                {r.internal
                  ? "The organisation's own network"
                  : [r.host, r.location].filter(Boolean).join(", ") || "-"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RetentionTable({ notice }: { notice: PrivacyNotice | null }) {
  if (!notice) return null;
  return (
    <div className="mt-3 rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Kept for</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {notice.retention.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="align-top whitespace-normal">{r.label}</TableCell>
              <TableCell className="align-top whitespace-normal text-muted-foreground">{r.period}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CookiesTable({ cookies }: { cookies: NoticeCookie[] }) {
  return (
    <div className="mt-3 rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Purpose</TableHead>
            <TableHead>How long</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cookies.map((c) => (
            <TableRow key={c.name}>
              <TableCell className="align-top whitespace-normal">
                <code className="text-xs">{c.name}</code>
                <div className="text-xs text-muted-foreground">
                  {c.where} · {c.kind}
                </div>
              </TableCell>
              <TableCell className="align-top whitespace-normal text-muted-foreground">{c.purpose}</TableCell>
              <TableCell className="align-top whitespace-normal text-muted-foreground">{c.duration}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Dynamic({
  section,
  notice,
  doc,
}: {
  section: NoticeSection;
  notice: PrivacyNotice | null;
  doc: NoticeDocument;
}) {
  switch (section.dynamic) {
    case "controller":
      return <ControllerBlock notice={notice} />;
    case "lawfulBases":
      return <LawfulBasesTable notice={notice} />;
    case "activities":
      return <ActivitiesList section={section} notice={notice} />;
    case "recipients":
      return <RecipientsTable notice={notice} />;
    case "retention":
      return <RetentionTable notice={notice} />;
    case "cookies":
      return <CookiesTable cookies={doc.cookies ?? []} />;
    case "authority":
      return <AuthorityBlock notice={notice} />;
    case "location":
      return (
        <p className="mt-3 text-muted-foreground">
          <span className="font-medium text-foreground">Where this GradeBook is hosted: </span>
          {notice?.dataLocation ?? <Missing>Not set: {FIELD_LABELS.dataLocation}</Missing>}
        </p>
      );
    case "contact":
      return notice?.controller.address ? (
        <p className="mt-3 whitespace-pre-line text-muted-foreground">
          {notice.controller.name}
          {"\n"}
          {notice.controller.address}
        </p>
      ) : null;
    default:
      return null;
  }
}

/** The organisation's notice is incomplete: say so plainly, and tell admins where to fix it. */
function IncompleteWarning({ notice }: { notice: PrivacyNotice }) {
  return (
    <Alert className="mb-8 border-amber-500/50">
      <AlertTriangle className="text-amber-600" />
      <AlertTitle>This privacy notice is incomplete</AlertTitle>
      <AlertDescription>
        <p>
          The organisation running this GradeBook has not yet entered:{" "}
          {notice.missing.map((f) => FIELD_LABELS[f] ?? f).join(", ")}.
        </p>
        <p className="mt-1">
          Organisation administrators: fill these in under{" "}
          <Link href="/organisation/privacy" className="underline underline-offset-4">
            Organisation console → Privacy
          </Link>
          .
        </p>
      </AlertDescription>
    </Alert>
  );
}

/**
 * A privacy notice whose placeholders and tables come from
 * `GET /api/privacy/notice`, so it describes this installation. The static
 * text renders at once and the live parts fill in when the answer arrives.
 */
export function PrivacyNoticeView({ doc, warnIncomplete = true }: { doc: NoticeDocument; warnIncomplete?: boolean }) {
  useSignals();
  const noticeSignal = useSignal<PrivacyNotice | null>(null);
  const failedSignal = useSignal(false);

  useEffect(() => {
    let live = true;
    fetchPrivacyNotice()
      .then((n) => {
        if (live) noticeSignal.value = n;
      })
      .catch(() => {
        if (live) failedSignal.value = true;
      });
    return () => {
      live = false;
    };
  }, [noticeSignal, failedSignal]);

  const notice = noticeSignal.value;
  const failed = failedSignal.value;

  return (
    <div className="min-h-screen bg-background">
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>

      <div className="mx-auto max-w-3xl px-4 py-16">
        <Link
          href="/login"
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back
        </Link>

        <h1 className="mb-2 text-3xl font-bold tracking-tight">{doc.title}</h1>
        <p className="mb-10 text-sm text-muted-foreground">
          {notice?.controller.name || notice?.organisationName
            ? `${notice.controller.name || notice.organisationName} · `
            : ""}
          Last updated: {doc.lastUpdated}
        </p>

        {warnIncomplete && notice && !notice.configured && <IncompleteWarning notice={notice} />}
        {failed && (
          <Alert className="mb-8" variant="destructive">
            <AlertTriangle />
            <AlertTitle>The live details could not be loaded</AlertTitle>
            <AlertDescription>
              The organisation&apos;s contact details, the services it uses and its retention periods are missing
              below. Reload the page, or ask {contactText(null)}.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-8 text-sm leading-relaxed">
          {doc.sections.map((section, i) => (
            <section key={section.id} id={section.id}>
              <h2 className="mb-3 text-lg font-semibold">
                {i + 1}. {section.heading}
              </h2>
              <div className="space-y-3">
                {section.paragraphs.map((p, j) => (
                  <Para key={j} text={p} notice={notice} />
                ))}
              </div>
              {section.dynamic ? (
                <Dynamic section={section} notice={notice} doc={doc} />
              ) : (
                section.list && (
                  <ul className="mt-3 list-disc space-y-2 pl-6 text-muted-foreground">
                    {section.list.map((item, k) =>
                      typeof item === "string" ? (
                        <li key={k}>{fill(item, notice)}</li>
                      ) : (
                        <li key={k}>
                          {item.bold && <strong className="text-foreground">{item.bold}</strong>}
                          {item.bold && " - "}
                          {fill(item.text ?? "", notice)}
                        </li>
                      ),
                    )}
                  </ul>
                )
              )}
              {section.footer && (
                <p className="mt-3 text-muted-foreground">{sentence(fill(section.footer, notice))}</p>
              )}
            </section>
          ))}
        </div>

        <div className="mt-12 border-t pt-6 text-xs text-muted-foreground">
          <Link href={doc.crossLink.href} className="underline underline-offset-4 hover:text-foreground">
            {doc.crossLink.label}
          </Link>
        </div>
      </div>
    </div>
  );
}
