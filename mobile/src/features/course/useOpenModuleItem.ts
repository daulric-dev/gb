import { useCallback, useState } from "react";
import { Linking } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useRouter } from "expo-router";
import { useToast } from "@/providers/ToastProvider";
import { downloadAndOpen } from "@/lib/open-file";
import { href, type ModuleItem } from "@/lib/course";
import { userMessage } from "@/lib/errors";
import { api, ApiError } from "@/lib/api";
import { isFeatureDisabledError } from "@/lib/features";

/** What to say when an external tool launch could not start. */
function launchErrorMessage(err: unknown): string {
  if (isFeatureDisabledError(err)) return "External tools are turned off for your school";
  if (err instanceof ApiError && err.status === 404) return "This tool is no longer available";
  if (err instanceof ApiError && err.status === 403) return "You don't have access to this tool";
  return userMessage(err, "Could not open this tool");
}

/**
 * Opens a module item the way it should be opened on a phone: pages,
 * work and discussions in the app, files through the share sheet
 * (downloaded with the session), links in the browser. Staff open files
 * through the course's own file route, so a colleague's upload opens too.
 * External tools (LTI) get a single-use launch URL that opens in the
 * in-app browser.
 */
export function useOpenModuleItem(courseId: string, audience: "student" | "staff") {
  const router = useRouter();
  const toast = useToast();
  const [openingFile, setOpeningFile] = useState<string | null>(null);

  const open = useCallback(
    async (item: ModuleItem) => {
      const base = audience === "student" ? `/course/${courseId}` : `/teaching/${courseId}`;
      switch (item.itemType) {
        case "page":
          if (item.pageId) router.push(href(`${base}/page/${item.pageId}`));
          return;
        case "activity":
          if (!item.activityId) return;
          router.push(
            href(
              audience === "student"
                ? `/work/${item.activityId}`
                : `${base}/activity/${item.activityId}`,
            ),
          );
          return;
        case "discussion":
          if (item.discussionTopicId) {
            router.push(href(`${base}/discussion/${item.discussionTopicId}`));
          } else {
            toast.error("This discussion is not available");
          }
          return;
        case "link":
          if (item.url && /^https?:\/\//i.test(item.url)) {
            await Linking.openURL(item.url).catch(() =>
              toast.error("Could not open this link"),
            );
          } else {
            toast.error("This link cannot be opened");
          }
          return;
        case "file": {
          if (!item.fileId || openingFile) return;
          setOpeningFile(item.id);
          try {
            await downloadAndOpen(
              audience === "student"
                ? `/portal/me/courses/${courseId}/files/${item.fileId}`
                : `/courses/${courseId}/files/${item.fileId}`,
              item.title,
            );
          } catch (err) {
            toast.error(userMessage(err, "Could not open this file"));
          } finally {
            setOpeningFile(null);
          }
          return;
        }
        case "external_tool": {
          if (openingFile) return;
          setOpeningFile(item.id);
          try {
            const { url } = await api<{ url: string; expiresAt: string }>(
              `/courses/${courseId}/lti/launches`,
              { method: "POST", body: { moduleItemId: item.id } },
            );
            if (!/^https?:\/\//i.test(url)) throw new Error("bad launch url");
            await WebBrowser.openBrowserAsync(url);
          } catch (err) {
            toast.error(launchErrorMessage(err));
          } finally {
            setOpeningFile(null);
          }
          return;
        }
        default:
          return;
      }
    },
    [audience, courseId, openingFile, router, toast],
  );

  return { open, openingFile };
}
