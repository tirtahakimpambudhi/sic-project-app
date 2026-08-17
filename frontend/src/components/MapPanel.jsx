import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { Link } from "react-router-dom";
import { useTheme } from "../context/ThemeContext.jsx";
import { deviceHealth, formatDistance, mapsUrl, nearestDistance, timeAgo } from "../utils/format.js";
import StatusBadge from "./StatusBadge.jsx";

const TILES = {
  light: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
};
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
const DEFAULT_CENTER = [-7.797068, 110.370529]; // Yogyakarta, used only when there is no device yet

const LEGEND = [
  { key: "ok", label: "Aman", color: "bg-accent" },
  { key: "tracking", label: "Objek terdeteksi", color: "bg-warn" },
  { key: "alert", label: "Pelanggaran", color: "bg-danger" },
  { key: "offline", label: "Offline", color: "bg-muted" },
];

function pinIcon(healthKey) {
  return L.divIcon({
    className: "",
    html: `<div class="map-pin map-pin--${healthKey}"><span></span></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12],
  });
}

// Created once: react-leaflet swaps a marker's icon only when the icon object changes.
const ICONS = Object.fromEntries(["ok", "tracking", "alert", "offline"].map((key) => [key, pinIcon(key)]));

/** Frames all devices once when the first data arrives; after that the operator's own pan/zoom is respected. */
function FitOnce({ points }) {
  const map = useMap();
  const ready = points.length > 0;
  useEffect(() => {
    if (!ready) return;
    if (points.length === 1) map.setView(points[0], 16);
    else map.fitBounds(points, { padding: [48, 48], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, map]);
  return null;
}

export default function MapPanel({ devices, className = "h-[420px] lg:h-[460px]" }) {
  const { isDark } = useTheme();
  const points = devices.map((device) => [device.latitude, device.longitude]);

  return (
    <div role="region" aria-label="Peta titik pemantauan" className={`relative isolate overflow-hidden rounded-b-panel ${className}`}>
      <MapContainer
        center={points[0] ?? DEFAULT_CENTER}
        zoom={15}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TileLayer key={isDark ? "dark" : "light"} url={isDark ? TILES.dark : TILES.light} attribution={ATTRIBUTION} />
        <FitOnce points={points} />
        {devices.map((device) => {
          const health = deviceHealth(device);
          const distance = nearestDistance(device);
          return (
            <Marker key={device.device_id} position={[device.latitude, device.longitude]} icon={ICONS[health.key]}>
              <Popup>
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold">{device.name}</p>
                  <StatusBadge tone={health.tone}>{health.label}</StatusBadge>
                  <p className="text-muted">
                    {device.units.length} unit aktif · jarak terdekat {formatDistance(distance)}
                  </p>
                  <p className="text-muted">Terakhir terlihat {timeAgo(device.last_seen)}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                    <Link to={`/devices/${device.device_id}`} className="font-semibold text-tech-text underline">
                      Lihat detail titik
                    </Link>
                    <a
                      href={mapsUrl(device.latitude, device.longitude)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-tech-text underline"
                    >
                      Buka di Google Maps
                    </a>
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      <ul
        className="pointer-events-none absolute bottom-3 left-3 z-[500] flex flex-wrap gap-x-3 gap-y-1 rounded-control border border-line bg-surface/90 px-3 py-2 text-[12px] font-medium"
        aria-label="Legenda peta"
      >
        {LEGEND.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${item.color}`} aria-hidden />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
