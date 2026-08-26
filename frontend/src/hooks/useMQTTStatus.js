import { useMemo } from "react";

/** Fleet connectivity derived from device heartbeats (telemetry arrives every ~5 s per unit). */
export default function useMQTTStatus(devices) {
  return useMemo(() => {
    const online = devices.filter((device) => device.is_online).length;
    return {
      total: devices.length,
      online,
      offline: devices.length - online,
      openAlerts: devices.reduce((sum, device) => sum + (device.open_alert_count ?? 0), 0),
    };
  }, [devices]);
}
