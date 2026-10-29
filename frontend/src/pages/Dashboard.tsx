import { MapPin } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { OnlineIndicator, StatusBadge, type DisplayState } from '@/components/StatusBadge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAlerts, type AlertFilter } from '@/hooks/useAlerts'
import { useDevices } from '@/hooks/useDevices'
import { formatDistance, formatRelative, mapsUrl } from '@/lib/format'
import { cn } from '@/lib/utils'
import { alertsApi, getErrorMessage } from '@/services/api'
import type { AlertData, Device, DeviceUnit } from '@/types'

interface UnitRowData {
  device: Device
  unit: DeviceUnit | null
}

function toRows(devices: Device[]): UnitRowData[] {
  return devices.flatMap((device) =>
    device.units.length > 0 ? device.units.map((unit) => ({ device, unit })) : [{ device, unit: null }],
  )
}

function displayState(device: Device, unit: DeviceUnit): DisplayState {
  return device.is_online ? unit.detection_state : 'offline'
}

export const Dashboard: React.FC = () => {
  const [filter, setFilter] = useState<AlertFilter>('active')
  const devices = useDevices()
  const alerts = useAlerts(filter)

  const deviceList = devices.data ?? []
  const rows = toRows(deviceList)
  const onlineCount = deviceList.filter((device) => device.is_online).length
  const confirmedCount = deviceList
    .filter((device) => device.is_online)
    .flatMap((device) => device.units)
    .filter((unit) => unit.detection_state === 'confirmed').length

  const resolveAlert = async (alert: AlertData) => {
    try {
      await alertsApi.resolve(alert.id)
      toast.success(`Peringatan ${alert.device_name} · unit ${alert.unit_id} ditandai selesai`)
      await alerts.refresh()
    } catch (caught) {
      toast.error(getErrorMessage(caught))
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pemantauan</h1>
        <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
          {devices.loading
            ? 'Memuat data perangkat…'
            : `${onlineCount} dari ${deviceList.length} perangkat online · ${confirmedCount} unit terkonfirmasi`}
        </p>
      </div>

      {devices.error && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>{devices.error} Data di bawah mungkin tidak terkini.</span>
            <Button variant="outline" size="sm" onClick={() => void devices.refresh()}>
              Coba lagi
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status unit</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Perangkat</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Jarak</TableHead>
                  <TableHead className="text-right">Servo</TableHead>
                  <TableHead className="pr-6 text-right">Laporan terakhir</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.loading &&
                  Array.from({ length: 4 }, (_, index) => (
                    <TableRow key={index}>
                      <TableCell colSpan={6} className="px-6">
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}
                {!devices.loading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="px-6 py-10 text-center text-sm text-muted-foreground">
                      Belum ada perangkat terdaftar. Operator dapat menambahkannya di menu Perangkat; unit
                      akan muncul di sini begitu ESP32 mengirim telemetri.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map(({ device, unit }) => (
                  <TableRow
                    key={`${device.id}-${unit?.unit_id ?? 'none'}`}
                    className={cn(unit?.detection_state === 'confirmed' && device.is_online && 'bg-rose-50/70 dark:bg-rose-950/20')}
                  >
                    <TableCell className="pl-6">
                      <div className="font-medium">{device.name}</div>
                      <OnlineIndicator online={device.is_online} />
                    </TableCell>
                    {unit ? (
                      <>
                        <TableCell className="tabular-nums">
                          {unit.unit_id}
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {unit.is_default ? 'default' : 'dinamis'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge state={displayState(device, unit)} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {unit.sensor_status === 'object_detected' ? formatDistance(unit.last_distance_cm) : '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {unit.servo_position === null ? '—' : `${unit.servo_position}°`}
                        </TableCell>
                        <TableCell className="pr-6 text-right text-muted-foreground">
                          {formatRelative(unit.last_seen_at)}
                        </TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={5} className="pr-6 text-sm text-muted-foreground">
                        Belum ada telemetri dari perangkat ini.
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Log peringatan</CardTitle>
            <div role="group" aria-label="Filter peringatan" className="flex gap-1">
              {(['active', 'all'] as const).map((option) => (
                <Button
                  key={option}
                  size="sm"
                  variant={filter === option ? 'secondary' : 'ghost'}
                  aria-pressed={filter === option}
                  onClick={() => setFilter(option)}
                >
                  {option === 'active' ? 'Aktif' : 'Semua'}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="px-0">
            {alerts.error && <p className="px-6 pb-3 text-sm text-destructive">{alerts.error}</p>}
            {alerts.loading && (
              <div className="space-y-3 px-6">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            )}
            {!alerts.loading && alerts.data?.length === 0 && (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                {filter === 'active'
                  ? 'Tidak ada peringatan aktif. Peringatan muncul saat objek bertahan di jarak toleransi melewati batas waktu.'
                  : 'Belum ada peringatan tercatat.'}
              </p>
            )}
            <ul className="divide-y divide-border">
              {alerts.data?.map((alert) => (
                <li key={alert.id} className="flex items-start gap-3 px-6 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {alert.device_name} <span className="font-normal text-muted-foreground">· unit {alert.unit_id}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {alert.distance_cm !== null && `${formatDistance(alert.distance_cm)} · `}
                      {alert.repeat_count > 1 && `${alert.repeat_count}× dilaporkan · `}
                      {formatRelative(alert.updated_at)}
                    </p>
                    {alert.is_resolved && (
                      <p className="text-xs text-muted-foreground">Selesai oleh {alert.resolved_by ?? '—'}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {alert.latitude !== null && alert.longitude !== null && (
                      <Button asChild variant="ghost" size="icon" aria-label={`Buka lokasi ${alert.device_name} di peta`}>
                        <a href={mapsUrl(alert.latitude, alert.longitude)} target="_blank" rel="noreferrer">
                          <MapPin className="size-4" aria-hidden />
                        </a>
                      </Button>
                    )}
                    {!alert.is_resolved && (
                      <Button variant="outline" size="sm" onClick={() => void resolveAlert(alert)}>
                        Selesai
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
