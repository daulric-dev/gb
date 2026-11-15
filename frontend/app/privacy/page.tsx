import type { Metadata } from "next";
import data from "@/data/privacy-policy.json";
import { PrivacyNoticeView, type NoticeDocument } from "./_components/privacy-notice-view";

export const metadata: Metadata = { title: "Privacy notice" };

export default function PrivacyNoticePage() {
  return <PrivacyNoticeView doc={data as NoticeDocument} />;
}
