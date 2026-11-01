import { Image, StyleSheet, View, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { Text } from "@/components/ui/Text";
import { bannerStops, type CourseAppearance } from "./appearance";

/**
 * A course's banner: its cover image under a dark overlay, else its colour
 * preset, else the id-derived gradient (the same rules as the web app).
 * `children` sit on top in white. Set by staff on the web app.
 */
export function CourseBanner({
  course,
  height = 88,
  style,
  children,
}: {
  course: CourseAppearance;
  height?: number;
  style?: ViewStyle;
  children?: React.ReactNode;
}) {
  return (
    <View style={[styles.banner, { height }, style]}>
      <BannerFill course={course} />
      {children ? <View style={styles.content}>{children}</View> : null}
    </View>
  );
}

/** A small square of the banner, for course rows. */
export function CourseThumb({
  course,
  size = 40,
}: {
  course: CourseAppearance;
  size?: number;
}) {
  return (
    <View style={[styles.thumb, { width: size, height: size }]}>
      <BannerFill course={course} subtle />
    </View>
  );
}

/** White text for use on a banner. */
export function BannerText(props: React.ComponentProps<typeof Text>) {
  return <Text {...props} style={[{ color: "#fff" }, props.style]} />;
}

function BannerFill({
  course,
  subtle,
}: {
  course: CourseAppearance;
  subtle?: boolean;
}) {
  const { from, to } = bannerStops(course);
  const gid = `banner-${course.id}`;
  return (
    <>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={from} />
            <Stop offset="1" stopColor={to} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${gid})`} />
      </Svg>
      {course.bannerImageUrl ? (
        <>
          <Image
            source={{ uri: course.bannerImageUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
          {!subtle && (
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.4)" }]}
            />
          )}
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  banner: { borderRadius: 14, overflow: "hidden", justifyContent: "flex-end" },
  content: { padding: 14, gap: 2 },
  thumb: { borderRadius: 10, overflow: "hidden" },
});
