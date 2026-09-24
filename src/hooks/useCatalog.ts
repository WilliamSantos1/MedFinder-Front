import { useEffect, useState } from 'react';
import type { CatalogMeta } from '../../shared/contracts';
import { api } from '../lib/api';

export function useCatalog() {
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<CatalogMeta>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api
      .catalog(controller.signal)
      .then((result) => {
        setData(result);
        setError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [attempt]);
  return {
    data,
    error,
    retry: () => {
      setError(false);
      setAttempt((value) => value + 1);
    },
  };
}
