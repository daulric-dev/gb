import { useState, useEffect } from "react";
import { useInstances } from "@/hooks/useInstances";
import { useReleases } from "@/hooks/useReleases";
import { Card } from "@/components/m3/Card";
import { Button } from "@/components/m3/Button";
import { Chip } from "@/components/m3/Chip";
import {
  Loader2,
  RefreshCw,
  Download,
  CheckCircle2,
  AlertTriangle,
  Tag,
  Calendar,
  PackageCheck,
} from "lucide-react";
import type { GitHubRelease } from "@/types/releases";

const OWNER = "daulric";
const REPO = "gb";

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-[var(--md-sys-color-surface-variant)]">
      <div
        className="h-1.5 rounded-full bg-[var(--md-sys-color-primary)] transition-all duration-300"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function ReleaseCard({
  release,
  currentVersion,
  onUpgrade,
}: {
  release: GitHubRelease;
  currentVersion?: string;
  onUpgrade: (release: GitHubRelease) => void;
}) {
  const isInstalled = currentVersion === release.tag_name.replace(/^v/, "");
  const publishDate = new Date(release.published_at);

  const zipAsset = release.assets.find((a) =>
    a.name.endsWith(".zip") && !a.name.includes("debug")
  );

  return (
    <Card variant={isInstalled ? "filled" : "outlined"} className="p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Tag size={15} className="text-[var(--md-sys-color-primary)]" />
            <span className="font-semibold text-[var(--md-sys-color-on-surface)]">
              {release.tag_name}
            </span>
            {isInstalled && (
              <Chip variant="filter" label="Installed" selected />
            )}
            {release.prerelease && (
              <Chip variant="assist" label="Pre-release" />
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-[var(--md-sys-color-on-surface-variant)]">
            <span className="flex items-center gap-1">
              <Calendar size={12} /> {publishDate.toLocaleDateString()}
            </span>
            {zipAsset && (
              <span>{(zipAsset.size / 1_000_000).toFixed(1)} MB</span>
            )}
          </div>
        </div>
        {!isInstalled && zipAsset && (
          <Button variant="tonal" onClick={() => onUpgrade(release)}>
            <Download size={15} className="mr-1" /> Install
          </Button>
        )}
      </div>
      {release.body && (
        <details className="text-xs text-[var(--md-sys-color-on-surface-variant)] cursor-pointer">
          <summary className="font-medium cursor-pointer select-none">Release notes</summary>
          <pre className="mt-2 whitespace-pre-wrap font-sans leading-relaxed max-h-48 overflow-y-auto">
            {release.body}
          </pre>
        </details>
      )}
    </Card>
  );
}

export function ReleasesView() {
  const { instances } = useInstances();
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const selectedInstance = instances.find((i) => i.id === selectedInstanceId) ?? null;

  const { releases, loading, error, progress, fetchReleases, upgrade, clearProgress } =
    useReleases(OWNER, REPO);

  useEffect(() => {
    fetchReleases();
  }, [fetchReleases]);

  const handleUpgrade = async (release: GitHubRelease) => {
    if (!selectedInstance) return;
    const zipAsset = release.assets.find((a) => a.name.endsWith(".zip") && !a.name.includes("debug"));
    if (!zipAsset) return;
    await upgrade(selectedInstance.root_path, zipAsset.browser_download_url, undefined, zipAsset.name);
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      {/* Instance selector */}
      <Card variant="filled" className="p-4 flex flex-wrap gap-2 items-center">
        <span className="text-sm font-medium text-[var(--md-sys-color-on-surface-variant)] mr-2">
          Target:
        </span>
        {instances.length === 0 ? (
          <span className="text-sm text-[var(--md-sys-color-on-surface-variant)]">
            No instances registered. Add one first.
          </span>
        ) : (
          instances.map((inst) => (
            <Chip
              key={inst.id}
              variant="filter"
              label={`${inst.name} (v${inst.version})`}
              selected={selectedInstanceId === inst.id}
              onClick={() => setSelectedInstanceId(inst.id)}
            />
          ))
        )}
      </Card>

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--md-sys-color-on-surface-variant)]">
          {releases.length} release{releases.length !== 1 ? "s" : ""} from GitHub
        </p>
        <Button variant="text" onClick={fetchReleases} disabled={loading}>
          <RefreshCw size={16} className={loading ? "animate-spin mr-1" : "mr-1"} />
          Refresh
        </Button>
      </div>

      {/* Upgrade progress */}
      {progress && (
        <Card variant="filled" className="p-5 flex flex-col gap-3">
          <div className="flex items-center gap-2 font-medium">
            {progress.step === "done" ? (
              <CheckCircle2 size={18} className="text-[var(--md-sys-color-primary)]" />
            ) : progress.step === "error" ? (
              <AlertTriangle size={18} className="text-[var(--md-sys-color-error)]" />
            ) : (
              <Loader2 size={18} className="animate-spin text-[var(--md-sys-color-primary)]" />
            )}
            {progress.message}
          </div>
          <ProgressBar percent={progress.percent} />
          {(progress.step === "done" || progress.step === "error") && (
            <Button variant="text" onClick={clearProgress}>Dismiss</Button>
          )}
        </Card>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)] p-4 text-sm flex items-center gap-2">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {/* Loading */}
      {loading && releases.length === 0 && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-24 rounded-2xl bg-[var(--md-sys-color-surface-variant)] animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && releases.length === 0 && !error && (
        <Card variant="filled" className="p-10 flex flex-col items-center gap-4 text-center">
          <PackageCheck size={40} className="text-[var(--md-sys-color-on-surface-variant)]" />
          <p className="text-[var(--md-sys-color-on-surface-variant)]">
            No releases found for <code>{OWNER}/{REPO}</code>.
          </p>
        </Card>
      )}

      {/* Release list */}
      {releases.map((release) => (
        <ReleaseCard
          key={release.id}
          release={release}
          currentVersion={selectedInstance?.version}
          onUpgrade={handleUpgrade}
        />
      ))}
    </div>
  );
}
