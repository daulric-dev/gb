import { useState, useCallback, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  fetchGithubReleases,
  downloadReleaseArchive,
  verifyReleaseChecksum,
  extractAndUpgradeInstance,
} from "./useIpc";
import type { GitHubRelease, UpgradeProgress } from "@/types/releases";
import type { UpgradeProgressInfo } from "./useInstances";

export function useReleases(owner: string, repo: string) {
  const [releases, setReleases] = useState<GitHubRelease[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UpgradeProgress | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<UpgradeProgressInfo>("upgrade-progress", (event) => {
      const payload = event.payload;
      if (!payload) return;
      if (payload.stage === "complete") {
        setProgress({
          step: "done",
          message: payload.detail || "Upgrade completed successfully!",
          percent: 100,
        });
      } else if (payload.stage === "error") {
        setProgress({
          step: "error",
          message: payload.detail || "Upgrade failed",
          percent: 0,
        });
      } else {
        setProgress({
          step: "upgrading",
          message: `[Step ${payload.step}/${payload.total_steps}] ${payload.title}: ${payload.detail}`,
          percent: payload.percent,
        });
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const fetchReleases = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGithubReleases(owner, repo);
      setReleases(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [owner, repo]);

  const upgrade = useCallback(
    async (
      instanceId: string,
      instanceRoot: string,
      downloadUrl: string,
      sha256?: string,
      filename = "release.zip"
    ) => {
      setProgress({ step: "downloading", message: "Downloading release archive…", percent: 10 });
      let zipPath: string;
      try {
        zipPath = await downloadReleaseArchive(downloadUrl, instanceRoot, filename);
      } catch (e) {
        setProgress({ step: "error", message: `Download failed: ${e}`, percent: 0 });
        return;
      }

      if (sha256) {
        setProgress({ step: "verifying", message: "Verifying checksum…", percent: 40 });
        try {
          const valid = await verifyReleaseChecksum(zipPath, sha256);
          if (!valid) {
            setProgress({ step: "error", message: "Checksum verification failed!", percent: 0 });
            return;
          }
        } catch (e) {
          setProgress({ step: "error", message: `Verification error: ${e}`, percent: 0 });
          return;
        }
      }

      setProgress({ step: "upgrading", message: "Extracting and upgrading instance…", percent: 70 });
      try {
        const result = await extractAndUpgradeInstance(instanceId, instanceRoot, zipPath);
        setProgress({ step: "done", message: result, percent: 100 });
      } catch (e) {
        setProgress({ step: "error", message: `Upgrade failed: ${e}`, percent: 0 });
      }
    },
    []
  );

  const clearProgress = useCallback(() => setProgress(null), []);

  return { releases, loading, error, progress, fetchReleases, upgrade, clearProgress };
}
