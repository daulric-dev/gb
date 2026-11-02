"use client";

import { useProfile } from "@/providers/AuthProvider";
import {
  resolveFeatures,
  type FeatureKey,
  type FeatureMap,
} from "@/lib/features";

/**
 * The effective feature switches for the signed-in user's active school,
 * with the older-server fallback applied (see `resolveFeatures`).
 */
export function useFeatures(): {
  features: FeatureMap;
  hasFeature: (key: FeatureKey) => boolean;
} {
  const { profile } = useProfile();
  const features = resolveFeatures(profile.value?.features);
  return { features, hasFeature: (key) => features[key] };
}
