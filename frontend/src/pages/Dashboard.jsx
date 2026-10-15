import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, MapPin } from "lucide-react";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import EmptyState from "../components/EmptyState.jsx";
import MapPanel from "../components/MapPanel.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import Table from "../components/Table.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useNotification } from "../context/NotificationContext.jsx";
import useAlerts from "../hooks/useAlerts.js";
import useDevices from "../hooks/useDevices.js";
import api, { apiErrorMessage } from "../services/api.js";
import {
  deviceHealth,
  formatClock,
  formatDateTime,
  formatDistance,
  formatSeconds,
  mapsUrl,
  nearestDistance,
  timeAgo,
} from "../utils/format.js";

/* ------------------------------------------------------------------ fleet summary */
function summarize(devices) {
  const counts = { alert: 0, tracking: 0, ok: 0, offline: 0 };
  let units = 0;
  let openAlerts = 0;
  for (const device of devices) {
    counts[deviceHealth(device).key] += 1;
    if (device.is_online) units += device.units.length;
    openAlerts += device.open_alert_count ?? 0;
  }
  return { counts, units, openAlerts, total: devices.length, online: devices.length - counts.offline };
}

function headline(summary) {
  const { counts, total } = summary;
  if (counts.alert > 0) return { text: `${counts.alert} titik ada pelanggaran terkonfirmasi`, tone: "text-danger" };
  if (counts.tracking > 0) return { text: `${counts.tracking} titik sedang melacak objek`, tone: "text-warn-text" };
  if (summary.online === 0) return { text: "Tidak ada perangkat yang online", tone: "text-muted" };
  return { text: total === 1 ? "Titik pemantauan aman" : "Semua titik pemantauan aman", tone: "text-accent-text" };
}

