import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

interface Result<T> {
  key: string;
  data: T | null;
  error: string | null;
}

/**
 * GET `path` on mount and whenever it changes. While a new request is in flight the previous
 * data stays visible, so filters and reloads don't flash an empty page.
 */
export function useApi<T>(path: string) {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<Result<T> | null>(null);
  const key = `${version}:${path}`;

  useEffect(() => {
    let cancelled = false;
    api<T>(path).then(
      (data) => {
        if (!cancelled) setResult({ key, data, error: null });
      },
      (e: Error) => {
        if (!cancelled) setResult((prev) => ({ key, data: prev?.data ?? null, error: e.message }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, path]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return {
    data: result?.data ?? null,
    error: result?.key === key ? result.error : null,
    loading: result?.key !== key,
    reload,
  };
}
