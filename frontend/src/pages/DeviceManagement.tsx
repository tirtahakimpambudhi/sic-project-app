import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { OnlineIndicator, StatusBadge } from '@/components/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useDevices } from '@/hooks/useDevices'
import { formatRelative, parseNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { devicesApi, getErrorMessage } from '@/services/api'
import type { ConfigResult, Device, GeneralConfigPayload } from '@/types'

const MAX_UNITS = 4

/** Human wording for what the firmware reports on config/status. */
const RESULT_LABELS: Record<string, { label: string; ok: boolean }> = {
  default_pins: { label: 'Perangkat menyala dengan pin bawaan', ok: true },
  ok: { label: 'Unit baru berhasil ditambahkan', ok: true },
  unset_ok: { label: 'Unit berhasil dihapus', ok: true },
  pin_conflict_active: { label: 'Pin bentrok dengan unit yang aktif', ok: false },
  max_units_reached: { label: 'Batas jumlah unit tercapai', ok: false },
  cannot_unset_default: { label: 'Unit 0 adalah unit default dan tidak bisa dihapus', ok: false },
  incomplete_unit: { label: 'Pin sensor atau servo belum lengkap', ok: false },
  no_pin_in_payload: { label: 'Perangkat tidak menerima pin apa pun', ok: false },
  no_unit_id_in_payload: { label: 'Perangkat tidak menerima unitId', ok: false },
  invalid_json: { label: 'Perangkat tidak bisa membaca perintah (JSON tidak valid)', ok: false },
}

function describeResult(result: ConfigResult): { label: string; ok: boolean } {
  return RESULT_LABELS[result] ?? { label: result, ok: false }
}

// ------------------------------------------------------------------------------------------
// Page
// ------------------------------------------------------------------------------------------

export const DeviceManagement: React.FC = () => {
  const { data, loading, error, refresh } = useDevices()
  const devices = data ?? []

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [deviceDialog, setDeviceDialog] = useState<{ device: Device | null } | null>(null)
  const [unitDialogOpen, setUnitDialogOpen] = useState(false)
  const [unitToRemove, setUnitToRemove] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const selected = devices.find((device) => device.id === selectedId) ?? devices[0] ?? null

  const removeUnit = async (device: Device, unitId: number) => {
    try {
      await devicesApi.removeUnits(device.id, { unit_ids: [unitId] })
      toast.success(`Perintah hapus unit ${unitId} dikirim ke perangkat`)
      await refresh()
    } catch (caught) {
      toast.error(getErrorMessage(caught))
    }
  }

  const deleteDevice = async (device: Device) => {
    try {
      await devicesApi.remove(device.id)
      toast.success(`${device.name} dihapus`)
      setSelectedId(null)
      await refresh()
    } catch (caught) {
      toast.error(getErrorMessage(caught))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Perangkat</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Kelola ESP32, tambah atau hapus unit sensor dan servo, dan atur parameter global.
          </p>
        </div>
        <Button onClick={() => setDeviceDialog({ device: null })}>
          <Plus className="size-4" aria-hidden />
          Tambah perangkat
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Device list */}
        <Card className="self-start">
          <CardContent className="px-0 py-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Nama</TableHead>
                  <TableHead className="pr-6 text-right">Unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={2} className="px-6">
                      <Skeleton className="h-10 w-full" />
                    </TableCell>
                  </TableRow>
                )}
                {!loading && devices.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={2} className="px-6 py-8 text-center text-sm text-muted-foreground">
                      Belum ada perangkat. Tambahkan satu dengan Device ID yang sama seperti
                      <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">DEVICE_ID</code>
                      di firmware ESP32.
                    </TableCell>
                  </TableRow>
                )}
                {devices.map((device) => (
                  <TableRow key={device.id} data-state={device.id === selected?.id ? 'selected' : undefined}>
                    <TableCell className="pl-6">
                      <button
                        type="button"
                        onClick={() => setSelectedId(device.id)}
                        aria-current={device.id === selected?.id}
                        className="block w-full rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="block font-medium">{device.name}</span>
                        <OnlineIndicator online={device.is_online} />
                      </button>
                    </TableCell>
                    <TableCell className="pr-6 text-right tabular-nums">
                      {device.units.length}/{MAX_UNITS}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Selected device */}
        {selected ? (
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
              <div className="min-w-0">
                <CardTitle className="text-lg">{selected.name}</CardTitle>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{selected.device_id}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Laporan terakhir {formatRelative(selected.last_seen_at)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setDeviceDialog({ device: selected })}>
                  Ubah
                </Button>
                <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)}>
                  Hapus
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-8">
              <ConfigResultNotice device={selected} />

              <section aria-labelledby="units-heading" className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 id="units-heading" className="text-base font-semibold">
                    Unit sensor dan servo
                  </h2>
                  <Button
                    size="sm"
                    onClick={() => setUnitDialogOpen(true)}
                    disabled={selected.units.length >= MAX_UNITS}
                  >
                    <Plus className="size-4" aria-hidden />
                    Tambah unit
                  </Button>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unit</TableHead>
                      <TableHead>Pin trig / echo / servo</TableHead>
                      <TableHead>Perangkat keras</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="w-12">
                        <span className="sr-only">Aksi</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selected.units.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                          Unit akan muncul setelah perangkat melaporkan konfigurasinya (saat menyala atau
                          setelah perintah tambah unit).
                        </TableCell>
                      </TableRow>
                    )}
                    {selected.units.map((unit) => (
                      <TableRow key={unit.unit_id}>
                        <TableCell className="tabular-nums">
                          {unit.unit_id}
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {unit.is_default ? 'default' : 'dinamis'}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-sm tabular-nums">
                          {unit.trig_pin ?? '–'} / {unit.echo_pin ?? '–'} / {unit.servo_pin ?? '–'}
                        </TableCell>
                        <TableCell className={cn('text-sm', !unit.has_setup && 'text-destructive')}>
                          {unit.has_setup ? 'Siap' : 'Servo gagal terpasang'}
                        </TableCell>
                        <TableCell>
                          <StatusBadge state={selected.is_online ? unit.detection_state : 'offline'} />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={unit.is_default}
                            onClick={() => setUnitToRemove(unit.unit_id)}
                            aria-label={
                              unit.is_default
                                ? 'Unit default tidak bisa dihapus'
                                : `Hapus unit ${unit.unit_id}`
                            }
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>

              <section aria-labelledby="general-heading" className="space-y-3 border-t border-border pt-6">
                <h2 id="general-heading" className="text-base font-semibold">
                  Parameter global
                </h2>
                <GeneralForm key={selected.id} device={selected} onApplied={refresh} />
              </section>
            </CardContent>
          </Card>
        ) : (
          !loading && (
            <p className="self-center text-center text-sm text-muted-foreground">
              Pilih atau tambahkan perangkat untuk mulai mengatur.
            </p>
          )
        )}
      </div>

      {/* Dialogs */}
      <Dialog open={deviceDialog !== null} onOpenChange={(open) => !open && setDeviceDialog(null)}>
        <DialogContent>
          {deviceDialog && (
            <DeviceForm
              device={deviceDialog.device}
              onCancel={() => setDeviceDialog(null)}
              onSaved={async (saved) => {
                setDeviceDialog(null)
                setSelectedId(saved.id)
                await refresh()
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={unitDialogOpen} onOpenChange={setUnitDialogOpen}>
        <DialogContent>
          {selected && (
            <UnitForm
              device={selected}
              onCancel={() => setUnitDialogOpen(false)}
              onSent={async () => {
                setUnitDialogOpen(false)
                await refresh()
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={unitToRemove !== null} onOpenChange={(open) => !open && setUnitToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus unit {unitToRemove}?</AlertDialogTitle>
            <AlertDialogDescription>
              Servo dilepas dan pin sensor dibebaskan. Unit baru dapat memakai slot ini setelahnya.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selected && unitToRemove !== null) void removeUnit(selected, unitToRemove)
                setUnitToRemove(null)
              }}
            >
              Hapus unit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus {selected?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Seluruh riwayat telemetri dan peringatan perangkat ini ikut terhapus. Tindakan ini tidak bisa
              dibatalkan. ESP32 tidak diubah; telemetrinya diabaikan sampai didaftarkan lagi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selected) void deleteDevice(selected)
              }}
            >
              Hapus perangkat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ------------------------------------------------------------------------------------------
// Result of the last command, as reported by the device
// ------------------------------------------------------------------------------------------

const ConfigResultNotice: React.FC<{ device: Device }> = ({ device }) => {
  if (!device.last_config_result || device.last_operation === 'boot') return null
  const { label, ok } = describeResult(device.last_config_result)
  return (
    <Alert variant={ok ? 'default' : 'destructive'}>
      <AlertTitle>
        {label}
        <span className="ml-2 text-xs font-normal text-muted-foreground">
          perintah {device.last_operation} · {formatRelative(device.last_config_at)}
        </span>
      </AlertTitle>
      {device.last_config_detail && <AlertDescription>{device.last_config_detail}</AlertDescription>}
    </Alert>
  )
}

// ------------------------------------------------------------------------------------------
// Forms
// ------------------------------------------------------------------------------------------

interface FieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  step?: string
  min?: number
  max?: number
  disabled?: boolean
  hint?: string
}

const Field: React.FC<FieldProps> = ({ id, label, value, onChange, hint, ...inputProps }) => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <Input
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-describedby={hint ? `${id}-hint` : undefined}
      {...inputProps}
    />
    {hint && (
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
    )}
  </div>
)

interface DeviceFormProps {
  device: Device | null
  onCancel: () => void
  onSaved: (device: Device) => Promise<void>
}

const DeviceForm: React.FC<DeviceFormProps> = ({ device, onCancel, onSaved }) => {
  const isEdit = device !== null
  const [name, setName] = useState(device?.name ?? '')
  const [deviceId, setDeviceId] = useState(device?.device_id ?? '')
  const [latitude, setLatitude] = useState(device ? String(device.latitude) : '')
  const [longitude, setLongitude] = useState(device ? String(device.longitude) : '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const lat = parseNumber(latitude)
    const lng = parseNumber(longitude)
    if (lat === null || lng === null) {
      setError('Latitude dan longitude harus berupa angka.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const saved = isEdit
        ? await devicesApi.update(device.id, { name: name.trim(), latitude: lat, longitude: lng })
        : await devicesApi.create({ device_id: deviceId.trim(), name: name.trim(), latitude: lat, longitude: lng })
      toast.success(isEdit ? 'Perangkat diperbarui' : 'Perangkat ditambahkan')
      await onSaved(saved)
    } catch (caught) {
      setError(getErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <DialogHeader>
        <DialogTitle>{isEdit ? 'Ubah perangkat' : 'Tambah perangkat'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Device ID tidak dapat diubah karena dipakai sebagai topik MQTT.'
            : 'Parameter lain dibaca dari perangkat saat ia pertama kali melapor.'}
        </DialogDescription>
      </DialogHeader>
      <Field id="device-name" label="Nama" value={name} onChange={setName} />
      <Field
        id="device-id"
        label="Device ID"
        value={deviceId}
        onChange={setDeviceId}
        disabled={isEdit}
        hint="Sama persis dengan DEVICE_ID di firmware; dipakai pada topik iot/<Device ID>/…"
      />
      <div className="grid grid-cols-2 gap-3">
        <Field id="device-lat" label="Latitude" value={latitude} onChange={setLatitude} type="number" step="any" />
        <Field id="device-lng" label="Longitude" value={longitude} onChange={setLongitude} type="number" step="any" />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" disabled={submitting || !name.trim() || !deviceId.trim()}>
          {submitting ? 'Menyimpan…' : 'Simpan'}
        </Button>
      </DialogFooter>
    </form>
  )
}

interface UnitFormProps {
  device: Device
  onCancel: () => void
  onSent: () => Promise<void>
}

const UnitForm: React.FC<UnitFormProps> = ({ device, onCancel, onSent }) => {
  const [trig, setTrig] = useState('')
  const [echo, setEcho] = useState('')
  const [servo, setServo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const pins = [parseNumber(trig), parseNumber(echo), parseNumber(servo)]
    if (pins.some((pin) => pin === null || !Number.isInteger(pin))) {
      setError('Ketiga pin harus berupa bilangan bulat.')
      return
    }
    const [trigPin, echoPin, servoPin] = pins as [number, number, number]
    setSubmitting(true)
    setError(null)
    try {
      await devicesApi.addUnit(device.id, {
        sensor: { trig_pin: trigPin, echo_pin: echoPin },
        servo: { pin: servoPin },
      })
      toast.success('Perintah dikirim. Hasilnya tampil di sini setelah perangkat menjawab.')
      await onSent()
    } catch (caught) {
      setError(getErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <DialogHeader>
        <DialogTitle>Tambah unit ke {device.name}</DialogTitle>
        <DialogDescription>
          Perangkat memilih nomor unit sendiri (slot kosong terkecil). GPIO 1 dan 3 dipakai Serial Monitor
          dan tidak bisa dipakai.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-3 gap-3">
        <Field id="pin-trig" label="Pin Trig" value={trig} onChange={setTrig} type="number" min={0} max={39} />
        <Field id="pin-echo" label="Pin Echo" value={echo} onChange={setEcho} type="number" min={0} max={39} />
        <Field id="pin-servo" label="Pin Servo" value={servo} onChange={setServo} type="number" min={0} max={39} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" disabled={submitting || !trig || !echo || !servo}>
          {submitting ? 'Mengirim…' : 'Kirim ke perangkat'}
        </Button>
      </DialogFooter>
    </form>
  )
}

const GeneralForm: React.FC<{ device: Device; onApplied: () => Promise<void> }> = ({ device, onApplied }) => {
  // Seeded once per device (parent sets key={device.id}); polling must not overwrite typing.
  const [tolerant, setTolerant] = useState(String(device.tolerant_distance_cm))
  const [timeout, setTimeoutValue] = useState(String(device.timeout_seconds))
  const [latitude, setLatitude] = useState(String(device.latitude))
  const [longitude, setLongitude] = useState(String(device.longitude))
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const raw = { tolerant_distance_cm: tolerant, timeout_seconds: timeout, latitude, longitude }
    const payload: GeneralConfigPayload = {}
    for (const [key, text] of Object.entries(raw) as [keyof GeneralConfigPayload, string][]) {
      if (text.trim() === '') continue
      const value = parseNumber(text)
      if (value === null) {
        setError('Semua parameter harus berupa angka.')
        return
      }
      payload[key] = value
    }
    setSubmitting(true)
    setError(null)
    try {
      await devicesApi.updateGeneral(device.id, payload)
      toast.success('Parameter dikirim ke perangkat')
      await onApplied()
    } catch (caught) {
      setError(getErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="general-tolerant"
          label="Jarak toleransi (cm)"
          value={tolerant}
          onChange={setTolerant}
          type="number"
          step="0.1"
          min={0.1}
          max={400}
          hint="0,1 – 400 cm. Objek lebih dekat dari ini dianggap melanggar."
        />
        <Field
          id="general-timeout"
          label="Batas waktu (detik)"
          value={timeout}
          onChange={setTimeoutValue}
          type="number"
          min={1}
          max={86400}
          hint="1 – 86400 detik sebelum objek dikonfirmasi dan alert dikirim."
        />
        <Field id="general-lat" label="Latitude" value={latitude} onChange={setLatitude} type="number" step="any" />
        <Field id="general-lng" label="Longitude" value={longitude} onChange={setLongitude} type="number" step="any" />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Mengirim…' : 'Terapkan ke perangkat'}
      </Button>
    </form>
  )
}
