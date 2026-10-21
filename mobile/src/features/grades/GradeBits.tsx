import { StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { Badge } from "@/components/ui/Badge";
import { gradeColor } from "@/lib/grades";

/** Letter grade pill, outlined in the grade band's colour. */
export function LetterBadge({
  letter,
  percent,
}: {
  letter: string | null | undefined;
  percent: number | null | undefined;
}) {
  const color = gradeColor(percent);
  if (!letter || !color) return null;
  return (
    <Badge variant="outline" color={color}>
      {letter}
    </Badge>
  );
}

/** Thin horizontal bar filled to `percent` (0-100) in the grade band colour. */
export function GradeBar({
  percent,
  height = 6,
}: {
  percent: number | null | undefined;
  height?: number;
}) {
  const { colors } = useTheme();
  const color = gradeColor(percent);
  const width = Math.max(0, Math.min(100, percent ?? 0));
  return (
    <View
      style={[
        styles.track,
        { backgroundColor: colors.muted, height, borderRadius: height / 2 },
      ]}
    >
      {color && width > 0 ? (
        <View
          style={{
            width: `${width}%`,
            height,
            borderRadius: height / 2,
            backgroundColor: color,
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { overflow: "hidden", alignSelf: "stretch" },
});
