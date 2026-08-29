import { useCallback } from "react";
import api from "../services/api.js";
import usePolling from "./usePolling.js";

/** @param {{resolved: boolean, deviceId?: string}} filter */
export default function useAlerts({ resolved, deviceId }, interval = 5000) {
  const { data, refresh, ...rest } = usePolling(
    () => {
      const params = { is_resolved: resolved };
      if (deviceId) params.device = deviceId;
      return api.get("/alerts/", { params }).then((r) => r.data);
    },
    [resolved, deviceId],
    interval,
  );

  const resolve = useCallback(
    async (alertId) => {
      await api.post(`/alerts/${alertId}/resolve/`);
      await refresh();
    },
    [refresh],
  );

  return { alerts: data?.results ?? [], total: data?.count ?? 0, resolve, refresh, ...rest };
}
