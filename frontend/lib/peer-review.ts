import { api } from "@/lib/api";
import type { Rubric } from "@/lib/courses/types";

/** Peer review on one assignment (API `src/peer-review`). */

export type PeerReviewOpenMode = "after_due" | "manual";
export type PeerReviewState = "scheduled" | "not_started" | "open" | "closed";

export interface ReviewMark {
  criterionId: string;
  ratingId: string | null;
  points: number;
  comment: string | null;
}

export interface PeerReviewSettings {
  enabled: boolean;
  reviewsPerStudent: number;
  anonymous: boolean;
  openMode: PeerReviewOpenMode;
  closesAt: string;
  rubricId: string | null;
  qualityPoints: number | null;
  qualityActivityId: string | null;
  startedAt: string | null;
  opensAt: string | null;
  state: PeerReviewState;
}

export interface StaffReview {
  id: string;
  submissionId: string;
  reviewer: { id: string; name: string } | null;
  author: { id: string; name: string } | null;
  comment: string | null;
  marks: ReviewMark[];
  score: number | null;
  submittedAt: string | null;
  hidden: boolean;
  hiddenReason: string | null;
  hiddenAt: string | null;
  updatedAt: string | null;
}

/** GET /activities/:id/peer-review */
export interface PeerReviewOverview {
  activityId: string;
  settings: PeerReviewSettings | null;
  rubric?: Rubric | null;
  reviews: StaffReview[];
  submitters: { studentId: string; submissionId: string; name: string }[];
}

export interface PeerReviewSettingsInput {
  enabled: boolean;
  reviewsPerStudent: number;
  anonymous: boolean;
  openMode: PeerReviewOpenMode;
  closesAt: string;
  rubricId: string | null;
  qualityPoints: number | null;
}

/** GET /portal/me/activities/:id/peer-review */
export type StudentPeerReview =
  | { enabled: false }
  | {
      enabled: true;
      state: PeerReviewState;
      opensAt: string | null;
      closesAt: string;
      anonymous: boolean;
      reviewsPerStudent: number;
      rubric: Rubric | null;
      assigned: { id: string; number: number; author: string | null; submittedAt: string | null }[];
      received: ReceivedReview[] | null;
    };

export interface ReceivedReview {
  id: string;
  number: number;
  reviewer: string | null;
  comment: string | null;
  marks: ReviewMark[];
  submittedAt: string | null;
}

/** GET /portal/me/peer-reviews/:allocationId */
export interface ReviewToWrite {
  id: string;
  number: number;
  activityId: string;
  activityTitle: string;
  instructions: string | null;
  state: PeerReviewState;
  closesAt: string;
  canEdit: boolean;
  anonymous: boolean;
  author: string | null;
  submission: {
    textBody: string | null;
    files: { id: string; name: string; contentType: string }[];
  };
  rubric: Rubric | null;
  review: { comment: string | null; marks: ReviewMark[]; submittedAt: string | null };
}

/** GET /portal/me/peer-reviews */
export interface ReviewTodo {
  id: string;
  number: number;
  activityId: string;
  activityTitle: string;
  courseId: string;
  courseName: string;
  closesAt: string | null;
  submittedAt: string | null;
}

export const peerReviewApi = {
  overview: (activityId: string) =>
    api<PeerReviewOverview>(`/activities/${activityId}/peer-review`),
  save: (activityId: string, body: PeerReviewSettingsInput) =>
    api<PeerReviewOverview>(`/activities/${activityId}/peer-review`, { method: "PUT", body }),
  start: (activityId: string) =>
    api<PeerReviewOverview>(`/activities/${activityId}/peer-review/start`, { method: "POST" }),
  add: (activityId: string, reviewerId: string, submissionId: string) =>
    api(`/activities/${activityId}/peer-review/reviews`, {
      method: "POST",
      body: { reviewerId, submissionId },
    }),
  reassign: (activityId: string, allocationId: string, reviewerId: string) =>
    api(`/activities/${activityId}/peer-review/reviews/${allocationId}`, {
      method: "PATCH",
      body: { reviewerId },
    }),
  remove: (activityId: string, allocationId: string) =>
    api(`/activities/${activityId}/peer-review/reviews/${allocationId}`, { method: "DELETE" }),
  hide: (activityId: string, allocationId: string, hidden: boolean, reason?: string) =>
    api(`/activities/${activityId}/peer-review/reviews/${allocationId}/hidden`, {
      method: "PATCH",
      body: { hidden, reason: reason || null },
    }),
  forActivity: (activityId: string) =>
    api<StudentPeerReview>(`/portal/me/activities/${activityId}/peer-review`),
  todo: () => api<ReviewTodo[]>(`/portal/me/peer-reviews`),
  review: (allocationId: string) => api<ReviewToWrite>(`/portal/me/peer-reviews/${allocationId}`),
  saveReview: (
    allocationId: string,
    body: { comment: string | null; marks: ReviewMark[]; submit: boolean },
  ) =>
    api<{ id: string; comment: string | null; marks: ReviewMark[]; submittedAt: string | null }>(
      `/portal/me/peer-reviews/${allocationId}`,
      { method: "PUT", body },
    ),
  fileUrl: (allocationId: string, fileId: string) =>
    `/portal/me/peer-reviews/${allocationId}/files/${fileId}`,
};

/** A short phrase for the window, for teachers and students. */
export function windowLabel(
  s: { state: PeerReviewState; opensAt: string | null; closesAt: string },
  format: (iso: string) => string,
): string {
  switch (s.state) {
    case "scheduled":
      return s.opensAt ? `Opens ${format(s.opensAt)}` : "Opens after the due date";
    case "not_started":
      return "Waiting for the teacher to start it";
    case "open":
      return `Open until ${format(s.closesAt)}`;
    case "closed":
      return `Closed ${format(s.closesAt)}`;
  }
}

/** The sum of a review's rubric marks, two decimals; null with none. */
export function reviewTotal(marks: ReviewMark[]): number | null {
  if (marks.length === 0) return null;
  return Math.round(marks.reduce((s, m) => s + m.points, 0) * 100) / 100;
}

/** Reviews done out of assigned, per reviewer (teacher overview). */
export function progressByReviewer(
  reviews: Pick<StaffReview, "reviewer" | "submittedAt">[],
): Map<string, { done: number; total: number }> {
  const out = new Map<string, { done: number; total: number }>();
  for (const r of reviews) {
    if (!r.reviewer) continue;
    const entry = out.get(r.reviewer.id) ?? { done: 0, total: 0 };
    entry.total++;
    if (r.submittedAt) entry.done++;
    out.set(r.reviewer.id, entry);
  }
  return out;
}

/** Whether every rubric criterion has a mark (needed to hand in). */
export function marksComplete(rubric: Rubric | null, marks: ReviewMark[]): boolean {
  if (!rubric) return true;
  return rubric.criteria.every((c) => marks.some((m) => m.criterionId === c.id));
}
