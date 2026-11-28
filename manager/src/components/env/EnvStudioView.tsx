import { useState, useEffect, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useInstances } from "@/hooks/useInstances";
import { useEnv } from "@/hooks/useEnv";
import { parseRawEnvText } from "@/hooks/envUtils";
import { readFileContent } from "@/hooks/useIpc";
import { Card } from "@/components/m3/Card";
import { Button } from "@/components/m3/Button";
import { Chip } from "@/components/m3/Chip";
import {
  Loader2,
  Save,
  Plus,
  Trash2,
  AlertTriangle,
  Search,
  CheckCircle2,
  FileCode,
  Eye,
  EyeOff,
  Copy,
  Check,
  Sparkles,
  List,
  Code,
  Lock,
  X,
  Upload,
  FolderOpen,
  ArrowRight,
  Diff,
} from "lucide-react";
import type { EnvVariable } from "@/types/env";

const ENV_CATEGORIES = [
  "Core",
  "Database",
  "Security",
  "Storage",
  "Email",
  "AI",
  "Other",
] as const;

function categorize(key: string): (typeof ENV_CATEGORIES)[number] {
  const k = key.toLowerCase();
  if (k.includes("database") || k.includes("postgres") || k.includes("db_") || k === "database_url")
    return "Database";
  if (
    k.includes("secret") ||
    k.includes("jwt") ||
    k.includes("auth") ||
    k.includes("key") ||
    k.includes("token") ||
    k.includes("password") ||
    k.includes("mfa")
  )
    return "Security";
  if (
    k.includes("storage") ||
    k.includes("s3") ||
    k.includes("bucket") ||
    k.includes("r2") ||
    k.includes("cloudflare")
  )
    return "Storage";
  if (k.includes("email") || k.includes("smtp") || k.includes("sendgrid") || k.includes("mail"))
    return "Email";
  if (
    k.includes("openai") ||
    k.includes("anthropic") ||
    k.includes("deepseek") ||
    k.includes("gemini") ||
    k.includes("ai_")
  )
    return "AI";
  if (
    k.includes("port") ||
    k.includes("host") ||
    k.includes("url") ||
    k.includes("node_env") ||
    k.includes("next_public")
  )
    return "Core";
  return "Other";
}

interface EnvRowProps {
  variable: EnvVariable;
  category: string;
  onUpdate: (key: string, value: string) => void;
  onRemove: (key: string) => void;
}

