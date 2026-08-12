import { Outlet } from "react-router-dom";
import Navbar from "./Navbar.jsx";

export default function AppShell({ children }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <Navbar />
      <main className="mx-auto w-full max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {children ?? <Outlet />}
      </main>
    </div>
  );
}
