import { api } from "@/lib/api";
import { isOffline } from "@/lib/connectivity";
import type { CourseModule } from "@/lib/course";
import { saveForOffline } from "@/lib/offline-reads";
import {
  draftQueue,
  offlineCache,
  offlineScope,
  offlineScopeKey,
} from "@/lib/offline-store";
import type { PortalCourseCard } from "@/lib/portal";
import {
  answersVersion,
  closesAtFor,
  type AnswerLike,
  type QueuedDraft,
  type RunResult,
  type ServerState,
} from "@/lib/sync-queue";
import {
  isOutstanding,
  type PortalWorkDetail,
  type PortalWorkItem,
} from "@/lib/work";

/**
 * The app side of the draft queue (sync-queue.ts): how a queued quiz save is
 * checked and sent, and the background download of what a student may want
 * to read offline.
 */

export const workPath = (activityId: string) =>
  `/portal/me/activities/${activityId}`;

/**
 * What is written to the device for a piece of work. A Lockdown quiz keeps
 * its instructions but never its questions or attempt: it can't be taken
 * offline, and its questions shouldn't sit in a file.
 */
export function workForStorage(work: PortalWorkDetail): PortalWorkDetail {
  if (work.kind === "quiz" && work.lockdownBrowser) {
    return { ...work, questions: [], quizAttempt: null };
  }
  return work;
}

/** The server's side of a quiz, for conflict and deadline checks. */
export function serverStateOf(work: PortalWorkDetail): ServerState {
  const attempt = work.quizAttempt;
  return {
    version: attempt
      ? answersVersion(attempt.startedAt, attempt.answers as AnswerLike[])
      : null,
    attemptStartedAt: attempt?.startedAt ?? null,
    quizExpiresAt: attempt?.expiresAt ?? null,
    closesAt: closesAtFor(work),
  };
}

async function readWork(activityId: string): Promise<PortalWorkDetail> {
  const work = await api<PortalWorkDetail>(workPath(activityId));
  const scope = offlineScope();
  if (scope) {
    try {
      offlineCache.put(scope, workPath(activityId), workForStorage(work));
    } catch {
      /* the copy is a convenience */
    }
  }
  return work;
}

/** POST the queued answers with the item's idempotency key. */
async function sendQuizAnswers(
  item: QueuedDraft,
): Promise<{ version: string | null }> {
  await api(`/portal/me/activities/${item.activityId}/quiz/answers`, {
    method: "POST",
    body: item.payload,
    // The save replaces the attempt's answers as a whole, so a repeat is
    // harmless; the key (reused on every retry of this snapshot) lets a
    // server or proxy that understands it drop the duplicate. Older APIs
    // ignore the header.
    headers: { "Idempotency-Key": item.idempotencyKey },
  });
  try {
    return { version: serverStateOf(await readWork(item.activityId)).version };
  } catch {
    const answers = (item.payload as { answers?: AnswerLike[] })?.answers ?? [];
    return { version: answersVersion(item.attemptStartedAt, answers) };
  }
}

/** Send what is queued for the signed-in student. Null without a student. */
export function runDraftSync(): Promise<RunResult> | null {
  const key = offlineScopeKey();
  if (!key) return null;
  return draftQueue.run(key, {
    current: async (item) => serverStateOf(await readWork(item.activityId)),
    send: sendQuizAnswers,
  });
}

// ── background download ─────────────────────────────────────────────────────

const PREFETCH_EVERY_MS = 6 * 60 * 60_000;
const MAX_PAGES = 60;
const MAX_WORK = 40;
let lastPrefetch: { scope: string; at: number } | null = null;
let prefetching = false;

/**
 * Save what a student is likely to need offline, at most every 6 hours:
 * their courses, each active course's modules and pages, the work list and
 * the instructions of work still to do. Stops quietly when the network goes.
 */
export async function prefetchForOffline(force = false): Promise<void> {
  const key = offlineScopeKey();
  if (!key || prefetching || isOffline()) return;
  if (
    !force &&
    lastPrefetch?.scope === key &&
    Date.now() - lastPrefetch.at < PREFETCH_EVERY_MS
  ) {
    return;
  }
  prefetching = true;
  try {
    const courses =
      (await saveForOffline<PortalCourseCard[]>("/portal/me/courses")) ?? [];
    const work =
      (await saveForOffline<PortalWorkItem[]>("/portal/me/activities")) ?? [];
    let pages = 0;
    for (const course of courses.filter((c) => c.status !== "archived")) {
      if (isOffline() || offlineScopeKey() !== key) return;
      const base = `/portal/me/courses/${course.id}`;
      await saveForOffline(base);
      await saveForOffline(`${base}/activities`);
      const modules =
        (await saveForOffline<CourseModule[]>(`${base}/modules`)) ?? [];
      for (const item of modules.flatMap((m) => m.items)) {
        if (item.itemType !== "page" || !item.pageId) continue;
        if (pages++ >= MAX_PAGES || isOffline()) break;
        await saveForOffline(`${base}/pages/${item.pageId}`);
      }
    }
    for (const item of work.filter(isOutstanding).slice(0, MAX_WORK)) {
      if (isOffline() || offlineScopeKey() !== key) return;
      await saveForOffline<PortalWorkDetail>(workPath(item.id), workForStorage);
    }
    lastPrefetch = { scope: key, at: Date.now() };
  } finally {
    prefetching = false;
  }
}

/** Forget when the last download ran (after clearing saved copies). */
export function resetPrefetch(): void {
  lastPrefetch = null;
}