function EnvRow({ variable, category, onUpdate, onRemove }: EnvRowProps) {
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!variable.value) return;
    navigator.clipboard.writeText(variable.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--md-sys-color-surface-container-high)]/60 transition-colors border-b border-[var(--md-sys-color-outline-variant)]/40 last:border-b-0">
      {/* Key & Meta Column */}
      <div className="w-72 shrink-0 flex flex-col justify-center min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs font-semibold text-[var(--md-sys-color-on-surface)] select-all truncate">
            {variable.key}
          </span>
          {variable.is_secret && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium"
              title="Secret variable"
            >
              <Lock size={9} />
              Secret
            </span>
          )}
          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[var(--md-sys-color-surface-container-highest)] text-[var(--md-sys-color-on-surface-variant)]">
            {category}
          </span>
        </div>
        {variable.comment && (
          <p
            className="text-[11px] text-[var(--md-sys-color-on-surface-variant)] opacity-80 truncate mt-0.5"
            title={variable.comment}
          >
            # {variable.comment}
          </p>
        )}
      </div>

      {/* Value Input Column */}
      <div className="flex-1 min-w-0 relative flex items-center">
        <input
          type={variable.is_secret && !showSecret ? "password" : "text"}
          value={variable.value}
          onChange={(e) => onUpdate(variable.key, e.target.value)}
          placeholder={`Enter ${variable.key}...`}
          className="w-full h-8.5 pl-3 pr-22 rounded-lg border border-[var(--md-sys-color-outline-variant)]/80 bg-[var(--md-sys-color-surface-container-highest)] text-xs text-[var(--md-sys-color-on-surface)] font-mono outline-none focus:border-[var(--md-sys-color-primary)] focus:ring-1 focus:ring-[var(--md-sys-color-primary)]/20 transition-all placeholder:text-[var(--md-sys-color-outline)]"
        />

        {/* Inline Actions (Generate Secret, Eye & Copy) */}
        <div className="absolute right-1.5 flex items-center gap-1">
          {variable.is_secret && (
            <button
              type="button"
              onClick={() => {
                const array = new Uint8Array(32);
                window.crypto.getRandomValues(array);
                let binary = "";
                for (let i = 0; i < array.byteLength; i++) {
                  binary += String.fromCharCode(array[i]);
                }
                const b64 = window.btoa(binary);
                onUpdate(variable.key, b64);
                setShowSecret(true);
              }}
              className="p-1 rounded text-[var(--md-sys-color-on-surface-variant)] hover:text-amber-500 hover:bg-amber-500/10 transition-colors cursor-pointer"
              title="Generate random 32-byte base64 secret"
            >
              <Sparkles size={13} />
            </button>
          )}
          {variable.is_secret && (
            <button
              type="button"
              onClick={() => setShowSecret((prev) => !prev)}
              className="p-1 rounded text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
              title={showSecret ? "Hide secret value" : "Reveal secret value"}
            >
              {showSecret ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          )}
          {variable.value && (
            <button
              type="button"
              onClick={handleCopy}
              className="p-1 rounded text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
              title={copied ? "Copied!" : "Copy value"}
            >
              {copied ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
            </button>
          )}
        </div>
      </div>

      {/* Action Column */}
      <div className="w-10 shrink-0 flex justify-end">
        <button
          onClick={() => onRemove(variable.key)}
          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-error)] transition-all cursor-pointer"
          title={`Delete ${variable.key}`}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// Diff entry item for the import modal
interface DiffItem {
  key: string;
  currentValue: string | null;
  importedValue: string;
  status: "new" | "modified" | "unchanged";
  comment?: string;
  selected: boolean;
}

