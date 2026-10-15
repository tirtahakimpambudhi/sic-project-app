import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, MapPin, Plus, Send, Trash2, Unlock } from "lucide-react";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import CommandResult from "../components/CommandResult.jsx";
import EmptyState from "../components/EmptyState.jsx";
import Field from "../components/Field.jsx";
import InlineAlert from "../components/InlineAlert.jsx";
import Modal from "../components/Modal.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import Table from "../components/Table.jsx";
import UnitCard from "../components/UnitCard.jsx";
import MapPanel from "../components/MapPanel.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useNotification } from "../context/NotificationContext.jsx";
import useCommandFeedback from "../hooks/useCommandFeedback.js";
import usePolling from "../hooks/usePolling.js";
import api, { apiErrorMessage } from "../services/api.js";
import { detectionState, formatDistance, formatPins, hasEcho, isAlarm, mapsUrl, timeAgo } from "../utils/format.js";
import {
  MAX_UNITS,
  PIN_FIELDS,
  addUnitBlocker,
  allowedPins,
  buildAddUnitBody,
  pinLabel,
  usedPins,
  validateUnitPins,
} from "../utils/pins.js";

function UnitStatus({ unit }) {
  const state = detectionState(unit.detection_state);
  return <StatusBadge tone={state.tone}>{state.label}</StatusBadge>;
}

const EMPTY_DEVICE = {};
const EMPTY_PINS = { trig_pin: "", echo_pin: "", servo_pin: "", buzzer_pin: "" };

/* ------------------------------------------------------------------ add unit form */
const PIN_META = {
  trig_pin: {
    code: "T",
    role: "Trigger (HC-SR04)",
    direction: "Output",
    badge: "bg-blue-500/10 text-blue-600 border-blue-500/30 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-700",
    placeholder: "misal: 25",
  },
  echo_pin: {
    code: "E",
    role: "Echo (HC-SR04)",
    direction: "Input",
    badge: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700",
    placeholder: "misal: 26",
  },
  servo_pin: {
    code: "S",
    role: "Sinyal Servo",
    direction: "Output",
    badge: "bg-purple-500/10 text-purple-600 border-purple-500/30 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-700",
    placeholder: "misal: 27",
  },
  buzzer_pin: {
    code: "B",
    role: "Sinyal Buzzer",
    direction: "Output",
    badge: "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-700",
    placeholder: "misal: 32",
  },
};

