import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { Link } from "react-router-dom";
import {
  Compass,
  ExternalLink,
  MapPin,
  Unlock,
  Volume2,
  VolumeX,
} from "lucide-react";
import Button from "./Button.jsx";
import StatusBadge from "./StatusBadge.jsx";
import {
  detectionState,
  deviceHealth,
  formatDistance,
  formatReading,
  isAlarm,
  mapsUrl,
  nearestDistance,
  timeAgo,
} from "../utils/format.js";

const STREET_TILE = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
  attribution: "Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ",
};

const DEFAULT_CENTER = [-6.208763, 106.845599]; // Jakarta default

const STATUS_CONFIG = {
  alert: { label: "Pelanggaran", color: "bg-danger", hex: "#ef4444", fill: "#ef4444" },
  tracking: { label: "Objek terdeteksi", color: "bg-warn", hex: "#f59e0b", fill: "#f59e0b" },
  ok: { label: "Aman", color: "bg-accent", hex: "#10b981", fill: "#10b981" },
  offline: { label: "Offline", color: "bg-muted", hex: "#94a3b8", fill: "#94a3b8" },
};

function pinIcon(healthKey) {
  return L.divIcon({
    className: "",
    html: `<div class="map-pin map-pin--${healthKey}"><span></span></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  });
}

const ICONS = Object.fromEntries(
  ["ok", "tracking", "alert", "offline"].map((key) => [key, pinIcon(key)])
);

/** Controls map view framing and recentering. */
function MapController({ points, triggerRecenter, singleDevice }) {
  const map = useMap();
  useEffect(() => {
    if (!points || points.length === 0) return;
    if (points.length === 1 || singleDevice) {
      map.setView(points[0], 17, { animate: true });
    } else {
      map.fitBounds(points, { padding: [48, 48], maxZoom: 17, animate: true });
    }
  }, [points, map, triggerRecenter, singleDevice]);
  return null;
}

export default function MapPanel({
  devices = [],
  className = "h-[420px] lg:h-[480px]",
  onRelease,
  singleDevice = false,
}) {
  const [filter, setFilter] = useState("all"); // all | alert | tracking | ok | offline
  const [recenterCount, setRecenterCount] = useState(0);

  // Group counts for legend & filter tags
  const counts = useMemo(() => {
    const res = { all: devices.length, alert: 0, tracking: 0, ok: 0, offline: 0 };
    for (const d of devices) {
      const h = deviceHealth(d).key;
      if (res[h] !== undefined) res[h] += 1;
    }
    return res;
  }, [devices]);

  // Filtered devices
  const filteredDevices = useMemo(() => {
    if (filter === "all") return devices;
    return devices.filter((d) => deviceHealth(d).key === filter);
  }, [devices, filter]);

  const points = useMemo(() => {
    return filteredDevices
      .filter((d) => d.latitude != null && d.longitude != null)
      .map((d) => [Number(d.latitude), Number(d.longitude)]);
  }, [filteredDevices]);

  return (
    <div
      role="region"
      aria-label="Peta pemantauan Leaflet"
      className={`relative isolate overflow-hidden rounded-b-panel border-t border-line ${className}`}
    >
      {/* Top Floating Controls Bar */}
      <div className="absolute left-3 right-3 top-3 z-[600] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        {/* Status Filter Chips (only shown if multi-device) */}
        {!singleDevice && devices.length > 1 && (
          <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-control border border-line bg-surface/95 p-1 shadow-md backdrop-blur-sm">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                filter === "all" ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
              }`}
            >
              Semua ({counts.all})
            </button>
            {counts.alert > 0 && (
              <button
                type="button"
                onClick={() => setFilter("alert")}
                className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                  filter === "alert" ? "bg-danger text-on-danger" : "text-danger hover:bg-danger/10"
                }`}
              >
                <span className="h-2 w-2 rounded-full bg-danger animate-ping" />
                Pelanggaran ({counts.alert})
              </button>
            )}
            {counts.tracking > 0 && (
              <button
                type="button"
                onClick={() => setFilter("tracking")}
                className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                  filter === "tracking" ? "bg-warn text-white" : "text-warn-text hover:bg-warn/10"
                }`}
              >
                Objek ({counts.tracking})
              </button>
            )}
            <button
              type="button"
              onClick={() => setFilter("ok")}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
                filter === "ok" ? "bg-accent text-accent-ink" : "text-muted hover:text-ink"
              }`}
            >
              Aman ({counts.ok})
            </button>
          </div>
        )}

        {/* Right Map Actions (Recenter button only) */}
        <div className="pointer-events-auto ml-auto">
          <button
            type="button"
            title="Pusatkan kembali peta"
            onClick={() => setRecenterCount((c) => c + 1)}
            className="flex items-center gap-1.5 rounded-control border border-line bg-surface/95 px-2.5 py-1.5 text-xs font-semibold text-ink shadow-md backdrop-blur-sm hover:bg-sunken transition-colors"
          >
            <Compass className="h-3.5 w-3.5 text-tech-text" aria-hidden />
            <span>Pusatkan</span>
          </button>
        </div>
      </div>

      {/* Leaflet Map Container */}
      <MapContainer
        center={points[0] ?? DEFAULT_CENTER}
        zoom={singleDevice ? 17 : 15}
        scrollWheelZoom={true}
        className="h-full w-full"
      >
        <TileLayer
          url={STREET_TILE.url}
          attribution={STREET_TILE.attribution}
          maxZoom={19}
        />
        <MapController
          points={points}
          triggerRecenter={recenterCount}
          singleDevice={singleDevice}
        />

        {filteredDevices.map((device) => {
          if (device.latitude == null || device.longitude == null) return null;
          const health = deviceHealth(device);
          const distance = nearestDistance(device);
          const config = STATUS_CONFIG[health.key] || STATUS_CONFIG.offline;
          const anyAlarm = device.units?.some(isAlarm);
          const pos = [Number(device.latitude), Number(device.longitude)];

          // Visual detection zone radius (scales with tolerant distance, minimum 14m for visibility)
          const radiusMeters = Math.max(14, (device.tolerant_distance_cm || 150) / 10);

          return (
            <div key={device.device_id}>
              {/* Detection coverage area */}
              <Circle
                center={pos}
                radius={radiusMeters}
                pathOptions={{
                  color: config.hex,
                  fillColor: config.fill,
                  fillOpacity: anyAlarm ? 0.28 : 0.12,
                  weight: anyAlarm ? 2 : 1,
                  dashArray: anyAlarm ? undefined : "4, 4",
                }}
              />

              {/* Marker pin with status and radar ripple */}
              <Marker position={pos} icon={ICONS[health.key]}>
                <Popup className="custom-leaflet-popup" minWidth={260} maxWidth={320}>
                  <div className="space-y-2 p-1 text-sm">
                    {/* Header */}
                    <div className="border-b border-line pb-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="font-bold text-ink leading-tight">{device.name}</h4>
                        <StatusBadge tone={device.is_online ? "ok" : "offline"}>
                          {device.is_online ? "Online" : "Offline"}
                        </StatusBadge>
                      </div>
                      <p className="mono-id text-[11px] text-muted truncate mt-0.5">{device.device_id}</p>
                    </div>

                    {/* Status condition */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted">Kondisi titik:</span>
                      <StatusBadge tone={health.tone}>{health.label}</StatusBadge>
                    </div>

                    {/* Measurements summary */}
                    <div className="grid grid-cols-2 gap-2 rounded bg-sunken/60 p-2 text-xs">
                      <div>
                        <span className="block text-muted text-[11px]">Jarak terdekat</span>
                        <strong className="text-ink font-semibold">{formatDistance(distance)}</strong>
                      </div>
                      <div>
                        <span className="block text-muted text-[11px]">Batas toleransi</span>
                        <span className="text-ink">{formatDistance(device.tolerant_distance_cm)}</span>
                      </div>
                      <div>
                        <span className="block text-muted text-[11px]">Batas waktu</span>
                        <span className="text-ink">{device.timeout_seconds} dtk</span>
                      </div>
                      <div>
                        <span className="block text-muted text-[11px]">Terakhir terlihat</span>
                        <span className="text-muted">{timeAgo(device.last_seen)}</span>
                      </div>
                    </div>

                    {/* Units list */}
                    {device.units && device.units.length > 0 && (
                      <div className="space-y-1 pt-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">
                          Unit Radar ({device.units.length})
                        </span>
                        <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
                          {device.units.map((u) => {
                            const uState = detectionState(u.detection_state);
                            const uAlarm = isAlarm(u);
                            return (
                              <div
                                key={u.unit_id}
                                className={`flex items-center justify-between rounded px-2 py-1 text-xs ${
                                  uAlarm ? "bg-danger/10 border border-danger/30 text-danger" : "bg-sunken/40"
                                }`}
                              >
                                <span className="font-semibold">Unit {u.unit_id}</span>
                                <span className="text-muted font-mono">{formatReading(u.last_distance_cm)}</span>
                                <div className="flex items-center gap-1">
                                  {u.buzzer_active ? (
                                    <Volume2 className="h-3.5 w-3.5 text-danger animate-pulse" title="Buzzer Menyala" />
                                  ) : (
                                    <VolumeX className="h-3.5 w-3.5 text-muted" title="Buzzer Mati" />
                                  )}
                                  <StatusBadge tone={uState.tone}>{uState.label}</StatusBadge>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Quick action: release alarms directly from popup */}
                    {anyAlarm && onRelease && (
                      <Button
                        size="sm"
                        variant="danger"
                        icon={Unlock}
                        className="w-full mt-2"
                        onClick={() => onRelease(device.device_id)}
                      >
                        Lepas alarm di titik ini
                      </Button>
                    )}

                    {/* Action links */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2 text-xs">
                      <Link
                        to={`/devices/${device.device_id}`}
                        className="font-semibold text-tech-text hover:underline"
                      >
                        Buka detail & unit &rarr;
                      </Link>
                      <a
                        href={mapsUrl(device.latitude, device.longitude)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-muted hover:text-ink font-medium"
                      >
                        <ExternalLink className="h-3 w-3" aria-hidden /> Google Maps
                      </a>
                    </div>
                  </div>
                </Popup>
              </Marker>
            </div>
          );
        })}
      </MapContainer>

      {/* Interactive Legend (Bottom Left) */}
      <ul
        className="pointer-events-auto absolute bottom-3 left-3 z-[600] flex flex-wrap gap-x-3 gap-y-1 rounded-control border border-line bg-surface/95 px-3 py-1.5 text-[11px] font-medium shadow-md backdrop-blur-sm"
        aria-label="Legenda status peta"
      >
        {Object.entries(STATUS_CONFIG).map(([key, item]) => (
          <li
            key={key}
            onClick={() => setFilter(filter === key ? "all" : key)}
            className={`flex items-center gap-1.5 cursor-pointer transition-opacity ${
              filter !== "all" && filter !== key ? "opacity-40" : "opacity-100"
            }`}
            title={`Klik untuk filter hanya ${item.label}`}
          >
            <span className={`h-2.5 w-2.5 rounded-full ${item.color}`} aria-hidden />
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
