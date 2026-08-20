import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { DetectionState } from '@/types'

export type DisplayState = DetectionState | 'offline'

const STATES: Record<DisplayState, { label: string; badge: string; dot: string }> = {
  scanning: {
    label: 'Memindai',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  tracking: {
    label: 'Melacak',
    badge: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  confirmed: {
    label: 'Terkonfirmasi',
    badge: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300',
    dot: 'bg-rose-500 motion-safe:animate-pulse',
  },
  offline: {
    label: 'Offline',
    badge: 'border-border bg-muted text-muted-foreground',
    dot: 'bg-zinc-400',
  },
}

export const StatusBadge: React.FC<{ state: DisplayState }> = ({ state }) => {
  const { label, badge, dot } = STATES[state]
  return (
    <Badge variant="outline" className={cn('gap-1.5 font-medium', badge)}>
      <span aria-hidden className={cn('size-1.5 rounded-full', dot)} />
      {label}
    </Badge>
  )
}

/** Online dot + text. Colour is never the only signal. */
export const OnlineIndicator: React.FC<{ online: boolean }> = ({ online }) => (
  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
    <span aria-hidden className={cn('size-1.5 rounded-full', online ? 'bg-emerald-500' : 'bg-zinc-400')} />
    {online ? 'Online' : 'Offline'}
  </span>
)
