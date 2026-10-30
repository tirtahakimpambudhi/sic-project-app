import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import AppShell from "../components/AppShell.jsx";
import EmptyState from "../components/EmptyState.jsx";

/**
 * Gate for a route tree. Unauthenticated -> /login (remembering where they were going).
 * Authenticated but wrong role -> an explicit "no access" page instead of a silent redirect.
 */
export default function ProtectedRoute({ roles }) {
  const { user, booting } = useAuth();
  const location = useLocation();

  if (booting) {
    return <p className="p-8 text-sm text-muted" role="status">Memuat sesi…</p>;
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (roles && !roles.includes(user.role)) {
    return (
      <AppShell>
        <EmptyState title="Anda tidak memiliki akses ke halaman ini">
          Halaman ini hanya untuk {roles.join(", ").replace("satpol_pp", "Satpol PP")}. Hubungi Operator bila perlu akses.
        </EmptyState>
      </AppShell>
    );
  }
  return <Outlet />;
}
