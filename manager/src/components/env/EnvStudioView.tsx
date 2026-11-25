import { useState, useEffect } from "react";
import { useInstances } from "@/hooks/useInstances";
import { useEnv } from "@/hooks/useEnv";
import { Card } from "@/components/m3/Card";
import { Button } from "@/components/m3/Button";
import { TextField } from "@/components/m3/TextField";
import { Chip } from "@/components/m3/Chip";
import { Loader2, Save, Plus, Trash2, AlertTriangle, RefreshCw } from "lucide-react";
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
  if (k.includes("database") || k.includes("postgres") || k.includes("db_") || k === "database_url") return "Database";
  if (k.includes("secret") || k.includes("jwt") || k.includes("auth") || k.includes("key") || k.includes("token")) return "Security";
  if (k.includes("storage") || k.includes("s3") || k.includes("bucket") || k.includes("r2") || k.includes("cloudflare")) return "Storage";
  if (k.includes("email") || k.includes("smtp") || k.includes("sendgrid") || k.includes("mail")) return "Email";
  if (k.includes("openai") || k.includes("anthropic") || k.includes("deepseek") || k.includes("gemini") || k.includes("ai_")) return "AI";
  if (k.includes("port") || k.includes("host") || k.includes("url") || k.includes("node_env") || k.includes("next_public")) return "Core";
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
    <div className="flex items-start gap-3">
      <div className="w-56 shrink-0">
        <TextField
          label="Key"
          value={variable.key}
          readOnly
          className="font-mono text-sm"
        />
      </div>
      <div className="flex-1">
        <TextField
          label="Value"
          value={variable.value}
          onChange={(e) => onUpdate(variable.key, e.target.value)}
          isSecret={variable.is_secret}
          className="font-mono text-sm"
        />
      </div>
      <button
        onClick={() => onRemove(variable.key)}
        className="mt-4 p-2 rounded-full hover:bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-error)] transition-colors"
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

export function EnvStudioView() {
  const { instances } = useInstances();
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [activeService, setActiveService] = useState<string>("backend");

  const selectedInstance = instances.find((i) => i.id === selectedInstanceId) ?? null;
  const { services, loading, saving, error, dirty, load, updateVar, addVar, removeVar, save } =
    useEnv(selectedInstance?.root_path ?? null);

  useEffect(() => {
    if (selectedInstance) load();
  }, [selectedInstance, load]);

  const activeServiceData = services.find((s) => s.service_id === activeService);
  const variablesByCategory = ENV_CATEGORIES.reduce(
    (acc, cat) => {
      acc[cat] = (activeServiceData?.variables ?? []).filter(
        (v) => categorize(v.key) === cat
      );
      return acc;
    },
    {} as Record<string, EnvVariable[]>
  );

  const [addKey, setAddKey] = useState("");
  const [addValue, setAddValue] = useState("");

  const handleAdd = () => {
    if (!addKey.trim()) return;
    addVar(activeService, {
      key: addKey.trim().toUpperCase(),
      value: addValue,
      is_secret: addKey.toLowerCase().includes("secret") || addKey.toLowerCase().includes("key"),
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
          Instance:
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
              selected={selectedInstanceId === inst.id}
              onClick={() => setSelectedInstanceId(inst.id)}
            >{inst.name}</Chip>
          ))
        )}
      </Card>

      {selectedInstance ? (
        <>
          {/* Service tabs */}
          <div className="flex gap-2">
            {["backend", "frontend"].map((svc) => (
              <Chip
                key={svc}
                variant="filter"
                label={svc.charAt(0).toUpperCase() + svc.slice(1)}
                selected={activeService === svc}
                onClick={() => setActiveService(svc)}
              />
            ))}
            <div className="flex-1" />
            <Button variant="text" onClick={load} disabled={loading}>
              <RefreshCw size={15} className={loading ? "animate-spin mr-1" : "mr-1"} />
              Reload
            </Button>
            <Button
              variant="filled"
              onClick={save}
              disabled={!dirty || saving}
            >
              {saving ? (
                <Loader2 size={15} className="animate-spin mr-1" />
              ) : (
                <Save size={15} className="mr-1" />
              )}
              {dirty ? "Save Changes" : "Saved"}
            </Button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)] p-4 text-sm">
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center gap-3 text-[var(--md-sys-color-on-surface-variant)]">
              <Loader2 size={18} className="animate-spin" /> Loading environment…
            </div>
          )}

          {/* Variables by category */}
          {!loading && ENV_CATEGORIES.map((cat) => {
            const vars = variablesByCategory[cat];
            if (vars.length === 0) return null;
            return (
              <Card key={cat} variant="outlined" className="p-5 flex flex-col gap-4">
                <h3 className="text-sm font-semibold uppercase tracking-widest text-[var(--md-sys-color-primary)]">
                  {cat}
                </h3>
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

          {/* Add new variable */}
          <Card variant="outlined" className="p-5 flex flex-col gap-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest text-[var(--md-sys-color-secondary)]">
              Add Variable
            </h3>
            <div className="flex gap-3 items-end">
              <div className="w-56 shrink-0">
                <TextField
                  label="Key"
                  value={addKey}
                  onChange={(e) => setAddKey(e.target.value)}
                  placeholder="MY_VAR"
                  className="font-mono"
                />
              </div>
              <div className="flex-1">
                <TextField
                  label="Value"
                  value={addValue}
                  onChange={(e) => setAddValue(e.target.value)}
                  className="font-mono"
                />
              </div>
              <Button variant="tonal" onClick={handleAdd} disabled={!addKey.trim()}>
                <Plus size={16} className="mr-1" /> Add
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
