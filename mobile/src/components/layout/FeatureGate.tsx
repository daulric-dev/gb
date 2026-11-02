import type { ComponentType } from "react";
import { useRouter } from "expo-router";
import { PowerOff } from "lucide-react-native";
import { useAuth } from "@/providers/AuthProvider";
import { resolveFeatures, type FeatureKey, type FeatureMap } from "@/lib/features";
import { isStudentProfile } from "@/lib/routing";
import { Screen } from "@/components/layout/Screen";
import { EmptyState } from "@/components/ui/EmptyState";

type FeatureRule =
  | FeatureKey
  | ((features: FeatureMap, isStudent: boolean) => boolean);

/** Shown in place of a screen whose feature the school has switched off. */
export function FeatureDisabledScreen({ title }: { title: string }) {
  const router = useRouter();
  return (
    <Screen
      title={title}
      onBack={router.canGoBack() ? () => router.back() : undefined}
    >
      <EmptyState
        icon={PowerOff}
        title="This feature is turned off for your school"
        description="Your school or organisation has switched it off. Ask an administrator if you need it."
      />
    </Screen>
  );
}

/**
 * Wraps a route screen so opening it (a deep link, a push, a stale stack)
 * while its feature is off shows the "turned off" state instead.
 */
export function withFeature<P extends object>(
  rule: FeatureRule,
  title: string,
  Component: ComponentType<P>,
): ComponentType<P> {
  function Gated(props: P) {
    const { profile } = useAuth();
    const features = resolveFeatures(profile?.features);
    const on =
      typeof rule === "function"
        ? rule(features, isStudentProfile(profile))
        : features[rule];
    if (!on) return <FeatureDisabledScreen title={title} />;
    return <Component {...props} />;
  }
  Gated.displayName = `withFeature(${Component.displayName ?? Component.name})`;
  return Gated;
}

/** Chat: students need student messaging, staff need messaging. */
export const chatAllowed = (features: FeatureMap, isStudent: boolean) =>
  isStudent ? features.student_messaging : features.messaging;
