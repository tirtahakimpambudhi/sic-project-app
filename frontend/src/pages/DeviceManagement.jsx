import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Lock, Plus, Save, Send, Trash2 } from "lucide-react";
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
import { useNotification } from "../context/NotificationContext.jsx";
import useCommandFeedback from "../hooks/useCommandFeedback.js";
import useDevices from "../hooks/useDevices.js";
import api, { apiErrorMessage } from "../services/api.js";
import { detectionState, formatPins, isAlarm, timeAgo } from "../utils/format.js";
import {
  MAX_UNITS,
  PIN_FIELDS,
  addUnitBlocker,
  allowedPins,
  buildAddUnitBody,
  pinLabel,
  usedPins,
  validateGeneral,
  validateUnitPins,
} from "../utils/pins.js";

/* ------------------------------------------------------------------ create device */
function CreateDeviceForm({ onCreated, onCancel }) {
  const { notify } = useNotification();
  const [form, setForm] = useState({ device_id: "", name: "", latitude: "", longitude: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSaving(true);
    try {
      const { data } = await api.post("/devices/", {
        device_id: form.device_id.trim(),
        name: form.name.trim(),
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
      });
      notify(`Perangkat “${data.name}” terdaftar.`);
      onCreated(data);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Daftarkan perangkat baru" description="Device ID harus sama persis dengan DEVICE_ID di firmware ESP32.">
      <form onSubmit={submit} className="grid gap-4 p-4 sm:grid-cols-2" noValidate>
        {error && <div className="sm:col-span-2"><InlineAlert>{error}</InlineAlert></div>}
        <Field label="Device ID" className="sm:col-span-2">
          {(p) => <input {...p} className="input font-mono" required value={form.device_id} onChange={set("device_id")} placeholder="a4ca5bbb-f98c-4add-af1e-a498c9868dcc" />}
        </Field>
        <Field label="Nama titik" className="sm:col-span-2">
          {(p) => <input {...p} className="input" required value={form.name} onChange={set("name")} placeholder="Bahu jalan depan pasar" />}
        </Field>
        <Field label="Latitude">
          {(p) => <input {...p} className="input" type="number" step="any" min="-90" max="90" required value={form.latitude} onChange={set("latitude")} placeholder="-6.208763" />}
        </Field>
        <Field label="Longitude">
          {(p) => <input {...p} className="input" type="number" step="any" min="-180" max="180" required value={form.longitude} onChange={set("longitude")} placeholder="106.845599" />}
        </Field>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" loading={saving} disabled={!form.device_id || !form.name || form.latitude === "" || form.longitude === ""}>
            Daftarkan
          </Button>
          <Button variant="secondary" onClick={onCancel}>Batal</Button>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ global parameters */
function ParametersForm({ device, onSaved, feedback }) {
  const { notify } = useNotification();
  const initial = {
    name: device.name,
    tolerant_distance_cm: String(device.tolerant_distance_cm),
    timeout_seconds: String(device.timeout_seconds),
    latitude: String(device.latitude),
    longitude: String(device.longitude),
  };
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const set = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));
  const dirty = Object.keys(initial).some((key) => initial[key] !== form[key]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    const errors = validateGeneral(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    // Only the two global parameters travel to the board (config/general); name and coordinates stay server-side.
    const sendsToBoard =
      initial.tolerant_distance_cm !== form.tolerant_distance_cm || initial.timeout_seconds !== form.timeout_seconds;
    setSaving(true);
    if (sendsToBoard) feedback.begin("general");
    try {
      await api.patch(`/devices/${device.device_id}/`, {
        name: form.name.trim(),
        tolerant_distance_cm: Number(form.tolerant_distance_cm),
        timeout_seconds: Number(form.timeout_seconds),
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
      });
      if (!sendsToBoard) notify("Perubahan disimpan.");
      await onSaved();
    } catch (err) {
      if (sendsToBoard) feedback.cancel();
      setError(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Parameter perangkat" description="Berlaku untuk semua unit, termasuk yang sedang melacak. Hasilnya dilaporkan perangkat dan muncul sebagai pemberitahuan.">
      <form onSubmit={submit} className="grid gap-4 p-4 sm:grid-cols-2" noValidate>
        {error && <div className="sm:col-span-2"><InlineAlert>{error}</InlineAlert></div>}
        <Field label="Nama titik" className="sm:col-span-2">
          {(p) => <input {...p} className="input" required value={form.name} onChange={set("name")} />}
        </Field>
        <Field label="Jarak toleransi (cm)" error={fieldErrors.tolerant_distance_cm} hint="Lebih dari 0 sampai 400 cm. Objek lebih dekat dari ini dihitung melanggar.">
          {(p) => <input {...p} className="input" type="number" step="any" min="0" max="400" required value={form.tolerant_distance_cm} onChange={set("tolerant_distance_cm")} />}
        </Field>
        <Field label="Batas waktu (detik)" error={fieldErrors.timeout_seconds} hint="Bilangan bulat 1 sampai 86.400 detik (24 jam) sebelum alarm terkonfirmasi.">
          {(p) => <input {...p} className="input" type="number" step="1" min="1" max="86400" required value={form.timeout_seconds} onChange={set("timeout_seconds")} />}
        </Field>
        <Field label="Latitude">
          {(p) => <input {...p} className="input" type="number" step="any" min="-90" max="90" required value={form.latitude} onChange={set("latitude")} />}
        </Field>
        <Field label="Longitude">
          {(p) => <input {...p} className="input" type="number" step="any" min="-180" max="180" required value={form.longitude} onChange={set("longitude")} />}
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" icon={Save} loading={saving} disabled={!dirty || Boolean(feedback.pending)}>Simpan & kirim ke perangkat</Button>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ dynamic units */
const EMPTY_PINS = { trig_pin: "", echo_pin: "", servo_pin: "", buzzer_pin: "" };

function AddUnitForm({ device, feedback }) {
  const [pins, setPins] = useState(EMPTY_PINS);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [sending, setSending] = useState(false);
  const set = (field) => (event) => setPins((previous) => ({ ...previous, [field]: event.target.value }));

  const blocker = addUnitBlocker(device);
  if (blocker) return <p className="p-4 text-sm text-muted">{blocker}</p>;

  const options = allowedPins(device.device_type);
  const inUse = usedPins(device.units);
  const complete = PIN_FIELDS.every(({ key }) => pins[key] !== "");

  async function submit(event) {
    event.preventDefault();
    setError("");
    const errors = validateUnitPins(device, pins);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSending(true);
    feedback.begin("set");
    try {
      await api.post(`/devices/${device.device_id}/units/`, buildAddUnitBody(pins));
      setPins(EMPTY_PINS);
    } catch (err) {
      feedback.cancel();
      setError(apiErrorMessage(err));
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 p-4" noValidate>
      <div>
        <h3 className="text-sm font-semibold">Tambah unit sensor + servo + buzzer</h3>
        <p className="hint">
          Pilihan pin mengikuti jenis perangkat ({device.device_type}). Satu unit memakai 4 pin berbeda; pin yang sudah
          dipakai unit lain tidak bisa dipilih.
        </p>
      </div>
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PIN_FIELDS.map(({ key, label }) => (
          <Field key={key} label={label} error={fieldErrors[key]}>
            {(p) => (
              <select {...p} className="input font-mono" required value={pins[key]} onChange={set(key)}>
                <option value="">Pilih GPIO</option>
                {options.map((pin) => {
                  const owner = inUse.get(pin);
                  const takenBy = PIN_FIELDS.find((other) => other.key !== key && pins[other.key] === String(pin));
                  return (
                    <option key={pin} value={pin} disabled={owner !== undefined || Boolean(takenBy)}>
                      {pinLabel(device.device_type, pin)}
                      {owner !== undefined ? ` · dipakai unit ${owner}` : takenBy ? ` · dipilih di ${takenBy.label}` : ""}
                    </option>
                  );
                })}
              </select>
            )}
          </Field>
        ))}
      </div>
      <Button type="submit" icon={Send} loading={sending} disabled={!complete || Boolean(feedback.pending)}>Kirim ke perangkat</Button>
    </form>
  );
}

/** The exact config/unset payload the backend publishes: one id stays a number, several become an array. */
function unsetPayload(unitIds) {
  return { unitId: unitIds.length === 1 ? unitIds[0] : unitIds };
}

function UnsetUnitsModal({ device, unitIds, onClose, onConfirm }) {
  const [sending, setSending] = useState(false);
  const topic = `iot/${device.device_id}/config/unset`;

  async function confirm() {
    setSending(true);
    try {
      await onConfirm(unitIds);
      onClose();
    } catch {
      setSending(false); // the error is already shown as a notification
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

function UnitsTable({ device, selected, onToggle, onRequestUnset }) {
  return (
    <Table label="Unit perangkat">
      <thead>
        <tr>
          <th className="w-10"><span className="sr-only">Pilih</span></th>
          <th>Unit</th>
          <th className="hidden sm:table-cell">Pin T / E / S / B</th>
          <th>Status</th>
          <th className="text-right">Tindakan</th>
        </tr>
      </thead>
      <tbody>
        {device.units.map((unit) => {
          const state = detectionState(unit.detection_state);
          return (
            <tr key={unit.unit_id}>
              <td>
                {unit.is_default ? (
                  <Lock className="h-4 w-4 text-muted" aria-label="Unit default, tidak bisa dipilih" />
                ) : (
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={selected.has(unit.unit_id)}
                    onChange={() => onToggle(unit.unit_id)}
                    aria-label={`Pilih unit ${unit.unit_id}`}
                  />
                )}
              </td>
              <td className="font-semibold">
                {unit.unit_id}
                <span className="ml-2 text-[12px] font-normal text-muted">{unit.is_default ? "default" : "dinamis"}</span>
                <span className="mt-0.5 block font-mono text-[12px] font-normal text-muted sm:hidden">
                  T/E/S/B {formatPins(unit, "/")}
                </span>
              </td>
              <td className="hidden font-mono text-[13px] sm:table-cell">{formatPins(unit)}</td>
              <td>
                {unit.detection_state ? <StatusBadge tone={state.tone}>{state.label}</StatusBadge> : <span className="text-muted">Menunggu data</span>}
                {isAlarm(unit) && <span className="mt-0.5 block text-[12px] font-bold text-danger">ALARM AKTIF</span>}
              </td>
              <td className="text-right">
                {unit.is_default ? (
                  <span className="text-[13px] text-muted">Permanen</span>
                ) : (
                  <Button size="sm" variant="secondary" icon={Trash2} onClick={() => onRequestUnset([unit.unit_id])}>Hapus</Button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

function UnitsCard({ device, refresh, feedback }) {
  const { notify } = useNotification();
  const [selected, setSelected] = useState(() => new Set());
  const [unsetIds, setUnsetIds] = useState(null); // unit ids awaiting confirmation in the modal

  // Drop selections for units that disappeared after the board confirmed the unset.
  useEffect(() => {
    const existing = new Set(device.units.map((unit) => unit.unit_id));
    setSelected((current) => {
      const kept = [...current].filter((id) => existing.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [device.units]);

  const toggle = (unitId) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });

  /** Publishes config/unset through the API (POST .../units/unset/) for one or several unit ids. */
  async function unset(unitIds) {
    feedback.begin("unset");
    try {
      await api.post(`/devices/${device.device_id}/units/unset/`, { unit_ids: unitIds });
      setSelected(new Set());
      await refresh();
    } catch (err) {
      feedback.cancel();
      notify(apiErrorMessage(err), "danger");
      throw err;
    }
  }

  const selectedIds = [...selected].sort((a, b) => a - b);

  return (
    <Card
      title="Unit sensor, servo & buzzer"
      description={`${device.units.length} dari ${MAX_UNITS} slot terpakai`}
      actions={
        selectedIds.length > 0 && (
          <Button size="sm" variant="danger" icon={Trash2} onClick={() => setUnsetIds(selectedIds)}>
            Hapus terpilih ({selectedIds.length})
          </Button>
        )
      }
    >
      {device.units.length === 0 ? (
        <EmptyState title="Belum ada data unit">
          Status perangkat tidak disimpan broker. Data muncul setelah perangkat terhubung dan melapor.
        </EmptyState>
      ) : (
        <UnitsTable device={device} selected={selected} onToggle={toggle} onRequestUnset={setUnsetIds} />
      )}
      <div className="space-y-3 border-t border-line p-4">
        <h3 className="text-sm font-semibold">Hasil perintah terakhir</h3>
        <CommandResult device={device} feedback={feedback} />
      </div>
      <div className="border-t border-line">
        <AddUnitForm device={device} feedback={feedback} />
      </div>
      {unsetIds && (
        <UnsetUnitsModal device={device} unitIds={unsetIds} onClose={() => setUnsetIds(null)} onConfirm={unset} />
      )}
    </Card>
  );
}

/** Owns the command feedback for one device, so every form below shares the same "waiting for the board" state. */
function DevicePanel({ device, refresh, onRemoved }) {
  const feedback = useCommandFeedback(device, refresh);
  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-xl font-bold">{device.name}</h2>
        <Link to={`/devices/${device.device_id}`} className="text-sm font-semibold text-tech-text hover:underline">Lihat pemantauan</Link>
      </div>
      <p className="-mt-3 text-sm text-muted">
        Jenis perangkat: {device.device_type ? <span className="font-semibold text-ink">{device.device_type}</span> : "menunggu status dari perangkat"}
      </p>
      <ParametersForm device={device} onSaved={refresh} feedback={feedback} />
      <UnitsCard device={device} refresh={refresh} feedback={feedback} />
      <RemoveDevice device={device} onRemoved={onRemoved} />
    </div>
  );
}

/* ------------------------------------------------------------------ remove device */
function RemoveDevice({ device, onRemoved }) {
  const { notify } = useNotification();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function remove() {
    setRemoving(true);
    try {
      await api.delete(`/devices/${device.device_id}/`);
      notify(`Perangkat “${device.name}” dihapus.`);
      onRemoved();
    } catch (err) {
      notify(apiErrorMessage(err), "danger");
      setRemoving(false);
    }
  }

  return (
    <Card title="Hapus perangkat" description="Menghapus perangkat juga menghapus seluruh riwayat telemetri dan peringatannya.">
      <div className="p-4">
        {confirming ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium">Hapus “{device.name}” secara permanen?</p>
            <Button variant="danger" loading={removing} onClick={remove}>Ya, hapus perangkat</Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>Batal</Button>
          </div>
        ) : (
          <Button variant="secondary" icon={Trash2} onClick={() => setConfirming(true)}>Hapus perangkat</Button>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ page */
export default function DeviceManagement() {
  const { devices, loading, error, refresh } = useDevices();
  const [selectedId, setSelectedId] = useState(null);
  const [creating, setCreating] = useState(false);

  const selected = devices.find((device) => device.device_id === selectedId) ?? devices[0] ?? null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Kelola perangkat</h1>
        {!creating && <Button icon={Plus} onClick={() => setCreating(true)}>Daftarkan perangkat</Button>}
      </header>

      {creating && (
        <CreateDeviceForm
          onCancel={() => setCreating(false)}
          onCreated={async (device) => {
            setCreating(false);
            setSelectedId(device.device_id);
            await refresh();
          }}
        />
      )}

      {loading ? (
        <SkeletonRows rows={3} />
      ) : error && devices.length === 0 ? (
        <EmptyState title="Perangkat tidak dapat dimuat">{apiErrorMessage(error)}</EmptyState>
      ) : devices.length === 0 ? (
        !creating && (
          <EmptyState title="Belum ada perangkat" action={<Button icon={Plus} onClick={() => setCreating(true)}>Daftarkan perangkat</Button>}>
            Setelah terdaftar, Anda bisa menambah unit sensor + servo dan mengatur jarak toleransi serta batas waktu dari sini.
          </EmptyState>
        )
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <nav aria-label="Daftar perangkat" className="panel h-fit overflow-hidden">
            <ul className="divide-y divide-line">
              {devices.map((device) => {
                const active = device.device_id === selected?.device_id;
                return (
                  <li key={device.device_id}>
                    <button
                      onClick={() => setSelectedId(device.device_id)}
                      aria-current={active ? "true" : undefined}
                      className={`block w-full px-4 py-3 text-left transition-colors duration-150 ${active ? "bg-accent-soft" : "hover:bg-sunken/60"}`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold">{device.name}</span>
                        <StatusBadge tone={device.is_online ? "ok" : "offline"}>{device.is_online ? "Online" : "Offline"}</StatusBadge>
                      </span>
                      <span className="mono-id mt-1 block truncate">{device.device_id}</span>
                      <span className="mt-0.5 block text-[12px] text-muted">{device.units.length} unit · terlihat {timeAgo(device.last_seen)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          {selected && (
            <DevicePanel
              key={selected.device_id}
              device={selected}
              refresh={refresh}
              onRemoved={() => { setSelectedId(null); refresh(); }}
            />
          )}
        </div>
      )}
    </div>
  );
}
