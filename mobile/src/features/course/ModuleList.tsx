import { Pressable, StyleSheet, View } from "react-native";
import {
  ChevronRight,
  ClipboardList,
  ExternalLink,
  FileText,
  Layers,
  MessagesSquare,
  NotebookText,
  Paperclip,
  PenLine,
} from "lucide-react-native";
import { Card, CardContent, CardHeader } from "@/components/ui/Card";
import { Text } from "@/components/ui/Text";
import { Badge } from "@/components/ui/Badge";
import { Switch } from "@/components/ui/Switch";
import { EmptyState } from "@/components/ui/EmptyState";
import { useTheme } from "@/theme/ThemeProvider";
import { dueLabel } from "@/lib/work";
import { formatScore } from "@/lib/format-number";
import type { CourseModule, ModuleItem } from "@/lib/course";

function itemIcon(item: ModuleItem) {
  switch (item.itemType) {
    case "page":
      return NotebookText;
    case "file":
      return Paperclip;
    case "link":
      return ExternalLink;
    case "discussion":
      return MessagesSquare;
    case "activity":
      return item.activity?.kind === "quiz"
        ? ClipboardList
        : item.activity?.kind === "offline"
          ? PenLine
          : FileText;
    default:
      return FileText;
  }
}

function itemDetail(item: ModuleItem): string | null {
  switch (item.itemType) {
    case "page":
      return "Page";
    case "file":
      return "File";
    case "link":
      return item.url ? item.url.replace(/^https?:\/\//, "") : "Link";
    case "discussion":
      return "Discussion";
    case "activity": {
      const a = item.activity;
      if (!a) return "Work";
      const kind =
        a.kind === "quiz" ? "Quiz" : a.kind === "offline" ? "Offline" : "Assignment";
      return [kind, `${formatScore(a.points)} pts`, dueLabel(a.dueAt)].join(" · ");
    }
    default:
      return null;
  }
}

/**
 * A course's modules in order, each with its items. Headings are labels;
 * every other item opens through `onOpenItem`. Staff also see what is
 * unpublished, and managers get a publish switch per module.
 */
export function ModuleList({
  modules,
  onOpenItem,
  staff = false,
  onTogglePublish,
  togglingId,
}: {
  modules: CourseModule[];
  onOpenItem: (item: ModuleItem) => void;
  staff?: boolean;
  onTogglePublish?: (module: CourseModule) => void;
  togglingId?: string | null;
}) {
  const { colors } = useTheme();

  if (modules.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No modules yet"
        description={
          staff
            ? "Build modules on the web app; they show up here."
            : "Your teacher has not published any modules yet."
        }
      />
    );
  }

  return (
    <View style={{ gap: 12 }}>
      {modules.map((m) => (
        <Card key={m.id}>
          <CardHeader style={styles.moduleHead}>
            <Text variant="subtitle" style={{ flex: 1 }}>
              {m.title}
            </Text>
            {staff && onTogglePublish ? (
              <View style={styles.publish}>
                <Text variant="muted" size="xs">
                  {m.isPublished ? "Published" : "Draft"}
                </Text>
                <Switch
                  value={m.isPublished}
                  disabled={togglingId === m.id}
                  onValueChange={() => onTogglePublish(m)}
                />
              </View>
            ) : staff && !m.isPublished ? (
              <Badge variant="secondary">Draft</Badge>
            ) : null}
          </CardHeader>
          <CardContent style={{ gap: 6, paddingTop: 8 }}>
            {m.items.length === 0 ? (
              <Text variant="muted" size="sm">
                Nothing in this module yet.
              </Text>
            ) : (
              m.items.map((item) => {
                if (item.itemType === "header") {
                  return (
                    <Text
                      key={item.id}
                      variant="label"
                      style={{
                        marginTop: 6,
                        color: colors.mutedForeground,
                        textTransform: "uppercase",
                        fontSize: 12,
                        letterSpacing: 0.5,
                      }}
                    >
                      {item.title}
                    </Text>
                  );
                }
                const Icon = itemIcon(item);
                const detail = itemDetail(item);
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => onOpenItem(item)}
                    style={({ pressed }) => [
                      styles.item,
                      {
                        borderColor: colors.border,
                        marginLeft: Math.min(item.indent, 3) * 12,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Icon color={colors.mutedForeground} size={18} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text weight="500" numberOfLines={2}>
                        {item.title}
                      </Text>
                      {detail ? (
                        <Text variant="muted" size="xs" numberOfLines={1}>
                          {detail}
                        </Text>
                      ) : null}
                    </View>
                    {staff && !item.isPublished ? (
                      <Badge variant="secondary">Draft</Badge>
                    ) : null}
                    <ChevronRight color={colors.mutedForeground} size={16} />
                  </Pressable>
                );
              })
            )}
          </CardContent>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  moduleHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  publish: { flexDirection: "row", alignItems: "center", gap: 6 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
