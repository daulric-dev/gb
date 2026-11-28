/**
 * useInstances.ts — re-exports from InstancesContext.
 * The hook and all shared types now live in InstancesContext.tsx so the state
 * is managed by a single React Context provider, eliminating duplicate polling
 * intervals and cascading re-renders when multiple components called this hook.
 */
export {
  useInstances,
  InstancesProvider,
  cleanVersion,
  compareSemver,
} from "./InstancesContext";
export type {
  InstanceWithStatus,
  UpgradeProgressInfo,
  InstancesContextValue,
} from "./InstancesContext";
