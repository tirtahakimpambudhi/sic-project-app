import { LogOut } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/types'

const ROLE_LABEL: Record<UserRole, string> = { operator: 'Operator', satpol_pp: 'Satpol PP' }

const linkClass = ({ isActive }: { isActive: boolean }): string =>
  cn(
    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground',
  )

export const Shell: React.FC = () => {
  const { user, logout } = useAuth()
  if (!user) return null

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
      >
        Lewati ke konten
      </a>
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <span className="text-base font-semibold tracking-tight">Slop</span>
          <nav aria-label="Utama" className="flex items-center gap-1">
            <NavLink to="/" end className={linkClass}>
              Pemantauan
            </NavLink>
            {user.role === 'operator' && (
              <NavLink to="/devices" className={linkClass}>
                Perangkat
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm font-medium">{user.username}</div>
              <div className="text-xs text-muted-foreground">{ROLE_LABEL[user.role]}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={logout}>
              <LogOut className="size-4" aria-hidden />
              Keluar
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  )
}
