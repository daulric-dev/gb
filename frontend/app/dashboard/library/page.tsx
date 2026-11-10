"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useSignal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { Building2, Globe2, Library, Search } from "lucide-react";
import { api } from "@/lib/api";
import { userMessage } from "@/lib/errors";
import {
  browseQuery,
  countsSummary,
  type LibraryItem,
  type LibraryScope,
} from "@/lib/library";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";

const SCOPES: { value: LibraryScope; label: string }[] = [
  { value: "all", label: "Everything I can use" },
  { value: "school", label: "My school" },
  { value: "organisation", label: "Shared with every school" },
  { value: "mine", label: "Published by me" },
];

/**
 * The course template library: browse and search what colleagues published
 * for the school or the whole organisation, then open one to preview and
 * import it. Publishing happens from a course's settings.
 */
export default function LibraryPage() {
  useSignals();
  const q = useSignal("");
  const subject = useSignal("");
  const gradeLevel = useSignal("");
  const tag = useSignal("");
  const scope = useSignal<LibraryScope>("all");
  const items = useSignal<LibraryItem[]>([]);
  const loading = useSignal(true);
  const error = useSignal<string | null>(null);

  const query = browseQuery({
    q: q.value,
    subject: subject.value,
    gradeLevel: gradeLevel.value,
    tag: tag.value,
    scope: scope.value,
  });

  useEffect(() => {
    let cancelled = false;
    loading.value = true;
    // Typing should not send a request per key.
    const timer = setTimeout(() => {
      api<LibraryItem[]>(`/library/items${query}`)
        .then((data) => {
          if (cancelled) return;
          items.value = data;
          error.value = null;
        })
        .catch((err) => {
          if (!cancelled) error.value = userMessage(err, "Failed to load the library");
        })
        .finally(() => {
          if (!cancelled) loading.value = false;
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, items, loading, error]);

  return (
    <div className="space-y-6">
      <DashboardPageHeader
        title="Course library"
        description="Templates published by colleagues in your school and across the organisation"
      />

      <Card>
        <CardContent className="grid gap-3 py-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="librarySearch">Search</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="librarySearch"
                className="pl-8"
                placeholder="Title, description, subject or tag"
                value={q.value}
                onChange={(e) => (q.value = e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="librarySubject">Subject</Label>
            <Input
              id="librarySubject"
              value={subject.value}
              onChange={(e) => (subject.value = e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="libraryGrade">Grade level</Label>
            <Input
              id="libraryGrade"
              value={gradeLevel.value}
              onChange={(e) => (gradeLevel.value = e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="libraryTag">Tag</Label>
            <Input
              id="libraryTag"
              value={tag.value}
              onChange={(e) => (tag.value = e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-5">
            <Label htmlFor="libraryScope">Show</Label>
            <NativeSelect
              id="libraryScope"
              className="w-full sm:w-72"
              value={scope.value}
              onChange={(e) => (scope.value = e.target.value as LibraryScope)}
            >
              {SCOPES.map((s) => (
                <NativeSelectOption key={s.value} value={s.value}>
                  {s.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </CardContent>
      </Card>

      <div aria-live="polite" aria-busy={loading.value}>
        {loading.value ? (
          <div className="grid gap-3 md:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : error.value ? (
          <p className="py-10 text-center text-sm text-destructive">{error.value}</p>
        ) : items.value.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <Library className="size-8 text-muted-foreground" aria-hidden="true" />
              <p className="font-medium">Nothing here yet</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Publish a course from its Settings page to share it as a
                template. Templates others share with your school or the whole
                organisation appear here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {items.value.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/dashboard/library/${item.id}`}
                  className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Card className="h-full transition-colors hover:bg-muted/40">
                    <CardContent className="space-y-2 py-4">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{item.title}</p>
                        {item.visibility === "organisation" ? (
                          <Badge variant="outline" className="shrink-0 gap-1">
                            <Globe2 className="size-3" aria-hidden="true" />
                            Every school
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="shrink-0 gap-1">
                            <Building2 className="size-3" aria-hidden="true" />
                            My school
                          </Badge>
                        )}
                      </div>
                      {item.description && (
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {item.description}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {[item.subject, item.gradeLevel && `Grade ${item.gradeLevel}`]
                          .filter(Boolean)
                          .join(" · ")}
                        {item.subject || item.gradeLevel ? " · " : ""}
                        {countsSummary(item.latest?.counts)}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {!item.published && <Badge variant="secondary">Unpublished</Badge>}
                        <span className="text-xs text-muted-foreground">
                          v{item.latestVersion}
                          {item.authorName ? ` · ${item.authorName}` : ""}
                          {!item.fromYourSchool && item.schoolName ? ` · ${item.schoolName}` : ""}
                        </span>
                        {item.tags.map((t) => (
                          <Badge key={t} variant="secondary" className="font-normal">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