function AddUnitForm({ device, feedback, onDone }) {
  const [pins, setPins] = useState(EMPTY_PINS);
  const [inputMode, setInputMode] = useState("input");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [sending, setSending] = useState(false);

  const deviceType = device?.device_type || "ESP32";
  const effectiveDevice = { ...device, device_type: deviceType };

  const blocker = addUnitBlocker(effectiveDevice);
  if (blocker) {
    return (
      <div className="p-4 text-sm text-muted">
        <p>{blocker}</p>
      </div>
    );
  }

  const options = allowedPins(deviceType) ?? [];
  const inUse = usedPins(device.units);
  const complete = PIN_FIELDS.every(({ key }) => pins[key] !== "");

  const set = (field) => (event) => {
    const value = event.target.value;
    setPins((previous) => ({ ...previous, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((previous) => {
        const next = { ...previous };
        delete next[field];
        return next;
      });
    }
  };

  const handleChipClick = (pin) => {
    const emptyField = PIN_FIELDS.find((f) => !pins[f.key]);
    if (emptyField) {
      setPins((previous) => ({ ...previous, [emptyField.key]: String(pin) }));
      if (fieldErrors[emptyField.key]) {
        setFieldErrors((previous) => {
          const next = { ...previous };
          delete next[emptyField.key];
          return next;
        });
      }
    }
  };

  async function submit(event) {
    event.preventDefault();
    setError("");
    const errors = validateUnitPins(effectiveDevice, pins);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSending(true);
    feedback.begin("set");
    try {
      await api.post(`/devices/${device.device_id}/units/`, buildAddUnitBody(pins));
      setPins(EMPTY_PINS);
      setFieldErrors({});
      if (onDone) onDone();
    } catch (err) {
      feedback.cancel();
      setError(apiErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  const anyPinFilled = Object.values(pins).some((v) => v !== "");

  return (
    <form onSubmit={submit} className="space-y-4 p-4" noValidate>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <span>Tambah unit sensor + servo + buzzer</span>
            <span className="inline-flex items-center gap-1 rounded bg-accent-soft px-2 py-0.5 font-mono text-xs font-bold text-accent-text">
              Pin T · E · S · B
            </span>
          </h3>
          <p className="hint">
            Input pin GPIO untuk Trigger (T), Echo (E), Servo (S), dan Buzzer (B) pada perangkat {deviceType}.
            Tiap unit memakai 4 pin berbeda.
          </p>
        </div>
        <div className="inline-flex rounded-control border border-line bg-sunken/60 p-0.5 text-xs font-medium">
          <button
            type="button"
            className={`rounded px-2.5 py-1 transition-colors ${
              inputMode === "input"
                ? "bg-surface font-semibold text-ink shadow-sm"
                : "text-muted hover:text-ink"
            }`}
            onClick={() => setInputMode("input")}
          >
            Ketik Pin Manual
          </button>
          <button
            type="button"
            className={`rounded px-2.5 py-1 transition-colors ${
              inputMode === "select"
                ? "bg-surface font-semibold text-ink shadow-sm"
                : "text-muted hover:text-ink"
            }`}
            onClick={() => setInputMode("select")}
          >
            Pilih Dropdown
          </button>
        </div>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PIN_FIELDS.map(({ key, label, code }) => {
          const meta = PIN_META[key] || {};
          const isTakenByOther = (pin) =>
            PIN_FIELDS.find((other) => other.key !== key && pins[other.key] === String(pin));

          return (
            <Field
              key={key}
              label={
                <span className="flex items-center justify-between gap-1.5">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`inline-flex h-5 w-5 items-center justify-center rounded border font-mono text-[11px] font-bold ${
                        meta.badge || "bg-sunken text-muted"
                      }`}
                    >
                      {code || meta.code}
                    </span>
                    <span className="font-semibold">{label}</span>
                  </span>
                  <span className="text-[11px] font-normal text-muted">{meta.direction}</span>
                </span>
              }
              error={fieldErrors[key]}
              hint={meta.role}
            >
              {(p) =>
                inputMode === "input" ? (
                  <div className="relative">
                    <input
                      {...p}
                      id={`detail-pin-input-${key}`}
                      type="number"
                      min="0"
                      max="39"
                      step="1"
                      inputMode="numeric"
                      className="input font-mono"
                      required
                      value={pins[key]}
                      onChange={set(key)}
                      placeholder={meta.placeholder || "GPIO"}
                      list={`detail-gpio-list-${key}`}
                    />
                    <datalist id={`detail-gpio-list-${key}`}>
                      {options.map((pin) => {
                        const owner = inUse.get(pin);
                        const taken = isTakenByOther(pin);
                        return (
                          <option
                            key={pin}
                            value={pin}
                            label={`${pinLabel(deviceType, pin)}${
                              owner !== undefined ? ` · dipakai unit ${owner}` : taken ? ` · dipilih di ${taken.label}` : ""
                            }`}
                          />
                        );
                      })}
                    </datalist>
                  </div>
                ) : (
                  <select {...p} className="input font-mono" required value={pins[key]} onChange={set(key)}>
                    <option value="">Pilih GPIO</option>
                    {options.map((pin) => {
                      const owner = inUse.get(pin);
                      const taken = isTakenByOther(pin);
                      return (
                        <option key={pin} value={pin} disabled={owner !== undefined || Boolean(taken)}>
                          {pinLabel(deviceType, pin)}
                          {owner !== undefined
                            ? ` · dipakai unit ${owner}`
                            : taken
                            ? ` · dipilih di ${taken.label}`
                            : ""}
                        </option>
                      );
                    })}
                  </select>
                )
              }
            </Field>
          );
        })}
      </div>

      {/* Available GPIO helper chips */}
      {options.length > 0 && (
        <div className="rounded-control border border-line/60 bg-sunken/40 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-1.5 pb-2">
            <span className="font-semibold text-ink">
              Daftar GPIO {deviceType}:
            </span>
            <span className="text-[11px] text-muted">
              Klik GPIO yang tersedia untuk mengisi input kosong berikutnya
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {options.map((pin) => {
              const owner = inUse.get(pin);
              const isSelected = PIN_FIELDS.some((f) => pins[f.key] === String(pin));
              const isDisabled = owner !== undefined || isSelected;

              return (
                <button
                  key={pin}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => handleChipClick(pin)}
                  className={`rounded border px-2 py-1 font-mono text-[12px] transition-all ${
                    owner !== undefined
                      ? "border-transparent bg-sunken/70 text-muted/50 line-through cursor-not-allowed"
                      : isSelected
                      ? "border-tech/40 bg-tech-soft text-tech-text font-bold cursor-default shadow-xs"
                      : "border-line bg-surface text-ink hover:border-accent hover:bg-accent-soft hover:text-accent-text active:scale-95 cursor-pointer"
                  }`}
                  title={
                    owner !== undefined
                      ? `GPIO ${pin} sedang dipakai oleh unit ${owner}`
                      : isSelected
                      ? `GPIO ${pin} sudah dipilih pada form ini`
                      : `Klik untuk gunakan GPIO ${pin}`
                  }
                >
                  GPIO {pin}
                  {owner !== undefined ? ` (u${owner})` : ""}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          type="submit"
          icon={Send}
          loading={sending}
          disabled={!complete || Boolean(feedback.pending)}
        >
          Kirim ke perangkat
        </Button>
        {anyPinFilled && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setPins(EMPTY_PINS);
              setFieldErrors({});
            }}
          >
            Reset input
          </Button>
        )}
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ unset modal */
function UnsetUnitsModal({ device, unitIds, onClose, onConfirm }) {
  const [sending, setSending] = useState(false);
  const topic = `iot/${device.device_id}/config/unset`;

  function unsetPayload(ids) {
    return { unitId: ids.length === 1 ? ids[0] : ids };
  }

  async function confirm() {
    setSending(true);
    try {
      await onConfirm(unitIds);
      onClose();
    } catch {
      setSending(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={unitIds.length === 1 ? `Hapus unit ${unitIds[0]}?` : `Hapus ${unitIds.length} unit?`}
      description="Unit dilepas lewat perintah MQTT config/unset."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button variant="danger" icon={Trash2} loading={sending} onClick={confirm}>Kirim perintah unset</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          Sensor ultrasonik, servo, dan buzzer pada unit <strong>{unitIds.join(", ")}</strong> akan berhenti dan pin GPIO-nya dilepas
          (High-Z) setelah perangkat mengonfirmasi. Unit hanya hilang dari daftar bila perangkat melaporkannya.
        </p>
        <div className="rounded-control bg-sunken px-3 py-2 font-mono text-[12px]">
          <p className="break-all text-muted">{topic}</p>
          <p className="mt-1">{JSON.stringify(unsetPayload(unitIds))}</p>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ page */
export default function DeviceDetail() {
  const { deviceId } = useParams();
  const { isOperator } = useAuth();
  const { notify } = useNotification();
  const device = usePolling(() => api.get(`/devices/${deviceId}/`).then((r) => r.data), [deviceId]);
  const telemetry = usePolling(() => api.get(`/devices/${deviceId}/telemetry/`, { params: { limit: 30 } }).then((r) => r.data), [deviceId]);
  const feedback = useCommandFeedback(device.data ?? EMPTY_DEVICE, device.refresh);

  const [showAddUnit, setShowAddUnit] = useState(false);
  const [unsetIds, setUnsetIds] = useState(null);

  // Drop unset modal if the unit disappeared after device confirmation.
  useEffect(() => {
    if (!unsetIds || !device.data) return;
    const existing = new Set(device.data.units.map((u) => u.unit_id));
    const remaining = unsetIds.filter((id) => existing.has(id));
    if (remaining.length === 0) setUnsetIds(null);
    else if (remaining.length !== unsetIds.length) setUnsetIds(remaining);
  }, [device.data, unsetIds]);

  /** Releases the given unit ids, or every alarming unit when `unitIds` is null (empty `{}` payload). */
  async function release(unitIds) {
    feedback.begin("release");
    try {
      await api.post(`/devices/${deviceId}/release/`, unitIds ? { unit_ids: unitIds } : {});
      await device.refresh();
    } catch (err) {
      feedback.cancel();
      notify(apiErrorMessage(err), "danger");
    }
  }

  /** Publishes config/unset through the API for one or several unit ids. */
  async function unset(unitIds) {
    feedback.begin("unset");
    try {
      await api.post(`/devices/${deviceId}/units/unset/`, { unit_ids: unitIds });
      await device.refresh();
    } catch (err) {
      feedback.cancel();
      notify(apiErrorMessage(err), "danger");
      throw err;
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
  const canAddUnit = isOperator && data.units.length < MAX_UNITS;

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
          Jenis perangkat: <span className="font-semibold text-ink">{data.device_type || "ESP32"}</span>
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
            {isOperator && (
              <p className="mt-0.5 text-[13px] text-muted">
                {data.units.length} dari {MAX_UNITS} slot terpakai.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {isOperator && canAddUnit && (
              <Button
                variant="secondary"
                icon={Plus}
                disabled={Boolean(feedback.pending)}
                onClick={() => setShowAddUnit(!showAddUnit)}
              >
                {showAddUnit ? "Tutup form" : "Tambah unit"}
              </Button>
            )}
            <Button
              variant="danger"
              icon={Unlock}
              disabled={!anyAlarm || Boolean(feedback.pending)}
              onClick={() => release(null)}
            >
              Lepas semua alarm
            </Button>
          </div>
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
                showUnset={isOperator}
                unsetDisabled={Boolean(feedback.pending)}
                onUnset={(unitId) => setUnsetIds([unitId])}
              />
            ))}
          </div>
        )}

        {/* Add unit form (operator only) */}
        {isOperator && showAddUnit && (
          <Card title="Tambah unit baru" description={`Tambah sensor ultrasonik, servo, dan buzzer ke perangkat ${data.name}.`}>
            <AddUnitForm device={data} feedback={feedback} onDone={() => { setShowAddUnit(false); device.refresh(); }} />
          </Card>
        )}

        <div className="panel space-y-2 p-4">
          <h3 className="text-sm font-semibold">Hasil perintah terakhir</h3>
          <CommandResult device={data} feedback={feedback} />
        </div>
      </section>

      {/* Interactive Leaflet Map for this device */}
      {data.latitude != null && data.longitude != null && (
        <Card
          title="Lokasi titik di peta"
          description={`Koordinat: ${data.latitude}, ${data.longitude} · Lingkaran putus-putus menunjukkan area jangkauan toleransi deteksi (${formatDistance(data.tolerant_distance_cm)})`}
        >
          <MapPanel
            devices={[data]}
            className="h-[320px] lg:h-[360px]"
            singleDevice
            onRelease={() => release(null)}
          />
        </Card>
      )}

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

      {/* Unset confirmation modal */}
      {unsetIds && (
        <UnsetUnitsModal device={data} unitIds={unsetIds} onClose={() => setUnsetIds(null)} onConfirm={unset} />
      )}
    </div>
  );
}
