import { useState } from "react";
import { NavLink } from "react-router-dom";
import { LayoutDashboard, LogOut, Menu, SlidersHorizontal, Users, X } from "lucide-react";
import { useAuth } from "../context/AuthContext.jsx";
import { APP_NAME_FULL, APP_NAME_SHORT } from "../config/app.js";
import ThemeToggle from "./ThemeToggle.jsx";

const ROLE_LABEL = { operator: "Operator", satpol_pp: "Satpol PP" };

const NAV_ITEMS = [
  { to: "/", label: "Pemantauan", icon: LayoutDashboard, end: true, roles: ["operator", "satpol_pp"] },
  { to: "/manage", label: "Kelola perangkat", icon: SlidersHorizontal, roles: ["operator"] },
  { to: "/users", label: "Manajemen pengguna", icon: Users, roles: ["operator"] },
];

export function BrandMark({ className = "h-9 w-9" }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="rgb(var(--accent))" />
      <path d="M10 27 14 5M22 27 18 5" fill="none" stroke="rgb(var(--accent-ink))" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M16 8v3M16 15v3M16 22v3" fill="none" stroke="rgb(var(--accent-ink))" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3" title={APP_NAME_FULL}>
      <BrandMark />
      <div className="min-w-0 leading-tight">
        <p className="text-[15px] font-semibold">{APP_NAME_SHORT}</p>
      </div>
    </div>
  );
}

function NavItems({ onNavigate }) {
  const { user } = useAuth();
  return (
    <nav aria-label="Navigasi utama" className="flex flex-col gap-1">
      {NAV_ITEMS.filter((item) => item.roles.includes(user.role)).map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex min-h-[42px] items-center gap-3 rounded-control px-3 text-sm font-semibold transition-colors duration-150 ${
              isActive ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-sunken hover:text-ink"
            }`
          }
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function Account() {
  const { user, logout } = useAuth();
  const name = user.first_name || user.username;
  return (
    <div className="space-y-2">
      <ThemeToggle showLabel className="w-full" />
      <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="text-[12px] text-muted">{ROLE_LABEL[user.role]}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
          aria-label="Keluar"
          title="Keluar"
        >
          <LogOut className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** Desktop: persistent sidebar. Phones: slim top bar whose menu expands inline (no modal). */
export default function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="sticky top-0 hidden h-screen flex-col justify-between border-r border-line bg-surface p-4 lg:flex">
        <div className="space-y-8">
          <Brand />
          <NavItems />
        </div>
        <Account />
      </aside>

      <header className="sticky top-0 z-[1100] border-b border-line bg-surface lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <Brand />
          <button
            onClick={() => setOpen((value) => !value)}
            className="flex h-10 w-10 items-center justify-center rounded-control hover:bg-sunken"
            aria-expanded={open}
            aria-label={open ? "Tutup menu" : "Buka menu"}
          >
            {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </div>
        {open && (
          <div className="space-y-4 border-t border-line px-4 pb-4 pt-3">
            <NavItems onNavigate={() => setOpen(false)} />
            <Account />
          </div>
        )}
      </header>
    </>
  );
}
