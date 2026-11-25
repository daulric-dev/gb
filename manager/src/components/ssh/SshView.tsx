import { useState, useCallback } from "react";
import { Card } from "@/components/m3/Card";
import { Button } from "@/components/m3/Button";
import { TextField } from "@/components/m3/TextField";
import { Chip } from "@/components/m3/Chip";
import { testSshConnection, executeRemoteCommand } from "@/hooks/useIpc";
import {
  Plus,
  XCircle,
  Loader2,
  Terminal,
  Trash2,
  Play,
} from "lucide-react";

interface SshProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
}

function ProfileCard({
  profile,
  active,
  onSelect,
  onRemove,
}: {
  profile: SshProfile;
  active: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  return (
    <Card
      variant={active ? "filled" : "outlined"}
      className={`p-4 flex items-center gap-4 cursor-pointer transition-colors ${active ? "" : "hover:bg-[var(--md-sys-color-surface-variant)]"}`}
      onClick={onSelect}
    >
      <Terminal size={20} className="text-[var(--md-sys-color-primary)] shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-[var(--md-sys-color-on-surface)] truncate">{profile.name}</p>
        <p className="text-xs text-[var(--md-sys-color-on-surface-variant)] font-mono">
          {profile.user}@{profile.host}:{profile.port}
        </p>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="p-1.5 rounded-full hover:bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-error)] transition-colors"
      >
        <Trash2 size={14} />
      </button>
    </Card>
  );
}

export function SshView() {
  const [profiles, setProfiles] = useState<SshProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // Add form state
  const [form, setForm] = useState({ name: "", host: "", port: "22", user: "", password: "" });

  // Terminal state
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);

  const activeProfile = profiles.find((p) => p.id === activeId) ?? null;

  const handleAdd = () => {
    if (!form.name || !form.host || !form.user) return;
    const p: SshProfile = {
      id: crypto.randomUUID(),
      name: form.name,
      host: form.host,
      port: parseInt(form.port) || 22,
      user: form.user,
      password: form.password,
    };
    setProfiles((prev) => [...prev, p]);
    setForm({ name: "", host: "", port: "22", user: "", password: "" });
    setShowAdd(false);
  };

  const handleTest = useCallback(async () => {
    if (!activeProfile) return;
    setTesting(true);
    setTestResult(null);
    try {
      const ok = await testSshConnection(
        activeProfile.host,
        activeProfile.port,
        activeProfile.user,
        activeProfile.password || undefined
      );
      setTestResult(ok);
    } catch {
      setTestResult(false);
    } finally {
      setTesting(false);
    }
  }, [activeProfile]);

  const handleRun = useCallback(async () => {
    if (!activeProfile || !command.trim()) return;
    setRunning(true);
    try {
      const result = await executeRemoteCommand(
        activeProfile.host,
        activeProfile.port,
        activeProfile.user,
        command,
        activeProfile.password || undefined
      );
      setOutput((prev) => [
        ...prev,
        `$ ${command}`,
        result,
        "─".repeat(40),
      ]);
      setCommand("");
    } catch (e) {
      setOutput((prev) => [...prev, `$ ${command}`, `Error: ${e}`, "─".repeat(40)]);
    } finally {
      setRunning(false);
    }
  }, [activeProfile, command]);

  return (
    <div className="flex gap-6 h-full max-w-5xl mx-auto">
      {/* Left sidebar — profiles */}
      <div className="w-64 shrink-0 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-[var(--md-sys-color-on-surface-variant)] uppercase tracking-wider">
            Profiles
          </span>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="p-1.5 rounded-full hover:bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-secondary)] transition-colors"
          >
            <Plus size={16} />
          </button>
        </div>

        {/* Add profile form */}
        {showAdd && (
          <Card variant="outlined" className="p-4 flex flex-col gap-3">
            <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextField label="Host" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} placeholder="example.com" />
            <TextField label="Port" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
            <TextField label="User" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} />
            <TextField label="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} isSecret />
            <div className="flex gap-2">
              <Button variant="text" onClick={() => setShowAdd(false)} className="flex-1">Cancel</Button>
              <Button variant="filled" onClick={handleAdd} disabled={!form.name || !form.host || !form.user} className="flex-1">Add</Button>
            </div>
          </Card>
        )}

        {profiles.length === 0 && !showAdd && (
          <p className="text-xs text-[var(--md-sys-color-on-surface-variant)]">
            No profiles yet. Click <strong>+</strong> to add one.
          </p>
        )}

        {profiles.map((p) => (
          <ProfileCard
            key={p.id}
            profile={p}
            active={activeId === p.id}
            onSelect={() => { setActiveId(p.id); setOutput([]); setTestResult(null); }}
            onRemove={() => {
              setProfiles((prev) => prev.filter((x) => x.id !== p.id));
              if (activeId === p.id) setActiveId(null);
            }}
          />
        ))}
      </div>

      {/* Right — terminal */}
      <div className="flex-1 flex flex-col gap-4">
        {activeProfile ? (
          <>
            {/* Connection header */}
            <Card variant="filled" className="p-4 flex items-center gap-4">
              <div className="flex-1">
                <p className="font-semibold text-[var(--md-sys-color-on-surface)]">{activeProfile.name}</p>
                <p className="text-xs font-mono text-[var(--md-sys-color-on-surface-variant)]">
                  {activeProfile.user}@{activeProfile.host}:{activeProfile.port}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {testResult !== null && (
                  testResult
                    ? <Chip variant="filter" label="Connected" selected />
                    : <span className="flex items-center gap-1 text-sm text-[var(--md-sys-color-error)]">
                        <XCircle size={14} /> Failed
                      </span>
                )}
                <Button variant="tonal" onClick={handleTest} disabled={testing}>
                  {testing ? <Loader2 size={15} className="animate-spin mr-1" /> : null}
                  Test Connection
                </Button>
              </div>
            </Card>

            {/* Output terminal */}
            <Card variant="outlined" className="flex-1 flex flex-col overflow-hidden">
              <div className="bg-[#1a1a2e] rounded-t-xl px-4 py-2 flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="ml-2 text-xs text-gray-400 font-mono">{activeProfile.user}@{activeProfile.host}</span>
              </div>
              <div className="flex-1 overflow-y-auto bg-[#0d1117] p-4 font-mono text-xs text-green-400 leading-relaxed min-h-[200px]">
                {output.length === 0 ? (
                  <span className="text-gray-600">— No output yet. Run a command below. —</span>
                ) : (
                  output.map((line, i) => (
                    <div key={i} className={line.startsWith("$") ? "text-cyan-400 mt-2" : line.startsWith("─") ? "text-gray-700" : ""}>
                      {line}
                    </div>
                  ))
                )}
              </div>
              {/* Command input */}
              <div className="flex gap-2 p-3 bg-[#0d1117] border-t border-[#30363d]">
                <span className="text-green-400 font-mono text-sm mt-2">$</span>
                <input
                  className="flex-1 bg-transparent text-green-300 font-mono text-sm outline-none placeholder:text-gray-600"
                  placeholder="Enter command…"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !running && handleRun()}
                  disabled={running}
                />
                <button
                  onClick={handleRun}
                  disabled={running || !command.trim()}
                  className="p-1.5 rounded text-green-400 hover:bg-green-900/30 disabled:opacity-40 transition-colors"
                >
                  {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                </button>
              </div>
            </Card>
          </>
        ) : (
          <Card variant="filled" className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-center">
              <Terminal size={40} className="text-[var(--md-sys-color-on-surface-variant)]" />
              <p className="text-[var(--md-sys-color-on-surface-variant)]">
                Select or add an SSH profile to get started.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
