import { useState, useCallback, useEffect, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useInstances, compareSemver } from "@/hooks/useInstances";
import { Card } from "@/components/m3/Card";
import { Button } from "@/components/m3/Button";
import { Chip } from "@/components/m3/Chip";
import {
  Plus,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  FolderOpen,
  Trash2,
  Info,
  Package,
  Terminal,
  AlertTriangle,
  Play,
  Square,
  ExternalLink,
  Layers,
  Pencil,
  Check,
  X,
  ArrowUpCircle,
  Sparkles,
  Search,
} from "lucide-react";
import type { InstanceConfig, InstanceScanResult } from "@/types/instance";
import type { GitHubRelease } from "@/types/releases";

function StatusDot({ online }: { online?: boolean | null }) {
  if (online === null || online === undefined)
    return <Loader2 size={14} className="animate-spin text-[var(--md-sys-color-outline)]" />;
  if (online)
    return <CheckCircle2 size={14} className="text-[var(--md-sys-color-primary)]" />;
  return <XCircle size={14} className="text-[var(--md-sys-color-error)]" />;
}

interface LiveTerminalModalProps {
  title: string;
  subtitle?: string;
  instanceName: string;
  instanceId: string;
  service: string;
  isRunning?: boolean;
  onClose: () => void;
  fetchLogs: (id: string, s: string) => Promise<string[]>;
}

function LiveTerminalModal({
  title,
  subtitle,
  instanceName,
  instanceId,
  service,
  isRunning,
  onClose,
  fetchLogs,
}: LiveTerminalModalProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const lines = await fetchLogs(instanceId, service);
      setLogs(lines);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [instanceId, service, fetchLogs]);

  useEffect(() => {
    load();
    const intervalMs = isRunning ? 800 : 2500;
    const timer = setInterval(load, intervalMs);
    return () => clearInterval(timer);
  }, [load, isRunning]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(3px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-[850px] h-[580px] rounded-[24px] flex flex-col shadow-2xl overflow-hidden border border-[var(--md-sys-color-outline-variant)]/50"
        style={{ background: "var(--md-sys-color-surface-container-high)" }}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between border-b border-[var(--md-sys-color-outline-variant)]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-primary)]">
              <Terminal size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-[var(--md-sys-color-on-surface)] text-base">
                  {title}
                </h3>
                {isRunning ? (
                  <Chip
                    variant="assist"
                    icon={<Loader2 size={12} className="animate-spin text-amber-500" />}
                    className="text-amber-500 border-amber-500/30 text-xs py-0.5"
                  >
                    Running
                  </Chip>
                ) : (
                  <Chip variant="assist" className="text-xs py-0.5">
                    Completed / Idle
                  </Chip>
                )}
              </div>
              <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] mt-0.5">
                {instanceName} {subtitle ? `• ${subtitle}` : ""}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={autoScroll ? "tonal" : "text"}
              size="sm"
              onClick={() => setAutoScroll((prev) => !prev)}
              title="Toggle auto-scrolling to newest logs"
            >
              Auto-scroll {autoScroll ? "ON" : "OFF"}
            </Button>
            <Button variant="text" size="sm" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin mr-1" : "mr-1"} />
              Refresh
            </Button>
            <Button variant="text" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        {/* Terminal Log Output */}
        <div
          ref={logContainerRef}
          className="flex-1 p-4 bg-[#0a0e14] overflow-y-auto font-mono text-xs select-text leading-relaxed space-y-1"
        >
          {logs.length === 0 ? (
            <p className="text-gray-500 italic py-4 text-center">
              No log output recorded yet for this process. Logs will appear here in real-time.
            </p>
          ) : (
            logs.map((line, idx) => {
              const isStep = line.startsWith("[1/") || line.startsWith("[2/") || line.startsWith("[3/") || line.startsWith("[4/") || line.startsWith("[5/");
              const isSuccess = line.includes("✓") || line.includes("successfully") || line.includes("complete");
              const isError = line.toLowerCase().includes("error") || line.toLowerCase().includes("fail") || line.includes("✗");
              const isInfo = line.startsWith("[Gradebook Manager]") || line.startsWith("[info]");

              let textColor = "text-green-400";
              if (isStep) textColor = "text-cyan-400 font-semibold";
              else if (isSuccess) textColor = "text-emerald-300 font-medium";
              else if (isError) textColor = "text-red-400 font-semibold";
              else if (isInfo) textColor = "text-blue-300 font-medium";

              return (
                <div
                  key={idx}
                  className={`whitespace-pre-wrap break-all hover:bg-white/5 py-0.5 px-1 rounded flex items-start gap-2 ${textColor}`}
                >
                  <span className="text-gray-600 select-none w-7 text-right shrink-0">
                    {idx + 1}
                  </span>
                  <span className="flex-1">{line}</span>
                </div>
              );
            })
          )}
        </div>

        {/* Status Footer */}
        <div className="px-6 py-2.5 bg-[#070a0e] text-gray-400 text-[11px] flex items-center justify-between border-t border-gray-800">
          <span>{logs.length} lines logged</span>
          <span className="flex items-center gap-1.5">
            <span
              className={`size-2 rounded-full ${isRunning ? "bg-amber-400 animate-ping" : "bg-emerald-500"}`}
            />
            {isRunning ? "Live process streaming output…" : "Process inactive"}
          </span>
        </div>
      </div>
    </div>
  );
}

