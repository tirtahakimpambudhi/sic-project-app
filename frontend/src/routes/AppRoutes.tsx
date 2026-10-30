import { Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from '@/components/layout/Shell'
import { Dashboard } from '@/pages/Dashboard'
import { DeviceManagement } from '@/pages/DeviceManagement'
import { Login } from '@/pages/Login'
import { ProtectedRoute } from '@/routes/ProtectedRoute'

export const AppRoutes: React.FC = () => (
  <Routes>
    <Route path="/login" element={<Login />} />
    <Route element={<ProtectedRoute />}>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route element={<ProtectedRoute allowedRoles={['operator']} />}>
          <Route path="devices" element={<DeviceManagement />} />
        </Route>
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
)
