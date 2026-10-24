import { useCallback, useState } from "react";
import { Linking } from "react-native";
import { useRouter } from "expo-router";
import { useToast } from "@/providers/ToastProvider";
import { downloadAndOpen } from "@/lib/open-file";
import { errorMessage, href, type ModuleItem } from "@/lib/course";

/**
 * Opens a module item the way it should be opened on a phone: pages,
 * work and discussions in the app, files through the share sheet
 * (downloaded with the session), links in the browser. Staff open files
 * through the course's own file route, so a colleague's upload opens too.
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
            toast.error(errorMessage(err, "Could not open this file"));
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
