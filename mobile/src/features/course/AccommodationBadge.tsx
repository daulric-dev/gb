import { View } from "react-native";
import { Accessibility } from "lucide-react-native";
import { Badge } from "@/components/ui/Badge";
import { useTheme } from "@/theme/ThemeProvider";
import { accommodationBadges, type AccommodationSummary } from "@/lib/accommodations";

/** "×1.5 time" and "No lockdown" under a student on a quiz roster (read-only). */
export function AccommodationBadge({ accommodation }: { accommodation?: AccommodationSummary | null; }) {
  const { colors } = useTheme();
  const labels = accommodationBadges(accommodation);
  if (labels.length === 0) return null;
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}
      accessible
      accessibilityLabel={`Accommodation: ${labels.join(", ")}`}
    >
      <Accessibility color={colors.mutedForeground} size={12} />
      {labels.map((label) => (
        <Badge key={label} variant="outline">
          {label}
        </Badge>
      ))}
    </View>
  );
}
