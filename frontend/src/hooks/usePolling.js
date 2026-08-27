import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Calls `fetcher` now and then every `interval` ms (paused while the tab is hidden).
 * `loading` is true only for the first load, so refreshes never flash skeletons.
 */
export default function usePolling(fetcher, deps = [], interval = 5000) {
  const [state, setState] = useState({ data: null, error: null, loading: true, updatedAt: null });
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    try {
      const data = await fetcherRef.current();
      setState({ data, error: null, loading: false, updatedAt: new Date() });
    } catch (error) {
      setState((previous) => ({ ...previous, error, loading: false }));
    }
  }, []);

  useEffect(() => {
    setState((previous) => ({ ...previous, loading: true }));
    refresh();
    const timer = setInterval(() => {
      if (!document.hidden) refresh();
    }, interval);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, interval, refresh]);

  return { ...state, refresh };
}
