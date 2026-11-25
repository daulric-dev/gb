import { useState, useCallback, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useInstances } from "@/hooks/useInstances";
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
} from "lucide-react";
import type { InstanceConfig, InstanceScanResult } from "@/types/instance";

function StatusDot({ online }: { online?: boolean | null }) {
  if (online === null || online === undefined)
    return <Loader2 size={14} className="animate-spin text-[var(--md-sys-color-outline)]" />;
  if (online)
    return <CheckCircle2 size={14} className="text-[var(--md-sys-color-primary)]" />;
  return <XCircle size={14} className="text-[var(--md-sys-color-error)]" />;
}

function LogViewerModal({
  instance,
  service,
  onClose,
  fetchLogs,
}: {
  instance: InstanceConfig;
  service: "backend" | "frontend";
  onClose: () => void;
  fetchLogs: (id: string, s: "backend" | "frontend") => Promise<string[]>;
}) {
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const lines = await fetchLogs(instance.id, service);
      setLogs(lines);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [instance.id, service, fetchLogs]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-[800px] mx-4 h-[550px] rounded-[24px] flex flex-col shadow-2xl overflow-hidden"
        style={{ background: "var(--md-sys-color-surface-container-high)" }}
      >
        <div className="px-6 py-4 flex items-center justify-between border-b border-[var(--md-sys-color-outline-variant)]">
          <div className="flex items-center gap-2">
            <Terminal size={18} className="text-[var(--md-sys-color-primary)]" />
            <h3 className="font-semibold text-[var(--md-sys-color-on-surface)]">
              {instance.name} — {service.toUpperCase()} Logs
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="text" size="sm" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? "animate-spin mr-1" : "mr-1"} />
              Refresh
            </Button>
            <Button variant="text" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        <div className="flex-1 p-4 bg-[#0d1117] overflow-y-auto font-mono text-xs text-green-400 select-text leading-relaxed">
          {logs.length === 0 ? (
            <p className="text-gray-500 italic">No log output recorded yet for this service.</p>
          ) : (
            logs.map((line, idx) => (
              <div key={idx} className="whitespace-pre-wrap break-all hover:bg-white/5 py-0.5">
                {line}
              </div>
            ))
          )}
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

  const browse = async () => {
    const selected = await open({ directory: true, multiple: false, title: "Select Gradebook root" });
    if (selected && typeof selected === "string") {
      setPath(selected);
      setScanResult(null);
      setError(null);
    }
  };

  const doScan = useCallback(async () => {
    if (!path) return;
    setScanning(true);
    setError(null);
    try {
      const result = await scan(path);
      setScanResult(result);
      if (!result.valid && result.error) setError(result.error);
      if (result.valid && !name && path) {
        setName(path.split("/").pop() || "Gradebook Instance");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setScanning(false);
    }
  }, [path, scan, name]);

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
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(2px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-[560px] mx-4 rounded-[28px] flex flex-col gap-0 shadow-2xl overflow-hidden"
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
                Root Directory
              </label>
              <input
                className="w-full h-11 rounded-xl px-3 text-sm font-mono border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface)] placeholder:text-[var(--md-sys-color-on-surface-variant)] focus:outline-none focus:border-[var(--md-sys-color-primary)] transition-colors"
                value={path}
                onChange={(e) => { setPath(e.target.value); setScanResult(null); }}
                placeholder="/path/to/gradebook"
              />
            </div>
            <Button variant="tonal" onClick={browse} className="mt-5 shrink-0">
              <FolderOpen size={16} className="mr-1.5" /> Browse
            </Button>
          </div>

          <Button variant="outlined" onClick={doScan} disabled={!path || scanning} className="w-full">
            {scanning ? <Loader2 size={15} className="animate-spin mr-2" /> : null}
            {scanning ? "Scanning…" : "Scan Directory"}
          </Button>

          {scan_result && (
            <div
              className="rounded-2xl p-4 flex flex-col gap-2.5 text-sm border"
              style={{
                background: scan_result.valid
                  ? "color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent)"
                  : "color-mix(in srgb, var(--md-sys-color-error) 8%, transparent)",
                borderColor: scan_result.valid
                  ? "var(--md-sys-color-primary)"
                  : "var(--md-sys-color-error)",
              }}
            >
              <div className="flex items-center gap-2 font-semibold">
                {scan_result.valid
                  ? <CheckCircle2 size={16} className="text-[var(--md-sys-color-primary)]" />
                  : <XCircle size={16} className="text-[var(--md-sys-color-error)]" />}
                {scan_result.valid ? "Valid Gradebook directory" : "Invalid directory"}
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[var(--md-sys-color-on-surface-variant)]">
                <span>Backend folder:</span>
                <span className="font-medium">{scan_result.has_backend ? "✓ Found" : "✗ Missing"}</span>
                <span>Frontend folder:</span>
                <span className="font-medium">{scan_result.has_frontend ? "✓ Found" : "✗ Missing"}</span>
                <span>Detected version:</span>
                <span className="font-medium">{scan_result.version || "—"}</span>
                <span>instance.json:</span>
                <span className="font-medium">{scan_result.has_instance_file ? "✓ Exists" : "Not yet configured"}</span>
                <span>Bun runtime:</span>
                <span className="font-medium">
                  {scan_result.has_bun ? `✓ Bun ${scan_result.bun_version || "ready"}` : "✗ Not found"}
                </span>
                <span>Dependencies:</span>
                <span className="font-medium">
                  {scan_result.has_node_modules ? "✓ Installed" : "⚠ Not installed"}
                </span>
              </div>
            </div>
          )}

          {scan_result?.valid && (
            <div>
              <label className="block text-xs font-medium text-[var(--md-sys-color-on-surface-variant)] mb-1 ml-1">
                Display Name
              </label>
              <input
                className="w-full h-11 rounded-xl px-3 text-sm border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface)] placeholder:text-[var(--md-sys-color-on-surface-variant)] focus:outline-none focus:border-[var(--md-sys-color-primary)] transition-colors"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Gradebook"
              />
            </div>
          )}

          {error && (
            <p className="text-sm text-[var(--md-sys-color-error)] flex items-center gap-1.5">
              <XCircle size={14} /> {error}
            </p>
          )}
        </div>

        <div className="h-px bg-[var(--md-sys-color-outline-variant)]" />

        <div className="flex gap-2 justify-end px-6 py-4">
          <Button variant="text" onClick={onClose}>Cancel</Button>
          <Button
            variant="filled"
            onClick={doAdd}
            disabled={!scan_result?.valid || !name || saving}
          >
            {saving ? <Loader2 size={15} className="animate-spin mr-1.5" /> : null}
            Add Instance
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
    loading,
    installingFor,
    error,
    refresh,
    save,
    installInFolder,
    startAppService,
    stopAppService,
    fetchLogs,
    remove,
  } = useInstances();
  const [showAdd, setShowAdd] = useState(false);
  const [activeLog, setActiveLog] = useState<{ instance: InstanceConfig; service: "backend" | "frontend" } | null>(null);
  const [actionMsg, setActionMsg] = useState<{ id: string; msg: string; isError?: boolean } | null>(null);

  const handleInstallFolder = async (inst: InstanceConfig, service: "backend" | "frontend" | "all") => {
    setActionMsg(null);
    try {
      const res = await installInFolder(inst.root_path, service);
      setActionMsg({ id: inst.id, msg: res });
    } catch (e) {
      setActionMsg({ id: inst.id, msg: String(e), isError: true });
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
        <Card variant="filled" className="p-4 bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)] flex items-center gap-3">
          <AlertTriangle size={24} className="shrink-0 text-[var(--md-sys-color-error)]" />
          <div className="flex-1 text-sm">
            <p className="font-semibold">Bun runtime not detected</p>
            <p className="text-xs opacity-90 mt-0.5">
              Gradebook requires <strong>Bun</strong> (v1.1+) to install packages and run local backend & frontend services.
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
            <div key={n} className="h-28 rounded-2xl bg-[var(--md-sys-color-surface-variant)] animate-pulse" />
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

        return (
          <Card key={inst.id} variant="elevated" className="p-5 flex flex-col gap-4">
            {/* Top header row */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusDot online={inst.online || isBackendRunning || isFrontendRunning} />
                  <span className="text-base font-semibold text-[var(--md-sys-color-on-surface)]">
                    {inst.name}
                  </span>
                  <Chip variant="assist">{`v${inst.version}`}</Chip>
                  {inst.has_node_modules ? (
                    <Chip variant="assist" icon={<Package size={12} className="text-[var(--md-sys-color-primary)]" />}>
                      Packages ready
                    </Chip>
                  ) : (
                    <Chip variant="assist" icon={<AlertTriangle size={12} className="text-amber-500" />}>
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
                  disabled={Boolean(installingFor) || !systemEnv?.has_bun}
                  title="Install packages in all folders (backend, frontend, root)"
                >
                  {installingFor === `${inst.root_path}:all` ? (
                    <Loader2 size={13} className="animate-spin mr-1.5" />
                  ) : (
                    <Layers size={13} className="mr-1.5" />
                  )}
                  Install in All Folders
                </Button>
                <Button variant="text" onClick={() => remove(inst.id)} className="text-[var(--md-sys-color-error)]">
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
                  <div className={`size-2.5 rounded-full ${isBackendRunning ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
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
                      {isBackendRunning
                        ? `Running${status.backend.pid ? ` • PID ${status.backend.pid}` : ""} • ${inst.backend_url}`
                        : `Stopped • Port ${inst.backend_url.split(":").pop() || "3001"}`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="text"
                    size="sm"
                    onClick={() => handleInstallFolder(inst, "backend")}
                    disabled={Boolean(installingFor) || isBackendRunning}
                    title="Run bun install inside backend/ folder"
                  >
                    {installingFor === `${inst.root_path}:backend` ? (
                      <Loader2 size={13} className="animate-spin mr-1" />
                    ) : (
                      <Package size={13} className="mr-1" />
                    )}
                    Install in backend/
                  </Button>

                  <Button
                    variant="text"
                    size="sm"
                    onClick={() => setActiveLog({ instance: inst, service: "backend" })}
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
                      disabled={!systemEnv?.has_bun}
                    >
                      <Play size={13} className="mr-1 fill-current" /> Start
                    </Button>
                  )}
                </div>
              </div>

              {/* Frontend Service Row */}
              <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline-variant)]/60">
                <div className="flex items-center gap-2.5">
                  <div className={`size-2.5 rounded-full ${isFrontendRunning ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
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
                      {isFrontendRunning
                        ? `Running${status.frontend.pid ? ` • PID ${status.frontend.pid}` : ""} • ${inst.frontend_url}`
                        : `Stopped • Port ${inst.frontend_url.split(":").pop() || "3000"}`}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="text"
                    size="sm"
                    onClick={() => handleInstallFolder(inst, "frontend")}
                    disabled={Boolean(installingFor) || isFrontendRunning}
                    title="Run bun install inside frontend/ folder"
                  >
                    {installingFor === `${inst.root_path}:frontend` ? (
                      <Loader2 size={13} className="animate-spin mr-1" />
                    ) : (
                      <Package size={13} className="mr-1" />
                    )}
                    Install in frontend/
                  </Button>

                  <Button
                    variant="text"
                    size="sm"
                    onClick={() => setActiveLog({ instance: inst, service: "frontend" })}
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
                      disabled={!systemEnv?.has_bun}
                    >
                      <Play size={13} className="mr-1 fill-current" /> Start
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Metadata Footer */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-[var(--md-sys-color-on-surface-variant)] pt-1 border-t border-[var(--md-sys-color-outline-variant)]/40">
              <span>Backend URL: <code className="bg-[var(--md-sys-color-surface-variant)] px-1 rounded">{inst.backend_url}</code></span>
              <span>Frontend URL: <code className="bg-[var(--md-sys-color-surface-variant)] px-1 rounded">{inst.frontend_url}</code></span>
              <span>Updated: {new Date(inst.updated_at).toLocaleDateString()}</span>
            </div>
          </Card>
        );
      })}

      {/* Add dialog */}
      {showAdd && (
        <AddInstanceDialog onAdd={save} onClose={() => setShowAdd(false)} />
      )}

      {/* Log viewer modal */}
      {activeLog && (
        <LogViewerModal
          instance={activeLog.instance}
          service={activeLog.service}
          onClose={() => setActiveLog(null)}
          fetchLogs={fetchLogs}
        />
      )}
    </div>
  );
}