export function EnvStudioView() {
  const { instances } = useInstances();
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [activeService, setActiveService] = useState<string>("backend");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "raw">("table");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  // New variable inputs
  const [addKey, setAddKey] = useState("");
  const [addValue, setAddValue] = useState("");
  const [addIsSecret, setAddIsSecret] = useState(false);
  const [addComment, setAddComment] = useState("");

  // Import / Paste scan state
  const [importInputText, setImportInputText] = useState("");
  const [importDiffs, setImportDiffs] = useState<DiffItem[]>([]);
  const [importFilter, setImportFilter] = useState<"all" | "changes" | "new" | "modified">("changes");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Select first instance if none selected
  useEffect(() => {
    if (instances.length > 0 && !selectedInstanceId) {
      setSelectedInstanceId(instances[0].id);
    }
  }, [instances, selectedInstanceId]);

  const selectedInstance = instances.find((i) => i.id === selectedInstanceId) ?? null;
  const {
    services,
    loading,
    saving,
    error,
    dirty,
    load,
    updateVar,
    addVar,
    removeVar,
    mergeVariables,
    replaceServiceVariables,
    save,
  } = useEnv(selectedInstance?.root_path ?? null);

  useEffect(() => {
    if (selectedInstance) load();
  }, [selectedInstance, load]);

  const activeServiceData = services.find((s) => s.service_id === activeService);
  const currentVariables = useMemo(() => {
    return activeServiceData?.variables ?? [];
  }, [activeServiceData?.variables]);

  // Filtered variables for table
  const filteredVariables = useMemo(() => {
    return currentVariables.filter((v) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        v.key.toLowerCase().includes(q) ||
        (v.comment?.toLowerCase() || "").includes(q) ||
        v.value.toLowerCase().includes(q);

      const matchesCat = !selectedCategory || categorize(v.key) === selectedCategory;

      return matchesSearch && matchesCat;
    });
  }, [currentVariables, searchQuery, selectedCategory]);

  // Counts by category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { All: currentVariables.length };
    for (const cat of ENV_CATEGORIES) {
      counts[cat] = currentVariables.filter((v) => categorize(v.key) === cat).length;
    }
    return counts;
  }, [currentVariables]);

  // Raw .env content
  const rawEnvContent = useMemo(() => {
    const lines: string[] = [];
    for (const v of currentVariables) {
      if (v.comment) lines.push(`# ${v.comment}`);
      const val = v.value;
      const needsQuotes = val.includes(" ") || val.includes("#") || val === "";
      lines.push(`${v.key}=${needsQuotes ? `"${val}"` : val}`);
    }
    return lines.join("\n");
  }, [currentVariables]);

  const [rawText, setRawText] = useState("");
  useEffect(() => {
    setRawText(rawEnvContent);
  }, [rawEnvContent]);

  // Real-time scan of imported text against existing variables
  useEffect(() => {
    if (!importInputText.trim()) {
      setImportDiffs([]);
      return;
    }

    const parsed = parseRawEnvText(importInputText);
    const diffs: DiffItem[] = [];

    for (const item of parsed) {
      const existing = currentVariables.find(
        (v) => v.key.toUpperCase() === item.key.toUpperCase()
      );
      const existingVal = existing ? existing.value : null;
      const status: "new" | "modified" | "unchanged" =
        existingVal === null
          ? "new"
          : existingVal === item.value
          ? "unchanged"
          : "modified";

      diffs.push({
        key: item.key,
        currentValue: existingVal,
        importedValue: item.value,
        status,
        comment: item.comment || existing?.comment,
        selected: status !== "unchanged",
      });
    }

    setImportDiffs(diffs);
  }, [importInputText, currentVariables]);

  const diffCounts = useMemo(() => {
    let newCount = 0;
    let modCount = 0;
    let sameCount = 0;
    for (const d of importDiffs) {
      if (d.status === "new") newCount++;
      else if (d.status === "modified") modCount++;
      else sameCount++;
    }
    return { newCount, modCount, sameCount, total: importDiffs.length };
  }, [importDiffs]);

  const filteredDiffs = useMemo(() => {
    return importDiffs.filter((d) => {
      if (importFilter === "new") return d.status === "new";
      if (importFilter === "modified") return d.status === "modified";
      if (importFilter === "changes") return d.status !== "unchanged";
      return true;
    });
  }, [importDiffs, importFilter]);

  const handleBrowseEnvFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        title: "Select .env file to import",
      });
      if (selected && typeof selected === "string") {
        const text = await readFileContent(selected);
        setImportInputText(text);
      }
    } catch (e) {
      console.error("Failed to read imported file:", e);
    }
  };

  const handleApplyImport = async () => {
    const selectedItems = importDiffs.filter((d) => d.selected);
    if (selectedItems.length === 0) {
      setShowImportModal(false);
      return;
    }

    try {
      const incoming = selectedItems.map((item) => ({
        key: item.key,
        value: item.importedValue,
        comment: item.comment,
      }));

      await mergeVariables(activeService, incoming, true);

      const targetLabel = activeService === "backend" ? "backend/.env" : "frontend/.env";
      setSuccessMessage(
        `Applied and saved ${selectedItems.length} variable${
          selectedItems.length > 1 ? "s" : ""
        } to ${targetLabel}`
      );
      setTimeout(() => setSuccessMessage(null), 4500);

      setShowImportModal(false);
      setImportInputText("");
      setImportDiffs([]);
    } catch (e) {
      console.error("Failed to apply imported variables:", e);
    }
  };

  const handleToggleSelectDiff = (key: string) => {
    setImportDiffs((prev) =>
      prev.map((d) => (d.key === key ? { ...d, selected: !d.selected } : d))
    );
  };

  const handleToggleSelectAll = (select: boolean) => {
    setImportDiffs((prev) =>
      prev.map((d) => ({
        ...d,
        selected: select ? d.status !== "unchanged" : false,
      }))
    );
  };

  const handleAdd = () => {
    if (!addKey.trim()) return;
    addVar(activeService, {
      key: addKey.trim().toUpperCase(),
      value: addValue,
      is_secret: addIsSecret,
      comment: addComment.trim() || undefined,
    });
    setAddKey("");
    setAddValue("");
    setAddComment("");
    setAddIsSecret(false);
    setShowAddModal(false);
  };

  return (
    <div className="flex flex-col gap-5 max-w-5xl mx-auto pb-12">
      {/* Instance selector bar */}
      <div className="flex items-center justify-between flex-wrap gap-3 px-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)]">
            Instance:
          </span>
          <div className="flex gap-1.5 flex-wrap">
            {instances.map((inst) => (
              <Chip
                key={inst.id}
                variant="filter"
                selected={selectedInstanceId === inst.id}
                onClick={() => setSelectedInstanceId(inst.id)}
              >
                {inst.name} (v{inst.version})
              </Chip>
            ))}
          </div>
        </div>

        {selectedInstance && (
          <div className="flex items-center gap-2 text-xs font-mono text-[var(--md-sys-color-on-surface-variant)]">
            <FileCode size={13} className="text-[var(--md-sys-color-primary)]" />
            <span>
              {activeServiceData?.path || (activeService === "backend" ? "backend/.env" : "frontend/.env")}
            </span>
          </div>
        )}
      </div>

      {selectedInstance ? (
        <Card variant="outlined" className="overflow-hidden border border-[var(--md-sys-color-outline-variant)]/60 bg-[var(--md-sys-color-surface)] shadow-sm">
          {/* Main Top Header Controls */}
          <div className="p-4 border-b border-[var(--md-sys-color-outline-variant)]/50 bg-[var(--md-sys-color-surface-container-low)] flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              {/* Service Tabs */}
              <div className="flex items-center gap-2">
                {(["backend", "frontend"] as const).map((svc) => {
                  const svcData = services.find((s) => s.service_id === svc);
                  const count = svcData?.variables.length || 0;
                  const isActive = activeService === svc;
                  return (
                    <button
                      key={svc}
                      onClick={() => {
                        setActiveService(svc);
                        setSelectedCategory(null);
                      }}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer transition-all flex items-center gap-2 ${
                        isActive
                          ? "bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] shadow-sm"
                          : "bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container-high)]"
                      }`}
                    >
                      <span>{svc === "backend" ? "Backend Service" : "Frontend Service"}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                          isActive
                            ? "bg-white/20 text-white"
                            : "bg-black/10 dark:bg-white/10"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">
                {/* View Mode Toggle */}
                <div className="flex bg-[var(--md-sys-color-surface-container)] p-0.5 rounded-xl border border-[var(--md-sys-color-outline-variant)]/40">
                  <button
                    onClick={() => setViewMode("table")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                      viewMode === "table"
                        ? "bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)] shadow-xs font-semibold"
                        : "text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]"
                    }`}
                    title="Structured Table View"
                  >
                    <List size={13} /> Table
                  </button>
                  <button
                    onClick={() => setViewMode("raw")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                      viewMode === "raw"
                        ? "bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)] shadow-xs font-semibold"
                        : "text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]"
                    }`}
                    title="Raw .env Text View"
                  >
                    <Code size={13} /> Raw .env
                  </button>
                </div>

                {/* Import / Paste Scanner Button */}
                <Button
                  variant="tonal"
                  size="sm"
                  onClick={() => setShowImportModal(true)}
                  title="Import from a file or paste .env text and scan against existing variables"
                >
                  <Upload size={13} className="mr-1 text-[var(--md-sys-color-primary)]" />
                  Import / Paste .env
                </Button>

                {/* Populate from .env.example */}
                <Button
                  variant="tonal"
                  size="sm"
                  onClick={load}
                  disabled={loading}
                  title="Sync with .env.example template defaults"
                >
                  <Sparkles size={13} className="mr-1 text-[var(--md-sys-color-primary)]" />
                  Sync .env.example
                </Button>

                {/* Save Changes */}
                <Button
                  variant="filled"
                  size="sm"
                  onClick={() => save()}
                  disabled={!dirty || saving}
                >
                  {saving ? (
                    <Loader2 size={13} className="animate-spin mr-1.5" />
                  ) : dirty ? (
                    <Save size={13} className="mr-1.5" />
                  ) : (
                    <CheckCircle2 size={13} className="mr-1.5 text-emerald-300" />
                  )}
                  {dirty ? "Save Changes" : "Saved"}
                </Button>
              </div>
            </div>

            {/* Search and Category Filter Toolbar (Table view only) */}
            {viewMode === "table" && (
              <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
                {/* Search input */}
                <div className="relative w-64">
                  <Search
                    size={13}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--md-sys-color-on-surface-variant)] opacity-70"
                  />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search variables or comments..."
                    className="w-full h-8 pl-8 pr-7 rounded-xl border border-[var(--md-sys-color-outline-variant)]/60 bg-[var(--md-sys-color-surface-container)] text-xs text-[var(--md-sys-color-on-surface)] outline-none focus:border-[var(--md-sys-color-primary)] font-mono"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)] cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                {/* Category Pills */}
                <div className="flex items-center gap-1 flex-wrap">
                  <button
                    onClick={() => setSelectedCategory(null)}
                    className={`px-2 py-1 rounded-lg text-xs transition-colors cursor-pointer ${
                      selectedCategory === null
                        ? "bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)] font-semibold"
                        : "text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container-high)]"
                    }`}
                  >
                    All ({categoryCounts.All || 0})
                  </button>
                  {ENV_CATEGORIES.map((cat) => {
                    const count = categoryCounts[cat] || 0;
                    if (count === 0) return null;
                    const isSelected = selectedCategory === cat;
                    return (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(isSelected ? null : cat)}
                        className={`px-2 py-1 rounded-lg text-xs transition-colors cursor-pointer ${
                          isSelected
                            ? "bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)] font-semibold"
                            : "text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container-high)]"
                        }`}
                      >
                        {cat} ({count})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Feedback banners */}
          {error && (
            <div className="m-4 p-3 rounded-xl bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)] text-xs flex items-center gap-2">
              <AlertTriangle size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="m-4 p-3 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={15} className="shrink-0" />
                <span>{successMessage}</span>
              </div>
              <button onClick={() => setSuccessMessage(null)} className="cursor-pointer hover:opacity-75">
                <X size={13} />
              </button>
            </div>
          )}

          {/* Loading Indicator */}
          {loading && (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-[var(--md-sys-color-on-surface-variant)]">
              <Loader2 size={18} className="animate-spin text-[var(--md-sys-color-primary)]" />
              <span>Loading environment configuration…</span>
            </div>
          )}

          {/* Table View */}
          {!loading && viewMode === "table" && (
            <div>
              {/* Table Column Headers */}
              <div className="flex items-center gap-3 px-4 py-2 bg-[var(--md-sys-color-surface-container)] text-[10px] font-semibold uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)] border-b border-[var(--md-sys-color-outline-variant)]/40 select-none">
                <span className="w-72 shrink-0">Variable & Description</span>
                <span className="flex-1">Value</span>
                <span className="w-10 text-right">Delete</span>
              </div>

              {/* Rows List */}
              <div className="divide-y divide-[var(--md-sys-color-outline-variant)]/30">
                {filteredVariables.map((v) => (
                  <EnvRow
                    key={v.key}
                    variable={v}
                    category={categorize(v.key)}
                    onUpdate={(key, val) => updateVar(activeService, key, val)}
                    onRemove={(key) => removeVar(activeService, key)}
                  />
                ))}
              </div>

              {/* Empty Search Fallback */}
              {filteredVariables.length === 0 && (
                <div className="p-10 text-center text-xs text-[var(--md-sys-color-on-surface-variant)]">
                  No environment variables match "{searchQuery}".
                </div>
              )}

              {/* Inline Bottom Bar: Add Variable & Counter */}
              <div className="p-3 bg-[var(--md-sys-color-surface-container-low)] border-t border-[var(--md-sys-color-outline-variant)]/40 flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs text-[var(--md-sys-color-on-surface-variant)]">
                  Showing <strong>{filteredVariables.length}</strong> of{" "}
                  <strong>{currentVariables.length}</strong> variables
                </span>

                {!showAddModal ? (
                  <Button
                    variant="tonal"
                    size="sm"
                    onClick={() => setShowAddModal(true)}
                  >
                    <Plus size={13} className="mr-1" /> Add Custom Variable
                  </Button>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap w-full pt-2">
                    <input
                      type="text"
                      value={addKey}
                      onChange={(e) => setAddKey(e.target.value.toUpperCase())}
                      placeholder="VARIABLE_NAME"
                      className="w-48 h-8 px-2.5 rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface)] text-xs font-mono outline-none focus:border-[var(--md-sys-color-primary)]"
                    />
                    <input
                      type="text"
                      value={addValue}
                      onChange={(e) => setAddValue(e.target.value)}
                      placeholder="Value"
                      className="flex-1 min-w-[140px] h-8 px-2.5 rounded-lg border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface)] text-xs font-mono outline-none focus:border-[var(--md-sys-color-primary)]"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-[var(--md-sys-color-on-surface-variant)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={addIsSecret}
                        onChange={(e) => setAddIsSecret(e.target.checked)}
                        className="rounded"
                      />
                      Secret
                    </label>
                    <Button variant="filled" size="sm" onClick={handleAdd} disabled={!addKey.trim()}>
                      Add
                    </Button>
                    <Button variant="text" size="sm" onClick={() => setShowAddModal(false)}>
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Raw Text View */}
          {!loading && viewMode === "raw" && (
            <div className="p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs text-[var(--md-sys-color-on-surface-variant)]">
                <span className="font-mono">Direct .env File Editor</span>
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(rawText);
                  }}
                >
                  <Copy size={13} className="mr-1" /> Copy All
                </Button>
              </div>
              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                rows={22}
                className="w-full p-4 rounded-xl font-mono text-xs leading-relaxed bg-[#0a0e14] text-gray-200 border border-[var(--md-sys-color-outline-variant)]/40 outline-none focus:border-[var(--md-sys-color-primary)] resize-y select-text"
                placeholder="# Paste or edit .env here..."
              />
              <div className="flex justify-end gap-2">
                <Button variant="tonal" size="sm" onClick={() => setRawText(rawEnvContent)}>
                  Reset
                </Button>
                <Button
                  variant="tonal"
                  size="sm"
                  onClick={async () => {
                    try {
                      const parsed = parseRawEnvText(rawText);
                      await replaceServiceVariables(activeService, parsed, true);
                      const targetName = activeService === "backend" ? "backend/.env" : "frontend/.env";
                      setSuccessMessage(`Saved ${parsed.length} variables to ${targetName}`);
                      setTimeout(() => setSuccessMessage(null), 4500);
                    } catch (e) {
                      console.error("Failed to save raw env:", e);
                    }
                  }}
                  disabled={saving}
                >
                  {saving ? (
                    <Loader2 size={13} className="animate-spin mr-1.5" />
                  ) : (
                    <Save size={13} className="mr-1.5" />
                  )}
                  Save .env
                </Button>
                <Button
                  variant="filled"
                  size="sm"
                  onClick={async () => {
                    try {
                      const parsed = parseRawEnvText(rawText);
                      await replaceServiceVariables(activeService, parsed, true);
                      const targetName = activeService === "backend" ? "backend/.env" : "frontend/.env";
                      setSuccessMessage(`Saved ${parsed.length} variables to ${targetName}`);
                      setTimeout(() => setSuccessMessage(null), 4500);
                      setViewMode("table");
                    } catch (e) {
                      console.error("Failed to save raw env:", e);
                    }
                  }}
                  disabled={saving}
                >
                  <CheckCircle2 size={13} className="mr-1.5" />
                  Apply &amp; Return to Table
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : (
        <Card variant="filled" className="p-10 flex flex-col items-center gap-3 text-center">
          <p className="text-[var(--md-sys-color-on-surface-variant)]">
            Select an instance above to manage its environment variables.
          </p>
        </Card>
      )}

      {/* ── Import / Paste Scanner Modal ────────────────────────────────────── */}
      {showImportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowImportModal(false);
          }}
        >
          <div
            className="relative w-full max-w-2xl max-h-[85vh] rounded-[24px] flex flex-col shadow-2xl overflow-hidden border border-[var(--md-sys-color-outline-variant)]/60"
            style={{ background: "var(--md-sys-color-surface-container-high)" }}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 flex items-center justify-between border-b border-[var(--md-sys-color-outline-variant)]/50">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-primary)]">
                  <Diff size={18} />
                </div>
                <div>
                  <h3 className="font-semibold text-sm text-[var(--md-sys-color-on-surface)]">
                    Import &amp; Scan Environment Variables
                  </h3>
                  <p className="text-xs text-[var(--md-sys-color-on-surface-variant)]">
                    Target: {activeService === "backend" ? "Backend (backend/.env)" : "Frontend (frontend/.env)"}
                  </p>
                </div>
              </div>
              <Button variant="text" size="sm" onClick={() => setShowImportModal(false)}>
                <X size={16} />
              </Button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto flex flex-col gap-4">
              {/* Option 1: File picker */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)]/40">
                <div className="text-xs">
                  <p className="font-medium text-[var(--md-sys-color-on-surface)]">Import from .env File</p>
                  <p className="text-[11px] text-[var(--md-sys-color-on-surface-variant)] mt-0.5">
                    Browse your computer to select an existing environment file
                  </p>
                </div>
                <Button variant="tonal" size="sm" onClick={handleBrowseEnvFile}>
                  <FolderOpen size={13} className="mr-1.5" /> Browse File...
                </Button>
              </div>

              {/* Option 2: Paste textarea */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs text-[var(--md-sys-color-on-surface-variant)]">
                  <label className="font-medium">Or Paste .env Content Below:</label>
                  {importInputText && (
                    <button
                      onClick={() => setImportInputText("")}
                      className="text-[11px] text-[var(--md-sys-color-error)] hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <textarea
                  value={importInputText}
                  onChange={(e) => setImportInputText(e.target.value)}
                  placeholder={`PASTE .ENV CONTENT HERE (KEY=VALUE)\ne.g.\nPORT=3001\nDATABASE_URL=file:./prisma/gradebook.db\nAUTH_SECRET=my-secret-key`}
                  rows={6}
                  className="w-full p-3 rounded-xl font-mono text-xs leading-relaxed bg-[#0a0e14] text-gray-200 border border-[var(--md-sys-color-outline-variant)]/50 outline-none focus:border-[var(--md-sys-color-primary)] resize-y select-text"
                />
              </div>

              {/* Scan / Diff Results */}
              {importDiffs.length > 0 && (
                <div className="flex flex-col gap-2.5 pt-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <span className="text-xs font-semibold text-[var(--md-sys-color-on-surface)]">
                      Scan Diff Analysis ({importDiffs.length} variables detected)
                    </span>

                    {/* Filter Pills */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setImportFilter("changes")}
                        className={`text-[11px] px-2 py-0.5 rounded-md cursor-pointer ${
                          importFilter === "changes"
                            ? "bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)] font-semibold"
                            : "text-[var(--md-sys-color-on-surface-variant)] hover:bg-black/5 dark:hover:bg-white/5"
                        }`}
                      >
                        Changes ({diffCounts.newCount + diffCounts.modCount})
                      </button>
                      <button
                        onClick={() => setImportFilter("new")}
                        className={`text-[11px] px-2 py-0.5 rounded-md cursor-pointer ${
                          importFilter === "new"
                            ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-semibold"
                            : "text-[var(--md-sys-color-on-surface-variant)] hover:bg-black/5 dark:hover:bg-white/5"
                        }`}
                      >
                        New (+{diffCounts.newCount})
                      </button>
                      <button
                        onClick={() => setImportFilter("modified")}
                        className={`text-[11px] px-2 py-0.5 rounded-md cursor-pointer ${
                          importFilter === "modified"
                            ? "bg-amber-500/20 text-amber-600 dark:text-amber-400 font-semibold"
                            : "text-[var(--md-sys-color-on-surface-variant)] hover:bg-black/5 dark:hover:bg-white/5"
                        }`}
                      >
                        Modified (Δ{diffCounts.modCount})
                      </button>
                      <button
                        onClick={() => setImportFilter("all")}
                        className={`text-[11px] px-2 py-0.5 rounded-md cursor-pointer ${
                          importFilter === "all"
                            ? "bg-[var(--md-sys-color-surface-container-highest)] font-semibold"
                            : "text-[var(--md-sys-color-on-surface-variant)] hover:bg-black/5 dark:hover:bg-white/5"
                        }`}
                      >
                        All ({diffCounts.total})
                      </button>
                    </div>
                  </div>

                  {/* Diff List Container */}
                  <div className="border border-[var(--md-sys-color-outline-variant)]/50 rounded-xl overflow-hidden bg-[var(--md-sys-color-surface)] max-h-56 overflow-y-auto divide-y divide-[var(--md-sys-color-outline-variant)]/30 text-xs">
                    {filteredDiffs.map((diff) => (
                      <div
                        key={diff.key}
                        onClick={() => handleToggleSelectDiff(diff.key)}
                        className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                          diff.selected
                            ? "bg-[var(--md-sys-color-primary-container)]/15"
                            : "hover:bg-[var(--md-sys-color-surface-container)]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={diff.selected}
                          onChange={() => handleToggleSelectDiff(diff.key)}
                          className="rounded cursor-pointer"
                          onClick={(e) => e.stopPropagation()}
                        />

                        {/* Status Badge */}
                        {diff.status === "new" ? (
                          <span className="w-14 text-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                            + NEW
                          </span>
                        ) : diff.status === "modified" ? (
                          <span className="w-14 text-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400">
                            Δ MOD
                          </span>
                        ) : (
                          <span className="w-14 text-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium text-gray-400">
                            = SAME
                          </span>
                        )}

                        {/* Variable Key */}
                        <span className="w-48 shrink-0 font-mono font-semibold text-[var(--md-sys-color-on-surface)] truncate">
                          {diff.key}
                        </span>

                        {/* Values Comparison */}
                        <div className="flex-1 flex items-center gap-1.5 min-w-0 font-mono text-[11px] truncate">
                          {diff.status === "modified" && (
                            <>
                              <span className="text-gray-400 line-through truncate max-w-[120px]">
                                {diff.currentValue || '""'}
                              </span>
                              <ArrowRight size={11} className="shrink-0 text-amber-500" />
                            </>
                          )}
                          <span
                            className={
                              diff.status === "new"
                                ? "text-emerald-600 dark:text-emerald-400 font-medium truncate"
                                : diff.status === "modified"
                                ? "text-amber-600 dark:text-amber-400 font-medium truncate"
                                : "text-gray-400 truncate"
                            }
                          >
                            {diff.importedValue || '""'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Selection controls */}
                  <div className="flex items-center justify-between text-xs text-[var(--md-sys-color-on-surface-variant)] px-1">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleSelectAll(true)}
                        className="hover:underline text-[var(--md-sys-color-primary)] cursor-pointer"
                      >
                        Select all changes
                      </button>
                      <span>•</span>
                      <button
                        onClick={() => handleToggleSelectAll(false)}
                        className="hover:underline cursor-pointer"
                      >
                        Deselect all
                      </button>
                    </div>
                    <span>
                      {importDiffs.filter((d) => d.selected).length} selected to apply
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-[var(--md-sys-color-outline-variant)]/50 bg-[var(--md-sys-color-surface-container)] flex items-center justify-between">
              <Button variant="text" size="sm" onClick={() => setShowImportModal(false)}>
                Cancel
              </Button>
              <Button
                variant="filled"
                size="sm"
                onClick={handleApplyImport}
                disabled={!importDiffs.some((d) => d.selected) || saving}
              >
                {saving ? (
                  <Loader2 size={13} className="animate-spin mr-1.5" />
                ) : (
                  <CheckCircle2 size={13} className="mr-1.5" />
                )}
                Apply &amp; Save {importDiffs.filter((d) => d.selected).length} Changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
