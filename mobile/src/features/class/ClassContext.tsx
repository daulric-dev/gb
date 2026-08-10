import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import type { ClassInfo } from "@/lib/types";

interface ClassContextValue {
  classId: string;
  classInfo: ClassInfo | null;
  loading: boolean;
}

const ClassContext = createContext<ClassContextValue | null>(null);

/**
 * Fetches the class from GET /classes once and shares it across the class
 * detail screens (overview / grading / attendance), avoiding the web app's
 * per-screen refetch.
 */
export function ClassProvider({
  classId,
  children,
}: {
  classId: string;
  children: ReactNode;
}) {
  const [classInfo, setClassInfo] = useState<ClassInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api<ClassInfo[]>("/classes")
      .then((list) => {
        if (active) setClassInfo(list.find((c) => c.id === classId) ?? null);
      })
      .catch(() => {
        if (active) setClassInfo(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [classId]);

  return (
    <ClassContext.Provider value={{ classId, classInfo, loading }}>
      {children}
    </ClassContext.Provider>
  );
}

export function useClass(): ClassContextValue {
  const ctx = useContext(ClassContext);
  if (!ctx) throw new Error("useClass must be used inside <ClassProvider>");
  return ctx;
}
