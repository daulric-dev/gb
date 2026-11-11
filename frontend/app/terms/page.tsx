import type { Metadata } from "next";
import data from "@/data/terms-of-service.json";
import { PrivacyNoticeView, type NoticeDocument } from "../privacy/_components/privacy-notice-view";

export const metadata: Metadata = { title: "Terms of Service" };

/** The terms, with the organisation's name and contact filled in from its privacy settings. */
export default function TermsOfServicePage() {
  return <PrivacyNoticeView doc={data as NoticeDocument} warnIncomplete={false} />;
}
