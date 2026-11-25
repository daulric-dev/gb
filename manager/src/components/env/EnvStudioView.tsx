import { useState, useEffect, useMemo } from "react";
import { useInstances } from "@/hooks/useInstances";
import { useEnv } from "@/hooks/useEnv";
import { Card } from "@/components/m3/Card";
import { Button } from "@/components/m3/Button";
import { TextField } from "@/components/m3/TextField";
import { Chip } from "@/components/m3/Chip";
import {
  Loader2,
  Save,
  Plus,
  Trash2,
  AlertTriangle,
  RefreshCw,
  Search,
  CheckCircle2,
  FileCode,
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
];

function categorize(key: string): string {
  const k = key.toLowerCase();
  if (k.includes("database") || k.includes("postgres") || k.includes("db_") || k === "database_url")
    return "Database";
  if (
    k.includes("secret") ||
    k.includes("jwt") ||
    k.includes("auth") ||
    k.includes("key") ||
    k.includes("token") ||
    k.includes("password")
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

function EnvVarRow({
  variable,
  onUpdate,
  onRemove,
}: {
  variable: EnvVariable;
  onUpdate: (key: string, value: string) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-2xl bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)]/50 hover:border-[var(--md-sys-color-primary)]/40 transition-colors">
      <div className="flex-1">
        <TextField
          label={variable.key}
          value={variable.value}
          onChange={(e) => onUpdate(variable.key, e.target.value)}
          isSecret={variable.is_secret}
          supportingText={variable.comment}
          placeholder={`Enter value for ${variable.key}...`}
          className="font-mono text-sm"
        />
      </div>
      <button
        onClick={() => onRemove(variable.key)}
        className="mt-3 p-2 rounded-full hover:bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-error)] transition-colors cursor-pointer shrink-0"
        title={`Remove ${variable.key}`}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

export function EnvStudioView() {
  const { instances } = useInstances();
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [activeService, setActiveService] = useState<string>("backend");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Automatically select the first registered instance if none is selected
  useEffect(() => {
    if (instances.length > 0 && !selectedInstanceId) {
      setSelectedInstanceId(instances[0].id);
    }
  }, [instances, selectedInstanceId]);

  const selectedInstance = instances.find((i) => i.id === selectedInstanceId) ?? null;
  const { services, loading, saving, error, dirty, load, updateVar, addVar, removeVar, save } =
    useEnv(selectedInstance?.root_path ?? null);

  useEffect(() => {
    if (selectedInstance) load();
  }, [selectedInstance, load]);

  const activeServiceData = services.find((s) => s.service_id === activeService);

  const filteredVariables = useMemo(() => {
    const list = activeServiceData?.variables ?? [];
    return list.filter((v) => {
      const matchesSearch =
        !searchQuery ||
        v.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (v.comment?.toLowerCase() || "").includes(searchQuery.toLowerCase()) ||
        v.value.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesCat = !selectedCategory || categorize(v.key) === selectedCategory;

      return matchesSearch && matchesCat;
    });
  }, [activeServiceData?.variables, searchQuery, selectedCategory]);

  const variablesByCategory = useMemo(() => {
    return ENV_CATEGORIES.reduce(
      (acc, cat) => {
        acc[cat] = filteredVariables.filter((v) => categorize(v.key) === cat);
        return acc;
      },
      {} as Record<string, EnvVariable[]>
    );
  }, [filteredVariables]);

  const [addKey, setAddKey] = useState("");
  const [addValue, setAddValue] = useState("");

  const handleAdd = () => {
    if (!addKey.trim()) return;
    addVar(activeService, {
      key: addKey.trim().toUpperCase(),
      value: addValue,
      is_secret:
        addKey.toLowerCase().includes("secret") ||
        addKey.toLowerCase().includes("key") ||
        addKey.toLowerCase().includes("password"),
      comment: undefined,
    });
    setAddKey("");
    setAddValue("");
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      {/* Instance selector */}
      <Card variant="filled" className="p-4 flex flex-wrap gap-2 items-center">
        <span className="text-sm font-medium text-[var(--md-sys-color-on-surface-variant)] mr-2">
          Target Instance:
        </span>
        {instances.length === 0 ? (
          <span className="text-sm text-[var(--md-sys-color-on-surface-variant)]">
            No instances registered. Add one in Instances tab first.
          </span>
        ) : (
          instances.map((inst) => (
            <Chip
              key={inst.id}
              variant="filter"
              selected={selectedInstanceId === inst.id}
              onClick={() => setSelectedInstanceId(inst.id)}
            >
              {inst.name} (v{inst.version})
            </Chip>
          ))
        )}
      </Card>

      {selectedInstance ? (
        <>
          {/* Header Controls: Service Tabs, Search & Save */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex gap-2">
                {["backend", "frontend"].map((svc) => {
                  const svcData = services.find((s) => s.service_id === svc);
                  const count = svcData?.variables.length || 0;
                  return (
                    <Chip
                      key={svc}
                      variant="filter"
                      selected={activeService === svc}
                      onClick={() => {
                        setActiveService(svc);
                        setSelectedCategory(null);
                      }}
                    >
                      {svc.charAt(0).toUpperCase() + svc.slice(1)} ({count})
                    </Chip>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                <Button variant="text" size="sm" onClick={load} disabled={loading}>
                  <RefreshCw size={14} className={loading ? "animate-spin mr-1" : "mr-1"} />
                  Reload Template
                </Button>
                <Button
                  variant="filled"
                  size="sm"
                  onClick={save}
                  disabled={!dirty || saving}
                >
                  {saving ? (
                    <Loader2 size={14} className="animate-spin mr-1.5" />
                  ) : dirty ? (
                    <Save size={14} className="mr-1.5" />
                  ) : (
                    <CheckCircle2 size={14} className="mr-1.5" />
                  )}
                  {dirty ? "Save Changes" : "Saved"}
                </Button>
              </div>
            </div>

            {/* Target file location indicator */}
            <div className="flex items-center justify-between text-xs text-[var(--md-sys-color-on-surface-variant)] px-1">
              <span className="flex items-center gap-1.5 font-mono">
                <FileCode size={14} className="text-[var(--md-sys-color-primary)]" />
                Target file:{" "}
                <code className="bg-[var(--md-sys-color-surface-container-highest)] px-1.5 py-0.5 rounded">
                  {activeServiceData?.path ||
                    (activeService === "backend" ? "backend/.env" : "frontend/.env.local")}
                </code>
              </span>
              <span>
                {activeServiceData?.variables.length || 0} variables pre-populated from{" "}
                <code>.env.example</code>
              </span>
            </div>

            {/* Search and Category Filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search
                  size={15}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--md-sys-color-on-surface-variant)]"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter variables by name or keyword (e.g. PORT, AUTH, DATABASE)..."
                  className="w-full h-9 pl-9 pr-3 rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-highest)] text-xs text-[var(--md-sys-color-on-surface)] outline-none focus:border-[var(--md-sys-color-primary)] font-mono"
                />
              </div>

              <div className="flex gap-1.5 flex-wrap">
                <Chip
                  variant="filter"
                  selected={selectedCategory === null}
                  onClick={() => setSelectedCategory(null)}
                >
                  All
                </Chip>
                {ENV_CATEGORIES.map((cat) => (
                  <Chip
                    key={cat}
                    variant="filter"
                    selected={selectedCategory === cat}
                    onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                  >
                    {cat}
                  </Chip>
                ))}
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)] p-4 text-sm">
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center gap-3 text-[var(--md-sys-color-on-surface-variant)] py-8 justify-center">
              <Loader2 size={20} className="animate-spin text-[var(--md-sys-color-primary)]" />
              <span>Loading environment variables & template…</span>
            </div>
          )}

          {/* Variables by category */}
          {!loading &&
            ENV_CATEGORIES.map((cat) => {
              const vars = variablesByCategory[cat];
              if (!vars || vars.length === 0) return null;
              return (
                <Card key={cat} variant="outlined" className="p-5 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--md-sys-color-primary)]">
                      {cat} ({vars.length})
                    </h3>
                  </div>
                  <div className="flex flex-col gap-3">
                    {vars.map((v) => (
                      <EnvVarRow
                        key={v.key}
                        variable={v}
                        onUpdate={(key, value) => updateVar(activeService, key, value)}
                        onRemove={(key) => removeVar(activeService, key)}
                      />
                    ))}
                  </div>
                </Card>
              );
            })}

          {/* No results search fallback */}
          {!loading && filteredVariables.length === 0 && (
            <Card variant="filled" className="p-8 text-center text-xs text-[var(--md-sys-color-on-surface-variant)]">
              No environment variables match your search filter "{searchQuery}".
            </Card>
          )}

          {/* Add custom variable card */}
          <Card variant="outlined" className="p-5 flex flex-col gap-4">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[var(--md-sys-color-secondary)]">
                Add Custom Variable
              </h3>
              <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] mt-1">
                Need an extra variable not in the template? Add it here.
              </p>
            </div>
            <div className="flex gap-3 items-end flex-wrap">
              <div className="flex flex-col gap-1 w-64 shrink-0">
                <label className="text-xs font-medium text-[var(--md-sys-color-on-surface-variant)] ml-1">
                  Variable Name
                </label>
                <input
                  type="text"
                  value={addKey}
                  onChange={(e) => setAddKey(e.target.value.toUpperCase())}
                  onKeyDown={(e) => { if (e.key === "Enter" && addKey.trim()) handleAdd(); }}
                  placeholder="CUSTOM_VAR_NAME"
                  className="h-10 px-3 rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-highest)] text-sm text-[var(--md-sys-color-on-surface)] font-mono outline-none focus:border-[var(--md-sys-color-primary)] focus:ring-1 focus:ring-[var(--md-sys-color-primary)]/30 transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
                <label className="text-xs font-medium text-[var(--md-sys-color-on-surface-variant)] ml-1">
                  Value
                </label>
                <input
                  type="text"
                  value={addValue}
                  onChange={(e) => setAddValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && addKey.trim()) handleAdd(); }}
                  placeholder="Enter value..."
                  className="h-10 px-3 rounded-xl border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-highest)] text-sm text-[var(--md-sys-color-on-surface)] font-mono outline-none focus:border-[var(--md-sys-color-primary)] focus:ring-1 focus:ring-[var(--md-sys-color-primary)]/30 transition-colors"
                />
              </div>
              <Button
                variant="tonal"
                onClick={handleAdd}
                disabled={!addKey.trim()}
                title="Add this variable (or press Enter)"
              >
                <Plus size={16} className="mr-1" /> Add Variable
              </Button>
            </div>
          </Card>
        </>
      ) : (
        <Card variant="filled" className="p-10 flex flex-col items-center gap-3 text-center">
          <p className="text-[var(--md-sys-color-on-surface-variant)]">
            Select an instance above to manage its environment variables.
          </p>
        </Card>
      )}
    </div>
  );
}
