"use client";

import { useParams } from "next/navigation";
import { useSignals } from "@preact/signals-react/runtime";
import { announcementSource, personName, type ParentAnnouncement } from "@/lib/parent";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Markdown } from "@/components/markdown";
import { NoTranslate } from "@/components/translation/no-translate";
import { useChildData } from "../../_components/use-child-data";
import { formatWhen, Loading, Notice } from "../../_components/ui";

/**
 * Announcements for the child, newest first: their school's posts for
 * everyone (badged "School") and their courses' posts.
 */
export default function ParentAnnouncementsPage() {
  useSignals();
  const { studentId } = useParams<{ studentId: string }>();
  const res = useChildData<ParentAnnouncement[]>(`/parent/children/${studentId}/announcements`);

  if (res.loading.value) return <Loading />;
  if (res.error.value) return <Notice>{res.error.value}</Notice>;
  const list = res.data.value ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Announcements</h1>
      {list.length === 0 && <Notice>No announcements yet.</Notice>}
      {list.map((a) => (
        <Card key={a.id}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{a.title}</CardTitle>
              {a.scope === "school" && <Badge variant="secondary">School</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              <NoTranslate>{announcementSource(a)}</NoTranslate> ·{" "}
              <NoTranslate>{personName(a.author, a.scope === "school" ? "School" : "Teacher")}</NoTranslate> ·{" "}
              {formatWhen(a.createdAt)}
            </p>
          </CardHeader>
          {a.body && (
            <CardContent>
              <Markdown>{a.body}</Markdown>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
