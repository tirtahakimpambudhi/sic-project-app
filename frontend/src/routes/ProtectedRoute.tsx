import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import type { UserRole } from '@/types'

interface ProtectedRouteProps {
  /** Omit to allow any signed-in user. */
  allowedRoles?: UserRole[]
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ allowedRoles }) => {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div role="status" className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        Memeriksa sesi…
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to="/" replace />
  return <Outlet />
}
