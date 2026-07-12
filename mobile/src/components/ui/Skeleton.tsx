import { useEffect, useRef } from "react";
import { Animated, type ViewStyle } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";

export function Skeleton({ style }: { style?: ViewStyle | ViewStyle[] }) {
  const { colors, radius } = useTheme();
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.5,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        { backgroundColor: colors.muted, borderRadius: radius.md, opacity },
        style,
      ]}
    />
  );
}
