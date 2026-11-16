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
  const snapshotAt =
    state.data &&
    typeof state.data === "object" &&
    "snapshot_at" in state.data &&
    typeof state.data.snapshot_at === "string"
      ? state.data.snapshot_at
      : null;
  return { ...state, snapshotAt };
}
