import { useAuth } from "@/providers/AuthProvider";
import { resolveFeatures, type FeatureKey, type FeatureMap } from "@/lib/features";

/** The signed-in user's effective features, with the fallback applied. */
export function useFeatures(): {
  features: FeatureMap;
  hasFeature: (key: FeatureKey) => boolean;
} {
  const { profile } = useAuth();
  const features = resolveFeatures(profile?.features);
  return { features, hasFeature: (key) => features[key] };
}
