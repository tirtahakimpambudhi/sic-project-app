import { Link, useParams } from "react-router-dom";
import { ArrowLeft, MapPin } from "lucide-react";
import Card from "../components/Card.jsx";
import CommandResult from "../components/CommandResult.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import Table from "../components/Table.jsx";
import usePolling from "../hooks/usePolling.js";
import api, { apiErrorMessage } from "../services/api.js";
import { detectionState, formatDistance, mapsUrl, timeAgo } from "../utils/format.js";

function UnitStatus({ unit }) {
  const state = detectionState(unit.detection_state);
  return <StatusBadge tone={state.tone}>{state.label}</StatusBadge>;
}

export default function DeviceDetail() {
  const { deviceId } = useParams();
  const device = usePolling(() => api.get(`/devices/${deviceId}/`).then((r) => r.data), [deviceId]);
  const telemetry = usePolling(() => api.get(`/devices/${deviceId}/telemetry/`, { params: { limit: 30 } }).then((r) => r.data), [deviceId]);

  if (device.loading) return <SkeletonRows rows={4} />;
  if (device.error && !device.data) {
    return (
      <EmptyState
        title={device.error.response?.status === 404 ? "Perangkat tidak ditemukan" : "Perangkat tidak dapat dimuat"}
        action={<Link to="/" className="btn btn-secondary">Kembali ke pemantauan</Link>}
      >
        {apiErrorMessage(device.error)}
      </EmptyState>
    );
  }

  const data = device.data;
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Pemantauan
        </Link>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <h1 className="text-2xl font-bold">{data.name}</h1>
          <StatusBadge tone={data.is_online ? "ok" : "offline"}>{data.is_online ? "Online" : "Offline"}</StatusBadge>
        </div>
        <p className="text-sm text-muted">
          Terakhir terlihat {timeAgo(data.last_seen)} · batas toleransi {formatDistance(data.tolerant_distance_cm)} ·
          timeout {data.timeout_seconds} detik ·{" "}
          <a href={mapsUrl(data.latitude, data.longitude)} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 font-semibold text-tech-text hover:underline">
            <MapPin className="h-3.5 w-3.5" aria-hidden /> peta
          </a>
        </p>
        <p className="mono-id">{data.device_id}</p>
      </header>

      <Card title="Unit sensor & servo">
        <Table label="Unit aktif">
          <thead>
            <tr><th>Unit</th><th>Status</th><th>Jarak</th><th>Servo</th><th className="hidden sm:table-cell">Pin T/E/S</th><th className="hidden md:table-cell">Update</th></tr>
          </thead>
          <tbody>
            {data.units.map((unit) => (
              <tr key={unit.unit_id}>
                <td className="font-semibold">
                  {unit.unit_id}
                  <span className="ml-2 text-[12px] font-normal text-muted">{unit.is_default ? "default" : "dinamis"}</span>
                </td>
                <td>{unit.has_setup || unit.detection_state ? <UnitStatus unit={unit} /> : <span className="text-muted">Menunggu data</span>}</td>
                <td>{formatDistance(unit.last_distance_cm)}</td>
                <td>{unit.servo_position != null ? `${unit.servo_position}°` : "-"}</td>
                <td className="hidden font-mono text-[13px] sm:table-cell">{[unit.trig_pin, unit.echo_pin, unit.servo_pin].map((p) => p ?? "-").join(" / ")}</td>
                <td className="hidden text-muted md:table-cell">{timeAgo(unit.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="border-t border-line p-4">
          <CommandResult device={data} />
        </div>
      </Card>

      <Card title="Pembacaan terakhir" description="30 pembacaan terbaru, semua unit.">
        {telemetry.loading ? (
          <SkeletonRows rows={3} />
        ) : !telemetry.data?.length ? (
          <EmptyState title="Belum ada telemetri">Data muncul setelah perangkat mengirim pembacaan (setiap 5 detik).</EmptyState>
        ) : (
          <Table label="Riwayat telemetri">
            <thead><tr><th>Waktu</th><th>Unit</th><th>Jarak</th><th>Servo</th><th>Status</th></tr></thead>
            <tbody>
              {telemetry.data.map((row) => (
                <tr key={row.id}>
                  <td className="text-muted">{new Date(row.created_at).toLocaleTimeString("en-GB")}</td>
                  <td>{row.unit_id}</td>
                  <td>{row.distance_cm != null ? formatDistance(row.distance_cm) : <span className="text-muted">tidak ada objek</span>}</td>
                  <td>{row.servo_position != null ? `${row.servo_position}°` : "-"}</td>
                  <td><UnitStatus unit={{ detection_state: row.detection_state }} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
