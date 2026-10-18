import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "../components/AppShell.jsx";
import Analytics from "../pages/Analytics.jsx";
import Dashboard from "../pages/Dashboard.jsx";
import DeviceDetail from "../pages/DeviceDetail.jsx";
import DeviceManagement from "../pages/DeviceManagement.jsx";
import Login from "../pages/Login.jsx";
import UserManagement from "../pages/UserManagement.jsx";
import ProtectedRoute from "./ProtectedRoute.jsx";

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {/* Both roles: live monitoring + alert logs + analytics */}
      <Route element={<ProtectedRoute roles={["operator", "satpol_pp"]} />}>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="analisis" element={<Analytics />} />
          <Route path="devices/:deviceId" element={<DeviceDetail />} />
        </Route>
      </Route>

      {/* Operator only: device CRUD, dynamic units, global parameters, user management */}
      <Route element={<ProtectedRoute roles={["operator"]} />}>
        <Route element={<AppShell />}>
          <Route path="manage" element={<DeviceManagement />} />
          <Route path="users" element={<UserManagement />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
