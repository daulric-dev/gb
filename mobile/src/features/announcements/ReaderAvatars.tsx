import { StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { getInitials } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { Text } from "@/components/ui/Text";
import type { AnnouncementReader } from "./types";

const MAX_SHOWN = 6;
const SIZE = 28;

/** Overlapping avatar row showing who has read an announcement. */
export function ReaderAvatars({ readers }: { readers: AnnouncementReader[] }) {
  const { colors } = useTheme();

  if (readers.length === 0) {
    return <Text variant="muted">Not read yet</Text>;
  }

  const shown = readers.slice(0, MAX_SHOWN);
  const extra = readers.length - shown.length;

  return (
    <View style={styles.row}>
      <Text variant="muted">Read by</Text>
      <View style={styles.stack}>
        {shown.map((r, i) => (
          <View
            key={r.id}
            style={[
              styles.avatar,
              {
                borderColor: colors.card,
                marginLeft: i === 0 ? 0 : -8,
                zIndex: shown.length - i,
              },
            ]}
          >
            <Avatar
              uri={r.avatar_url}
              fallback={getInitials(r.first_name, r.last_name)}
              size={SIZE}
            />
          </View>
        ))}
        {extra > 0 ? (
          <View
            style={[
              styles.avatar,
              styles.extra,
              {
                borderColor: colors.card,
                backgroundColor: colors.muted,
                marginLeft: -8,
              },
            ]}
          >
            <Text variant="muted" style={{ fontSize: 11, fontWeight: "600" }}>
              +{extra}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stack: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    borderWidth: 2,
    borderRadius: SIZE / 2 + 2,
  },
  extra: {
    width: SIZE,
    height: SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
});
