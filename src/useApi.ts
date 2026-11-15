import { useEffect, useState } from "react";
import { api } from "./lib/api";
export function useApi<T>(path: string) {
  const [state, setState] = useState<{
    data: T | null;
    error: string;
    loading: boolean;
  }>({ data: null, error: "", loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState({ data: null, error: "", loading: true });
    api<T>(path, { signal: controller.signal })
      .then((data) => setState({ data, error: "", loading: false }))
      .catch((error: Error) => {
        if (error.name !== "AbortError")
          setState({ data: null, error: error.message, loading: false });
      });
    return () => controller.abort();
  }, [path]);
  return state;
}
