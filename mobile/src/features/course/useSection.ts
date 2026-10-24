import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Loads one section of a course screen and reloads it whenever `refreshKey`
 * changes (the screen's pull-to-refresh). `failed` is true when the last load
 * threw, so a section can show its own error rather than an empty list.
 */
export function useSection<T>(
  loader: () => Promise<T>,
  refreshKey: number,
): {
  data: T | null;
  loading: boolean;
  failed: boolean;
  reload: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    try {
      setData(await loaderRef.current());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    let live = true;
    loaderRef
      .current()
      .then((d) => {
        if (!live) return;
        setData(d);
        setFailed(false);
      })
      .catch(() => live && setFailed(true))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [refreshKey]);

  return { data, loading, failed, reload };
}