function Hero({ devices, loading, updatedAt }) {
  const summary = useMemo(() => summarize(devices), [devices]);

  if (loading) return <div className="panel h-24 animate-pulse bg-sunken" aria-hidden />;
  if (summary.total === 0) return null;

  const status = headline(summary);
  const { counts } = summary;
  const items = [
    ["Perangkat online", `${summary.online} dari ${summary.total}`],
    ["Unit aktif", summary.units],
    ["Pelanggaran", counts.alert],
    ["Objek terdeteksi", counts.tracking],
    ["Peringatan terbuka", summary.openAlerts],
    ["Offline", counts.offline],
  ];
  return (
    <section className="panel p-4" aria-labelledby="hero-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="hero-title" className={`text-lg font-semibold ${status.tone}`}>{status.text}</h2>
        <p className="text-[13px] text-muted" aria-live="polite">Diperbarui {formatClock(updatedAt)}</p>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[13px] text-muted">{label}</dt>
            <dd className="text-base font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ------------------------------------------------------------------ alerts */
function AlertRow({ alert, onResolve, resolving }) {
  return (
    <li className="space-y-2 px-4 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link to={`/devices/${alert.device_id}`} className="font-semibold hover:underline">{alert.device_name}</Link>
        <span className="text-sm text-muted">Unit {alert.unit_id}</span>
        {alert.is_resolved ? <StatusBadge tone="ok">Selesai</StatusBadge> : <StatusBadge tone="danger">Belum ditangani</StatusBadge>}
      </div>
      <p className="text-sm text-muted">
        Objek berjarak {formatDistance(alert.distance_cm)} dari sensor · terakhir terdeteksi {timeAgo(alert.last_occurred_at)}
        {alert.occurrences > 1 && ` · ${alert.occurrences} kali dilaporkan`}
      </p>
      {!alert.is_resolved && (
        <p className="text-[13px] text-muted">
          “Tandai selesai” hanya mencatat penanganan. Buzzer di lapangan baru mati setelah alarm dilepas di halaman perangkat.
        </p>
      )}
      {alert.is_resolved && (
        <p className="text-[13px] text-muted">
          Ditandai selesai oleh {alert.resolved_by_name ?? "-"} pada {formatDateTime(alert.resolved_at)}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {!alert.is_resolved && (
          <Button size="sm" variant="secondary" icon={Check} loading={resolving} onClick={() => onResolve(alert.id)}>
            Tandai selesai
          </Button>
        )}
        {!alert.is_resolved && (
          <Link to={`/devices/${alert.device_id}`} className="text-sm font-semibold text-tech-text hover:underline">
            Lepas alarm di perangkat
          </Link>
        )}
        {alert.latitude != null && (
          <a
            href={mapsUrl(alert.latitude, alert.longitude)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-tech-text hover:underline"
          >
            <MapPin className="h-4 w-4" aria-hidden />
            Buka di Google Maps
          </a>
        )}
      </div>
    </li>
  );
}

function AlertSection() {
  const [showResolved, setShowResolved] = useState(false);
  const { alerts, total, loading, error, resolve } = useAlerts({ resolved: showResolved });
  const { notify } = useNotification();
  const [resolvingId, setResolvingId] = useState(null);

  async function handleResolve(alertId) {
    setResolvingId(alertId);
    try {
      await resolve(alertId);
      notify("Peringatan ditandai selesai.");
    } catch (err) {
      notify(apiErrorMessage(err), "danger");
    } finally {
      setResolvingId(null);
    }
  }

  const tabs = [
    { value: false, label: "Belum ditangani" },
    { value: true, label: "Riwayat" },
  ];

  return (
    <Card
      title="Peringatan"
      className="flex flex-col"
      bodyClassName="min-h-0 flex-1 overflow-y-auto lg:max-h-[460px]"
      actions={
        <div className="inline-flex rounded-control border border-line bg-sunken p-0.5" role="group" aria-label="Filter peringatan">
          {tabs.map((tab) => (
            <button
              key={String(tab.value)}
              onClick={() => setShowResolved(tab.value)}
              aria-pressed={showResolved === tab.value}
              className={`min-h-[30px] rounded-[4px] px-3 text-[13px] font-semibold transition-colors duration-150 ${
                showResolved === tab.value ? "bg-surface text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      }
    >
      {loading ? (
        <SkeletonRows rows={2} />
      ) : error && alerts.length === 0 ? (
        <EmptyState title="Peringatan tidak dapat dimuat">{apiErrorMessage(error)}</EmptyState>
      ) : alerts.length === 0 ? (
        showResolved ? (
          <EmptyState title="Belum ada riwayat">Peringatan yang sudah ditandai selesai akan muncul di sini.</EmptyState>
        ) : (
          <EmptyState title="Tidak ada peringatan aktif">
            Tidak ada objek yang bertahan melewati batas waktu di titik mana pun saat ini.
          </EmptyState>
        )
      ) : (
        <>
          <ul className="divide-y divide-line">
            {alerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} onResolve={handleResolve} resolving={resolvingId === alert.id} />
            ))}
          </ul>
          {total > alerts.length && (
            <p className="border-t border-line px-4 py-3 text-[13px] text-muted">
              Menampilkan {alerts.length} dari {total} peringatan terbaru.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ comparison table */
function ComparisonSection({ devices, loading, error, isOperator }) {
  // Most urgent first, so the table reads as a work queue.
  const rows = useMemo(
    () =>
      devices
        .map((device) => ({ device, health: deviceHealth(device), distance: nearestDistance(device) }))
        .sort((a, b) => a.health.rank - b.health.rank || b.device.open_alert_count - a.device.open_alert_count),
    [devices],
  );

  return (
    <Card title="Perbandingan titik pemantauan" description="Diurutkan dari yang paling mendesak.">
      {loading ? (
        <SkeletonRows rows={3} />
      ) : error && devices.length === 0 ? (
        <EmptyState title="Perangkat tidak dapat dimuat">{apiErrorMessage(error)}</EmptyState>
      ) : devices.length === 0 ? (
        <EmptyState
          title="Belum ada perangkat terdaftar"
          action={isOperator && <Link to="/manage" className="btn btn-primary">Daftarkan perangkat</Link>}
        >
          {isOperator ? "Daftarkan ESP32 pertama agar telemetri dan peringatannya muncul di sini." : "Minta Operator untuk mendaftarkan perangkat."}
        </EmptyState>
      ) : (
        <Table label="Perbandingan titik pemantauan">
          <thead>
            <tr>
              <th>Titik</th>
              <th>Kondisi</th>
              <th>Unit</th>
              <th>Jarak terdekat</th>
              <th className="hidden md:table-cell">Toleransi</th>
              <th className="hidden md:table-cell">Batas waktu</th>
              <th className="hidden lg:table-cell">Terakhir terlihat</th>
              <th className="text-right">Peringatan</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ device, health, distance }) => (
              <tr key={device.device_id}>
                <td>
                  <Link to={`/devices/${device.device_id}`} className="font-semibold hover:underline">{device.name}</Link>
                  <p className="mono-id mt-0.5 max-w-[14rem] truncate">{device.device_id}</p>
                  <a
                    href={mapsUrl(device.latitude, device.longitude)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold text-tech-text hover:underline"
                  >
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    Google Maps
                  </a>
                </td>
                <td><StatusBadge tone={health.tone}>{health.short}</StatusBadge></td>
                <td>{device.units.length} aktif</td>
                <td className={distance !== null && distance <= device.tolerant_distance_cm ? "font-semibold text-warn-text" : ""}>
                  {formatDistance(distance)}
                </td>
                <td className="hidden md:table-cell">{formatDistance(device.tolerant_distance_cm)}</td>
                <td className="hidden md:table-cell">{formatSeconds(device.timeout_seconds)}</td>
                <td className="hidden text-muted lg:table-cell">{timeAgo(device.last_seen)}</td>
                <td className="text-right font-semibold">
                  {device.open_alert_count > 0 ? <span className="text-danger">{device.open_alert_count}</span> : <span className="text-muted">0</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ page */
export default function Dashboard() {
  const { isOperator } = useAuth();
  const { devices, loading, error, updatedAt, refresh } = useDevices();
  const { notify } = useNotification();

  async function handleReleaseFromMap(deviceId) {
    try {
      await api.post(`/devices/${deviceId}/release/`, {});
      notify("Perintah lepas alarm berhasil dikirim ke perangkat.");
      if (refresh) refresh();
    } catch (err) {
      notify(apiErrorMessage(err), "danger");
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Pemantauan bahu jalan</h1>
        <p className="mt-1 text-sm text-muted">Kondisi seluruh titik sensor secara langsung. Data dimuat ulang setiap 5 detik.</p>
      </header>

      <Hero devices={devices} loading={loading} updatedAt={updatedAt} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card
          title="Peta titik pemantauan"
          description="Warna penanda mengikuti kondisi unit terburuk di titik itu."
        >
          {loading ? (
            <div className="h-[420px] animate-pulse bg-sunken lg:h-[460px]" aria-hidden />
          ) : devices.length === 0 ? (
            <EmptyState title="Belum ada titik untuk ditampilkan">Peta muncul setelah perangkat pertama didaftarkan.</EmptyState>
          ) : (
            <MapPanel devices={devices} onRelease={handleReleaseFromMap} />
          )}
        </Card>
        <AlertSection />
      </div>

      <ComparisonSection devices={devices} loading={loading} error={error} isOperator={isOperator} />
    </div>
  );
}
