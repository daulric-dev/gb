import { api } from "@/lib/api";
import type { Rubric } from "@/lib/course";

/** Peer review (API `src/peer-review`), the student's side. Mirrors web `lib/peer-review.ts`. */

import type { PeerReviewState, ReviewMark } from "@/lib/peer-review-helpers";

export type { PeerReviewState, ReviewMark };

export interface ReceivedReview {
  id: string;
  number: number;
  reviewer: string | null;
  comment: string | null;
  marks: ReviewMark[];
  submittedAt: string | null;
}

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

export function fetchActivityPeerReview(activityId: string) {
  return api<StudentPeerReview>(`/portal/me/activities/${activityId}/peer-review`);
}

export function fetchReview(allocationId: string) {
  return api<ReviewToWrite>(`/portal/me/peer-reviews/${allocationId}`);
}

export function saveReview(
  allocationId: string,
  body: { comment: string | null; marks: ReviewMark[]; submit: boolean },
) {
  return api<{ id: string; comment: string | null; marks: ReviewMark[]; submittedAt: string | null }>(
    `/portal/me/peer-reviews/${allocationId}`,
    { method: "PUT", body },
  );
}

/** The reviewer-only, sandboxed file route (open with downloadAndOpen). */
export function reviewFilePath(allocationId: string, fileId: string) {
  return `/portal/me/peer-reviews/${allocationId}/files/${fileId}`;
}

export { marksComplete, windowLabel, withMark } from "@/lib/peer-review-helpers";
