import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, MapPin, Unlock } from "lucide-react";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import CommandResult from "../components/CommandResult.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import Table from "../components/Table.jsx";
import UnitCard from "../components/UnitCard.jsx";
import { useNotification } from "../context/NotificationContext.jsx";
import useCommandFeedback from "../hooks/useCommandFeedback.js";
import usePolling from "../hooks/usePolling.js";
import api, { apiErrorMessage } from "../services/api.js";
import { detectionState, formatDistance, hasEcho, isAlarm, mapsUrl, timeAgo } from "../utils/format.js";

function UnitStatus({ unit }) {
  const state = detectionState(unit.detection_state);
  return <StatusBadge tone={state.tone}>{state.label}</StatusBadge>;
}

const EMPTY_DEVICE = {};

export default function DeviceDetail() {
  const { deviceId } = useParams();
  const { notify } = useNotification();
  const device = usePolling(() => api.get(`/devices/${deviceId}/`).then((r) => r.data), [deviceId]);
  const telemetry = usePolling(() => api.get(`/devices/${deviceId}/telemetry/`, { params: { limit: 30 } }).then((r) => r.data), [deviceId]);
  const feedback = useCommandFeedback(device.data ?? EMPTY_DEVICE, device.refresh);

  /** Releases the given unit ids, or every alarming unit when `unitIds` is null (empty `{}` payload). */
  async function release(unitIds) {
    feedback.begin("release");
    try {
      await api.post(`/devices/${deviceId}/units/release/`, unitIds ? { unit_ids: unitIds } : {});
      await device.refresh();
    } catch (err) {
      feedback.cancel();
      notify(apiErrorMessage(err), "danger");
    }
  }

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
  const anyAlarm = data.units.some(isAlarm);
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
        <p className="text-sm text-muted">
          Jenis perangkat:{" "}
          {data.device_type ? <span className="font-semibold text-ink">{data.device_type}</span> : "menunggu status dari perangkat"}
        </p>
        <p className="mono-id">{data.device_id}</p>
      </header>

      <section className="space-y-4" aria-labelledby="units-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="units-title" className="text-base font-semibold">Unit sensor, servo & buzzer</h2>
            <p className="mt-0.5 max-w-2xl text-[13px] text-muted">
              Alarm terkunci: setelah terkonfirmasi, buzzer dan peringatan tetap aktif walau objek sudah pergi, sampai
              dilepas di sini. Bila objek masih ada saat dilepas, hitung batas waktu mulai dari awal.
            </p>
          </div>
          <Button
            variant="danger"
            icon={Unlock}
            disabled={!anyAlarm || Boolean(feedback.pending)}
            onClick={() => release(null)}
          >
            Lepas semua alarm
          </Button>
        </div>

        {data.units.length === 0 ? (
          <div className="panel">
            <EmptyState title="Belum ada data unit">
              Status perangkat tidak disimpan broker. Data unit muncul setelah perangkat terhubung dan mengirim laporan.
            </EmptyState>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.units.map((unit) => (
              <UnitCard
                key={unit.unit_id}
                unit={unit}
                releaseDisabled={Boolean(feedback.pending)}
                onRelease={(unitId) => release([unitId])}
              />
            ))}
          </div>
        )}

        <div className="panel space-y-2 p-4">
          <h3 className="text-sm font-semibold">Hasil perintah terakhir</h3>
          <CommandResult device={data} feedback={feedback} />
        </div>
      </section>

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
                  <td>{hasEcho(row.distance_cm) ? formatDistance(row.distance_cm) : <span className="text-muted">tidak ada objek</span>}</td>
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