function AddInstanceDialog({
  onAdd,
  onClose,
}: {
  onAdd: (config: InstanceConfig) => Promise<void>;
  onClose: () => void;
}) {
  const { scan } = useInstances();
  const [path, setPath] = useState("");
  const [scan_result, setScanResult] = useState<InstanceScanResult | null>(null);
  const [name, setName] = useState("");
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doScan = useCallback(
    async (pathToScan?: string) => {
      const targetPath = (typeof pathToScan === "string" ? pathToScan : path).trim();
      if (!targetPath) return;
      setScanning(true);
      setError(null);
      try {
        const result = await scan(targetPath);
        setScanResult(result);
        if (!result.valid && result.error) setError(result.error);
        if (result.valid && !name && targetPath) {
          setName(targetPath.split("/").filter(Boolean).pop() || "Gradebook Instance");
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setScanning(false);
      }
    },
    [path, scan, name]
  );

  const browse = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select Gradebook root",
    });
    if (selected && typeof selected === "string") {
      setPath(selected);
      setScanResult(null);
      setError(null);
      // Automatically scan immediately upon choosing directory
      doScan(selected);
    }
  };

  const doAdd = async () => {
    if (!scan_result?.valid || !name) return;
    setSaving(true);
    const now = new Date().toISOString();
    const config: InstanceConfig = {
      id: crypto.randomUUID(),
      name,
      version: scan_result.version || "unknown",
      root_path: path,
      backend_url: "http://localhost:3001",
      frontend_url: "http://localhost:3000",
      created_at: now,
      updated_at: now,
    };
    try {
      await onAdd(config);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-[560px] rounded-[28px] flex flex-col gap-0 shadow-2xl overflow-hidden"
        style={{ background: "var(--md-sys-color-surface-container-high)" }}
      >
        <div className="px-6 pt-6 pb-4">
          <h2 className="text-2xl font-semibold text-[var(--md-sys-color-on-surface)]">
            Add Gradebook Instance
          </h2>
          <p className="text-sm text-[var(--md-sys-color-on-surface-variant)] mt-1">
            Point to your Gradebook root directory to manage it
          </p>
        </div>

        <div className="px-6 flex flex-col gap-4 pb-4">
          <div className="flex gap-2 items-center">
            <div className="flex-1">
              <label className="block text-xs font-medium text-[var(--md-sys-color-on-surface-variant)] mb-1 ml-1">
                Root Directory Path
              </label>
              <input
                type="text"
                value={path}
                onChange={(e) => {
                  setPath(e.target.value);
                  setScanResult(null);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") doScan();
                }}
                placeholder="/path/to/gradebook"
                className="w-full h-10 px-3 rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-highest)] text-sm text-[var(--md-sys-color-on-surface)] outline-none focus:border-[var(--md-sys-color-primary)] font-mono"
              />
            </div>
            <div className="pt-5 flex items-center gap-1.5">
              <Button variant="tonal" onClick={browse} disabled={scanning}>
                <FolderOpen size={16} className="mr-1" /> Browse
              </Button>
              <Button
                variant="filled"
                onClick={() => doScan()}
                disabled={!path.trim() || scanning}
                title="Scan directory for Gradebook services"
              >
                {scanning ? (
                  <Loader2 size={16} className="animate-spin mr-1" />
                ) : (
                  <Search size={16} className="mr-1" />
                )}
                Scan Directory
              </Button>
            </div>
          </div>

          {scanning && (
            <div className="flex items-center gap-2 text-xs text-[var(--md-sys-color-on-surface-variant)]">
              <Loader2 size={14} className="animate-spin text-[var(--md-sys-color-primary)]" />
              Scanning directory…
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)] text-xs flex items-center gap-2">
              <AlertTriangle size={16} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {scan_result?.valid && (
            <div className="p-3.5 rounded-xl bg-[var(--md-sys-color-surface-container-highest)] flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-500">
                <CheckCircle2 size={16} /> Valid Gradebook installation detected
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-[var(--md-sys-color-on-surface-variant)]">
                <div>
                  Version: <strong>{scan_result.version || "unknown"}</strong>
                </div>
                <div>
                  Packages: <strong>{scan_result.has_node_modules ? "✓ Installed" : "✗ Missing"}</strong>
                </div>
                <div>
                  Backend: <strong>{scan_result.has_backend ? "✓ Found" : "✗ Missing"}</strong>
                </div>
                <div>
                  Frontend: <strong>{scan_result.has_frontend ? "✓ Found" : "✗ Missing"}</strong>
                </div>
              </div>

              <div className="mt-2">
                <label className="block text-xs font-medium text-[var(--md-sys-color-on-surface-variant)] mb-1">
                  Instance Display Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Gradebook Production"
                  className="w-full h-9 px-3 rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface)] text-sm text-[var(--md-sys-color-on-surface)] outline-none focus:border-[var(--md-sys-color-primary)]"
                />
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 flex justify-end gap-2 border-t border-[var(--md-sys-color-outline-variant)]">
          <Button variant="text" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="filled"
            onClick={doAdd}
            disabled={!scan_result?.valid || !name || saving}
          >
            {saving ? <Loader2 size={16} className="animate-spin mr-1" /> : null}
            Save Instance
          </Button>
        </div>
      </div>
    </div>
  );
}

export function InstancesView() {
  const {
    instances,
    systemEnv,
    serviceStatuses,
    latestRelease,
    latestVersion,
    loading,
    installingFor,
    upgradingFor,
    error,
    refresh,
    save,
    installInFolder,
    upgradeInstance,
    startAppService,
    stopAppService,
    fetchLogs,
    remove,
  } = useInstances();

  const [showAdd, setShowAdd] = useState(false);
  const [activeTerminal, setActiveTerminal] = useState<{
    instanceId: string;
    instanceName: string;
    service: string;
    title: string;
    subtitle?: string;
    isRunning?: boolean;
  } | null>(null);

  const [actionMsg, setActionMsg] = useState<{ id: string; msg: string; isError?: boolean } | null>(
    null
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>("");

  const handleStartEdit = (inst: InstanceConfig) => {
    setEditingId(inst.id);
    setEditingName(inst.name);
  };

  const handleSaveName = async (inst: InstanceConfig) => {
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === inst.name) {
      setEditingId(null);
      return;
    }
    try {
      await save({
        ...inst,
        name: trimmed,
        updated_at: new Date().toISOString(),
      });
      setEditingId(null);
    } catch (e) {
      setActionMsg({ id: inst.id, msg: `Failed to update name: ${e}`, isError: true });
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingName("");
  };

  const handleInstallFolder = async (
    inst: InstanceConfig,
    service: "backend" | "frontend" | "all"
  ) => {
    setActionMsg(null);
    const serviceLabel =
      service === "all"
        ? "All Folders (backend, frontend, root)"
        : service === "backend"
        ? "Backend (backend/)"
        : "Frontend (frontend/)";

    // Open terminal modal immediately to stream live logs
    setActiveTerminal({
      instanceId: inst.id,
      instanceName: inst.name,
      service: "install",
      title: `Installing Packages — ${serviceLabel}`,
      subtitle: `Running bun install in ${service}`,
      isRunning: true,
    });

    try {
      const res = await installInFolder(inst.id, inst.root_path, service);
      setActionMsg({ id: inst.id, msg: res });
      // Keep modal open, mark as finished
      setActiveTerminal((prev) =>
        prev && prev.instanceId === inst.id && prev.service === "install"
          ? { ...prev, isRunning: false }
          : prev
      );
    } catch (e) {
      setActionMsg({ id: inst.id, msg: String(e), isError: true });
      setActiveTerminal((prev) =>
        prev && prev.instanceId === inst.id && prev.service === "install"
          ? { ...prev, isRunning: false }
          : prev
      );
    }
  };

  const handleStartUpgrade = async (inst: InstanceConfig, release: GitHubRelease) => {
    setActionMsg(null);
    // Open terminal modal immediately to stream live upgrade logs
    setActiveTerminal({
      instanceId: inst.id,
      instanceName: inst.name,
      service: "upgrade",
      title: `Upgrading to ${release.tag_name}`,
      subtitle: `Extracting archive, backing up data, migrating codebase`,
      isRunning: true,
    });

    try {
      const res = await upgradeInstance(inst.id, inst.root_path, release);
      setActionMsg({ id: inst.id, msg: res });
      setActiveTerminal((prev) =>
        prev && prev.instanceId === inst.id && prev.service === "upgrade"
          ? { ...prev, isRunning: false }
          : prev
      );
    } catch (e) {
      setActionMsg({ id: inst.id, msg: String(e), isError: true });
      setActiveTerminal((prev) =>
        prev && prev.instanceId === inst.id && prev.service === "upgrade"
          ? { ...prev, isRunning: false }
          : prev
      );
    }
  };

  const handleStartService = async (inst: InstanceConfig, service: "backend" | "frontend") => {
    setActionMsg(null);
    try {
      const res = await startAppService(inst.id, inst.root_path, service);
      setActionMsg({ id: inst.id, msg: res });
    } catch (e) {
      setActionMsg({ id: inst.id, msg: String(e), isError: true });
    }
  };

  const handleStopService = async (inst: InstanceConfig, service: "backend" | "frontend") => {
    setActionMsg(null);
    try {
      const res = await stopAppService(inst.id, service);
      setActionMsg({ id: inst.id, msg: res });
    } catch (e) {
      setActionMsg({ id: inst.id, msg: String(e), isError: true });
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      {/* Bun System Environment Banner */}
      {systemEnv && !systemEnv.has_bun && (
        <Card
          variant="filled"
          className="p-4 bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)] flex items-center gap-3"
        >
          <AlertTriangle size={24} className="shrink-0 text-[var(--md-sys-color-error)]" />
          <div className="flex-1 text-sm">
            <p className="font-semibold">Bun runtime not detected</p>
            <p className="text-xs opacity-90 mt-0.5">
              Gradebook requires <strong>Bun</strong> (v1.1+) to install packages and run local
              backend & frontend services.
            </p>
          </div>
          <Button
            variant="tonal"
            size="sm"
            onClick={() => window.open("https://bun.sh", "_blank")}
          >
            Get Bun
          </Button>
        </Card>
      )}

      {/* PM2 missing warning */}
      {systemEnv && systemEnv.has_bun && !systemEnv.has_pm2 && (
        <Card
          variant="filled"
          className="p-4 bg-amber-500/10 border border-amber-500/30 flex items-center gap-3 rounded-2xl"
        >
          <AlertTriangle size={22} className="shrink-0 text-amber-500" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-amber-600 dark:text-amber-400">PM2 process manager not detected</p>
            <p className="text-xs opacity-90 mt-0.5 text-amber-700 dark:text-amber-300">
              Services are managed via <strong>PM2</strong>. Install it with:{" "}
              <code className="bg-black/10 px-1.5 py-0.5 rounded font-mono">bun add -g pm2</code>
            </p>
          </div>
          <Button
            variant="tonal"
            size="sm"
            onClick={() => window.open("https://pm2.keymetrics.io", "_blank")}
          >
            PM2 Docs
          </Button>
        </Card>
      )}

      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <p className="text-sm text-[var(--md-sys-color-on-surface-variant)]">
            {instances.length} registered instance{instances.length !== 1 ? "s" : ""}
          </p>
          {systemEnv?.has_bun && (
            <Chip variant="assist" icon={<Terminal size={12} />}>
              Bun {systemEnv.bun_version}
            </Chip>
          )}
          {systemEnv?.has_pm2 && (
            <Chip
              variant="assist"
              icon={<CheckCircle2 size={12} className="text-emerald-500" />}
            >
              PM2 {systemEnv.pm2_version}
            </Chip>
          )}
          {latestVersion && (
            <Chip
              variant="assist"
              icon={<Sparkles size={12} className="text-[var(--md-sys-color-primary)]" />}
            >
              Latest GitHub Release: v{latestVersion}
            </Chip>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="text" onClick={refresh} disabled={loading}>
            <RefreshCw size={16} className={loading ? "animate-spin mr-1" : "mr-1"} />
            Refresh
          </Button>
          <Button variant="filled" onClick={() => setShowAdd(true)}>
            <Plus size={16} className="mr-1" /> Add Instance
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)] p-4 text-sm">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && instances.length === 0 && (
        <div className="flex flex-col gap-3">
          {[1, 2].map((n) => (
            <div
              key={n}
              className="h-28 rounded-2xl bg-[var(--md-sys-color-surface-variant)] animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && instances.length === 0 && !error && (
        <Card variant="filled" className="p-10 flex flex-col items-center gap-4 text-center">
          <Info size={40} className="text-[var(--md-sys-color-on-surface-variant)]" />
          <p className="text-[var(--md-sys-color-on-surface-variant)]">
            No instances registered yet. Click <strong>Add Instance</strong> to get started.
          </p>
        </Card>
      )}

      {/* Instance cards */}
      {instances.map((inst) => {
        const status = serviceStatuses[inst.id] || {
          backend: { running: false, pid: null },
          frontend: { running: false, pid: null },
        };
        const isBackendRunning = status.backend.running;
        const isFrontendRunning = status.frontend.running;

        const isInstallingThis = installingFor?.startsWith(inst.id);
        const isUpgradingThis = upgradingFor === inst.id;

        const hasUpdate = Boolean(latestVersion && compareSemver(latestVersion, inst.version) > 0);
        const isUpToDate = Boolean(
          latestVersion && compareSemver(latestVersion, inst.version) === 0
        );

        return (
          <Card key={inst.id} variant="elevated" className="p-5 flex flex-col gap-4">
            {/* Active Operation Alert Banner (if running in background) */}
            {(isInstallingThis || isUpgradingThis) && (
              <div className="px-4 py-2.5 rounded-xl bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)] flex items-center justify-between gap-3 text-xs font-medium animate-pulse">
                <div className="flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  <span>
                    {isUpgradingThis
                      ? `Upgrading instance to v${latestVersion}…`
                      : `Installing packages in progress…`}
                  </span>
                </div>
                <Button
                  variant="tonal"
                  size="sm"
                  onClick={() =>
                    setActiveTerminal({
                      instanceId: inst.id,
                      instanceName: inst.name,
                      service: isUpgradingThis ? "upgrade" : "install",
                      title: isUpgradingThis ? `Upgrading to v${latestVersion}` : "Installing Packages",
                      isRunning: true,
                    })
                  }
                >
                  <Terminal size={12} className="mr-1" /> View Live Logs
                </Button>
              </div>
            )}

            {/* Directory / Service Missing Warnings */}
            {inst.root_exists === false && (
              <div className="px-4 py-3 rounded-xl bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)] flex items-start gap-3 text-xs">
                <AlertTriangle size={18} className="shrink-0 text-[var(--md-sys-color-error)] mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold text-sm">Directory Not Found on Disk</p>
                  <p className="opacity-90 mt-0.5">
                    The folder at <code className="bg-black/10 px-1 rounded font-mono">{inst.root_path}</code> was deleted, moved, or renamed in your file explorer. All services (backend and frontend) are unavailable.
                  </p>
                </div>
              </div>
            )}

            {inst.root_exists === true && (inst.has_backend === false || inst.has_frontend === false) && (
              <div className="px-4 py-3 rounded-xl bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)] flex items-start gap-3 text-xs">
                <AlertTriangle size={18} className="shrink-0 text-[var(--md-sys-color-error)] mt-0.5" />
                <div className="flex-1">
                  <p className="font-semibold text-sm">Service Folders Missing</p>
                  <p className="opacity-90 mt-0.5">
                    {inst.has_backend === false && inst.has_frontend === false
                      ? "Both backend/ and frontend/ folders were deleted from this directory."
                      : inst.has_backend === false
                      ? "The backend/ folder was deleted or missing from this directory."
                      : "The frontend/ folder was deleted or missing from this directory."}
                  </p>
                </div>
              </div>
            )}

            {/* Top header row */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusDot online={inst.online || isBackendRunning || isFrontendRunning} />

                  {editingId === inst.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveName(inst);
                          if (e.key === "Escape") handleCancelEdit();
                        }}
                        className="h-7 px-2 rounded-lg border border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-surface-container-highest)] font-semibold text-sm outline-none text-[var(--md-sys-color-on-surface)]"
                      />
                      <button
                        onClick={() => handleSaveName(inst)}
                        className="p-1 rounded-full hover:bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-primary)] transition-colors cursor-pointer"
                        title="Save name (Enter)"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={handleCancelEdit}
                        className="p-1 rounded-full hover:bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)] transition-colors cursor-pointer"
                        title="Cancel (Esc)"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 group/name">
                      <span className="text-base font-semibold text-[var(--md-sys-color-on-surface)]">
                        {inst.name}
                      </span>
                      <button
                        onClick={() => handleStartEdit(inst)}
                        className="opacity-0 group-hover/name:opacity-100 hover:opacity-100 p-1 rounded-full hover:bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)] transition-all cursor-pointer"
                        title="Edit display name"
                      >
                        <Pencil size={12} />
                      </button>
                    </div>
                  )}

                  {/* Version & Status Comparison */}
                  {isUpToDate ? (
                    <Chip
                      variant="assist"
                      icon={<CheckCircle2 size={12} className="text-emerald-500" />}
                      className="text-emerald-500 font-medium border-emerald-500/30"
                    >
                      Up to date (v{inst.version})
                    </Chip>
                  ) : hasUpdate ? (
                    <div className="flex items-center gap-1.5">
                      <Chip
                        variant="assist"
                        icon={<ArrowUpCircle size={12} className="text-amber-500" />}
                        className="text-amber-500 font-medium border-amber-500/30"
                      >
                        Update available: v{latestVersion} (Installed: v{inst.version})
                      </Chip>
                      {latestRelease && (
                        <Button
                          variant="tonal"
                          size="sm"
                          className="h-6 text-xs px-2.5 py-0 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20"
                          onClick={() => handleStartUpgrade(inst, latestRelease)}
                          disabled={isUpgradingThis || Boolean(installingFor)}
                          title={`Upgrade from v${inst.version} to v${latestVersion}`}
                        >
                          {isUpgradingThis ? (
                            <Loader2 size={11} className="animate-spin mr-1" />
                          ) : (
                            <ArrowUpCircle size={11} className="mr-1" />
                          )}
                          Upgrade to v{latestVersion}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <Chip variant="assist">{`v${inst.version}`}</Chip>
                  )}

                  {/* Packages Installed indicator */}
                  {isInstallingThis ? (
                    <Chip
                      variant="assist"
                      icon={<Loader2 size={12} className="animate-spin text-amber-500" />}
                      className="text-amber-500 border-amber-500/30 cursor-pointer"
                      onClick={() =>
                        setActiveTerminal({
                          instanceId: inst.id,
                          instanceName: inst.name,
                          service: "install",
                          title: "Installing Packages",
                          isRunning: true,
                        })
                      }
                    >
                      Installing packages…
                    </Chip>
                  ) : inst.has_node_modules ? (
                    <Chip
                      variant="assist"
                      icon={<Package size={12} className="text-[var(--md-sys-color-primary)]" />}
                    >
                      Packages ready
                    </Chip>
                  ) : (
                    <Chip
                      variant="assist"
                      icon={<AlertTriangle size={12} className="text-amber-500" />}
                    >
                      Packages missing
                    </Chip>
                  )}
                </div>

                <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] font-mono">
                  {inst.root_path}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outlined"
                  size="sm"
                  onClick={() => handleInstallFolder(inst, "all")}
                  disabled={
                    Boolean(installingFor) ||
                    isUpgradingThis ||
                    !systemEnv?.has_bun ||
                    inst.root_exists === false
                  }
                  title={
                    inst.root_exists === false
                      ? "Cannot install: directory not found on disk"
                      : "Install packages in all folders (backend, frontend, root)"
                  }
                >
                  {installingFor === `${inst.id}:all` ? (
                    <Loader2 size={13} className="animate-spin mr-1.5" />
                  ) : (
                    <Layers size={13} className="mr-1.5" />
                  )}
                  Install in All Folders
                </Button>
                <Button
                  variant="text"
                  onClick={() => remove(inst.id)}
                  className="text-[var(--md-sys-color-error)]"
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            </div>

            {/* Action Feedback Message */}
            {actionMsg && actionMsg.id === inst.id && (
              <div
                className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                  actionMsg.isError
                    ? "bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)]"
                    : "bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)]"
                }`}
              >
                {actionMsg.isError ? <XCircle size={14} /> : <CheckCircle2 size={14} />}
                <span>{actionMsg.msg}</span>
              </div>
            )}

            {/* Individual Folder Controls Section */}
            <div className="flex flex-col gap-2.5 p-3 rounded-2xl bg-[var(--md-sys-color-surface-container)]">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)]">
                Folder Services & Execution
              </span>

              {/* Backend Service Row */}
              <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline-variant)]/60">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`size-2.5 rounded-full ${
                      isBackendRunning ? "bg-green-500 animate-pulse" : "bg-gray-400"
                    }`}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--md-sys-color-on-surface)]">
                        Backend Service
                      </span>
                      <span className="text-[11px] font-mono text-[var(--md-sys-color-on-surface-variant)]">
                        (backend/)
                      </span>
                    </div>
                    <span className="text-xs text-[var(--md-sys-color-on-surface-variant)]">
                      {inst.has_backend === false || inst.root_exists === false ? (
                        <span className="text-[var(--md-sys-color-error)] font-medium">
                          Folder missing from disk (backend/)
                        </span>
                      ) : isBackendRunning ? (
                        `Running${status.backend.pid ? ` • PID ${status.backend.pid}` : ""} • ${inst.backend_url}`
                      ) : (
                        `Stopped • Port ${inst.backend_url.split(":").pop() || "3001"}`
                      )}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="text"
                    size="sm"
                    onClick={() => handleInstallFolder(inst, "backend")}
                    disabled={
                      Boolean(installingFor) ||
                      isUpgradingThis ||
                      isBackendRunning ||
                      inst.has_backend === false ||
                      inst.root_exists === false
                    }
                    title={
                      inst.has_backend === false || inst.root_exists === false
                        ? "backend/ directory does not exist on disk"
                        : "Run bun install inside backend/ folder"
                    }
                  >
                    {installingFor === `${inst.id}:backend` ? (
                      <Loader2 size={13} className="animate-spin mr-1" />
                    ) : (
                      <Package size={13} className="mr-1" />
                    )}
                    Install in backend/
                  </Button>

                  <Button
                    variant="text"
                    size="sm"
                    onClick={() =>
                      setActiveTerminal({
                        instanceId: inst.id,
                        instanceName: inst.name,
                        service: "backend",
                        title: "Backend Service Logs",
                        subtitle: "stdout / stderr output from backend/",
                        isRunning: isBackendRunning,
                      })
                    }
                    title="View live stdout/stderr logs"
                  >
                    <Terminal size={13} className="mr-1" /> Logs
                  </Button>

                  {isBackendRunning ? (
                    <Button
                      variant="tonal"
                      size="sm"
                      onClick={() => handleStopService(inst, "backend")}
                      className="text-[var(--md-sys-color-error)]"
                    >
                      <Square size={13} className="mr-1 fill-current" /> Stop
                    </Button>
                  ) : (
                    <Button
                      variant="filled"
                      size="sm"
                      onClick={() => handleStartService(inst, "backend")}
                      disabled={
                        !systemEnv?.has_bun ||
                        inst.has_backend === false ||
                        inst.root_exists === false
                      }
                      title={
                        inst.has_backend === false || inst.root_exists === false
                          ? "Cannot start: backend/ directory missing on disk"
                          : "Start backend service"
                      }
                    >
                      <Play size={13} className="mr-1 fill-current" /> Start
                    </Button>
                  )}
                </div>
              </div>

              {/* Frontend Service Row */}
              <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline-variant)]/60">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`size-2.5 rounded-full ${
                      isFrontendRunning ? "bg-green-500 animate-pulse" : "bg-gray-400"
                    }`}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[var(--md-sys-color-on-surface)]">
                        Frontend Service
                      </span>
                      <span className="text-[11px] font-mono text-[var(--md-sys-color-on-surface-variant)]">
                        (frontend/)
                      </span>
                    </div>
                    <span className="text-xs text-[var(--md-sys-color-on-surface-variant)]">
                      {inst.has_frontend === false || inst.root_exists === false ? (
                        <span className="text-[var(--md-sys-color-error)] font-medium">
                          Folder missing from disk (frontend/)
                        </span>
                      ) : isFrontendRunning ? (
                        `Running${status.frontend.pid ? ` • PID ${status.frontend.pid}` : ""} • ${inst.frontend_url}`
                      ) : (
                        `Stopped • Port ${inst.frontend_url.split(":").pop() || "3000"}`
                      )}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="text"
                    size="sm"
                    onClick={() => handleInstallFolder(inst, "frontend")}
                    disabled={
                      Boolean(installingFor) ||
                      isUpgradingThis ||
                      isFrontendRunning ||
                      inst.has_frontend === false ||
                      inst.root_exists === false
                    }
                    title={
                      inst.has_frontend === false || inst.root_exists === false
                        ? "frontend/ directory does not exist on disk"
                        : "Run bun install inside frontend/ folder"
                    }
                  >
                    {installingFor === `${inst.id}:frontend` ? (
                      <Loader2 size={13} className="animate-spin mr-1" />
                    ) : (
                      <Package size={13} className="mr-1" />
                    )}
                    Install in frontend/
                  </Button>

                  <Button
                    variant="text"
                    size="sm"
                    onClick={() =>
                      setActiveTerminal({
                        instanceId: inst.id,
                        instanceName: inst.name,
                        service: "frontend",
                        title: "Frontend Service Logs",
                        subtitle: "stdout / stderr output from frontend/",
                        isRunning: isFrontendRunning,
                      })
                    }
                    title="View live stdout/stderr logs"
                  >
                    <Terminal size={13} className="mr-1" /> Logs
                  </Button>

                  {isFrontendRunning && (
                    <Button
                      variant="tonal"
                      size="sm"
                      onClick={() => window.open(inst.frontend_url, "_blank")}
                      title="Open frontend in browser"
                    >
                      <ExternalLink size={13} className="mr-1" /> Open
                    </Button>
                  )}

                  {isFrontendRunning ? (
                    <Button
                      variant="tonal"
                      size="sm"
                      onClick={() => handleStopService(inst, "frontend")}
                      className="text-[var(--md-sys-color-error)]"
                    >
                      <Square size={13} className="mr-1 fill-current" /> Stop
                    </Button>
                  ) : (
                    <Button
                      variant="filled"
                      size="sm"
                      onClick={() => handleStartService(inst, "frontend")}
                      disabled={
                        !systemEnv?.has_bun ||
                        inst.has_frontend === false ||
                        inst.root_exists === false
                      }
                      title={
                        inst.has_frontend === false || inst.root_exists === false
                          ? "Cannot start: frontend/ directory missing on disk"
                          : "Start frontend service"
                      }
                    >
                      <Play size={13} className="mr-1 fill-current" /> Start
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Metadata Footer */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-[var(--md-sys-color-on-surface-variant)] pt-1 border-t border-[var(--md-sys-color-outline-variant)]/40">
              <span>
                Backend URL:{" "}
                <code className="bg-[var(--md-sys-color-surface-variant)] px-1 rounded">
                  {inst.backend_url}
                </code>
              </span>
              <span>
                Frontend URL:{" "}
                <code className="bg-[var(--md-sys-color-surface-variant)] px-1 rounded">
                  {inst.frontend_url}
                </code>
              </span>
              <span>Updated: {new Date(inst.updated_at).toLocaleDateString()}</span>
            </div>
          </Card>
        );
      })}

      {/* Add dialog */}
      {showAdd && <AddInstanceDialog onAdd={save} onClose={() => setShowAdd(false)} />}

      {/* Live Terminal Modal */}
      {activeTerminal && (
        <LiveTerminalModal
          title={activeTerminal.title}
          subtitle={activeTerminal.subtitle}
          instanceName={activeTerminal.instanceName}
          instanceId={activeTerminal.instanceId}
          service={activeTerminal.service}
          isRunning={activeTerminal.isRunning}
          onClose={() => setActiveTerminal(null)}
          fetchLogs={fetchLogs}
        />
      )}
    </div>
  );
}
