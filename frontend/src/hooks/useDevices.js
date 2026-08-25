import api from "../services/api.js";
import usePolling from "./usePolling.js";

export default function useDevices(interval = 5000) {
  const { data, ...rest } = usePolling(() => api.get("/devices/").then((r) => r.data), [], interval);
  return { devices: data ?? [], ...rest };
}
