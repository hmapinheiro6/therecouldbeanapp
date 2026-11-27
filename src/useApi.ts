import { useContext, useEffect, useRef, useState } from "react";
import { api } from "./lib/api";
import { InitialData, initialData } from "./lib/initial-data";
export function useApi<T>(path: string) {
  const provided = useContext(InitialData);
  const [state, setState] = useState<{
    data: T | null;
    error: string;
    loading: boolean;
  }>(() => {
    const data = (provided ? provided(path) : initialData(path)) as
      T | undefined;
    return { data: data ?? null, error: "", loading: data === undefined };
  });
  const previousPath = useRef(path);
  useEffect(() => {
    const controller = new AbortController();
    if (previousPath.current !== path)
      setState({ data: null, error: "", loading: true });
    previousPath.current = path;
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
