import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { isFeatureDisabledError } from "@/lib/features";
import type { ParentChild } from "@/lib/parent";

interface ParentState {
  children: ParentChild[];
  selected: ParentChild | null;
  select: (id: string) => void;
  reload: () => Promise<void>;
  loading: boolean;
  /** The parent portal is off for every linked child's school. */
  disabled: boolean;
  failed: boolean;
}

const Ctx = createContext<ParentState | null>(null);

/** The parent's linked children and which one the tabs are showing. */
export function ParentProvider({ children: node }: { children: ReactNode }) {
  const [kids, setKids] = useState<ParentChild[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const list = await api<ParentChild[]>("/parent/children");
      setKids(list);
      setDisabled(false);
      setFailed(false);
      setSelectedId((cur) => (cur && list.some((c) => c.id === cur) ? cur : (list[0]?.id ?? null)));
    } catch (err) {
      setKids([]);
      if (isFeatureDisabledError(err)) setDisabled(true);
      else setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selected = kids.find((c) => c.id === selectedId) ?? null;

  return (
    <Ctx.Provider
      value={{ children: kids, selected, select: setSelectedId, reload, loading, disabled, failed }}
    >
      {node}
    </Ctx.Provider>
  );
}

export function useParent(): ParentState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useParent must be used inside <ParentProvider>");
  return ctx;
}
