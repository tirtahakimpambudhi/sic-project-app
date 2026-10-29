import { useMemo, useState } from "react";
import { KeyRound, Pencil, Plus, Search, Trash2 } from "lucide-react";
import Button from "../components/Button.jsx";
import Card from "../components/Card.jsx";
import EmptyState from "../components/EmptyState.jsx";
import Field from "../components/Field.jsx";
import InlineAlert from "../components/InlineAlert.jsx";
import Modal from "../components/Modal.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import Table from "../components/Table.jsx";
import { useNotification } from "../context/NotificationContext.jsx";
import usePolling from "../hooks/usePolling.js";
import api, { apiErrorMessage } from "../services/api.js";
import { formatDateTime, timeAgo } from "../utils/format.js";

const ROLES = [
  { value: "operator", label: "Operator (Admin)", short: "Operator", hint: "Akses penuh: perangkat, unit, parameter, dan pengguna." },
  { value: "satpol_pp", label: "Satpol PP", short: "Satpol PP", hint: "Memantau dasbor dan menangani peringatan." },
];
const roleMeta = (value) => ROLES.find((role) => role.value === value) ?? { short: value, label: value };

/** DRF returns {field: ["msg"]}; keep those per field so the message sits next to its input. */
function splitErrors(error) {
  const data = error?.response?.data;
  if (!data || typeof data !== "object") return { fields: {}, general: apiErrorMessage(error) };
  const { detail, non_field_errors: nonField, ...rest } = data;
  const fields = Object.fromEntries(Object.entries(rest).map(([key, value]) => [key, [].concat(value).join(" ")]));
  const general = [detail, nonField].flat().filter(Boolean).join(" ");
  return { fields, general };
}

/* ------------------------------------------------------------------ create / edit */
function UserFormModal({ user, onClose, onSaved }) {
  const { notify } = useNotification();
  const editing = Boolean(user);
  const [form, setForm] = useState({
    username: user?.username ?? "",
    full_name: user ? `${user.first_name} ${user.last_name}`.trim() : "",
    role: user?.role ?? "satpol_pp",
    is_active: user?.is_active ?? true,
    password: "",
  });
  const [errors, setErrors] = useState({ fields: {}, general: "" });
  const [saving, setSaving] = useState(false);
  const set = (field) => (event) =>
    setForm((previous) => ({ ...previous, [field]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setErrors({ fields: {}, general: "" });
    setSaving(true);
    const payload = {
      username: form.username.trim(),
      first_name: form.full_name.trim(),
      last_name: "",
      role: form.role,
      is_active: form.is_active,
    };
    if (form.password) payload.password = form.password;
    try {
      if (editing) await api.patch(`/auth/users/${user.id}/`, payload);
      else await api.post("/auth/users/", payload);
      notify(editing ? `Pengguna “${payload.username}” diperbarui.` : `Pengguna “${payload.username}” ditambahkan.`);
      await onSaved();
      onClose();
    } catch (err) {
      setErrors(splitErrors(err));
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = form.username.trim() && (editing || form.password);

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? "Ubah pengguna" : "Tambah pengguna"}
      description={editing ? `Akun ${user.username}` : "Pengguna baru dapat langsung masuk dengan kata sandi ini."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button type="submit" form="user-form" loading={saving} disabled={!canSubmit}>
            {editing ? "Simpan perubahan" : "Tambah pengguna"}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} className="space-y-4" noValidate>
        {errors.general && <InlineAlert>{errors.general}</InlineAlert>}
        <Field label="Username" error={errors.fields.username} hint="Huruf, angka, dan @/./+/-/_ saja.">
          {(p) => <input {...p} className="input" autoComplete="off" required value={form.username} onChange={set("username")} />}
        </Field>
        <Field label="Nama lengkap" error={errors.fields.first_name}>
          {(p) => <input {...p} className="input" autoComplete="off" value={form.full_name} onChange={set("full_name")} placeholder="Contoh: Sri Wahyuni" />}
        </Field>
        <Field label="Role" error={errors.fields.role} hint={roleMeta(form.role).hint}>
          {(p) => (
            <select {...p} className="input" value={form.role} onChange={set("role")} disabled={editing && user.is_self}>
              {ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
          )}
        </Field>
        <Field
          label={editing ? "Kata sandi baru" : "Kata sandi"}
          error={errors.fields.password}
          hint={editing ? "Kosongkan bila tidak ingin mengubah kata sandi." : "Minimal 8 karakter dan tidak boleh terlalu umum."}
        >
          {(p) => (
            <input {...p} className="input" type="password" autoComplete="new-password" required={!editing}
              value={form.password} onChange={set("password")} />
          )}
        </Field>
        {editing && !user.is_self && (
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.is_active} onChange={set("is_active")} />
            <span>
              <span className="font-semibold">Akun aktif</span>
              <span className="block text-[13px] text-muted">Akun nonaktif tidak bisa masuk, tetapi riwayat tindakannya tetap tersimpan.</span>
            </span>
          </label>
        )}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ delete */
function DeleteUserModal({ user, onClose, onDeleted }) {
  const { notify } = useNotification();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setRemoving(true);
    setError("");
    try {
      await api.delete(`/auth/users/${user.id}/`);
      notify(`Pengguna “${user.username}” dihapus.`);
      await onDeleted();
      onClose();
    } catch (err) {
      setError(apiErrorMessage(err));
      setRemoving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Hapus pengguna?"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button variant="danger" icon={Trash2} loading={removing} onClick={remove}>Ya, hapus pengguna</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {error && <InlineAlert>{error}</InlineAlert>}
        <p>
          Akun <strong>{user.username}</strong> ({roleMeta(user.role).short}) akan dihapus permanen dan tidak bisa dipulihkan.
          Peringatan yang pernah ditandai selesai olehnya tetap ada.
        </p>
        <p className="text-muted">Bila hanya ingin menutup aksesnya sementara, nonaktifkan akun lewat menu ubah.</p>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ page */
export default function UserManagement() {
  const { data, loading, error, refresh } = usePolling(() => api.get("/auth/users/").then((r) => r.data), [], 30000);
  const users = useMemo(() => (Array.isArray(data) ? data : (data?.results ?? [])), [data]);

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [editing, setEditing] = useState(null); // null | "new" | user
  const [deleting, setDeleting] = useState(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== "all" && user.role !== roleFilter) return false;
      return !needle || `${user.username} ${user.full_name}`.toLowerCase().includes(needle);
    });
  }, [users, query, roleFilter]);

  const operators = users.filter((user) => user.role === "operator").length;
  const inactive = users.filter((user) => !user.is_active).length;

  const filters = [{ value: "all", label: "Semua" }, ...ROLES.map((role) => ({ value: role.value, label: role.short }))];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Manajemen pengguna</h1>
          <p className="mt-1 text-sm text-muted">
            {loading ? "Memuat pengguna…" : `${users.length} pengguna · ${operators} Operator · ${users.length - operators} Satpol PP${inactive ? ` · ${inactive} nonaktif` : ""}`}
          </p>
        </div>
        <Button icon={Plus} onClick={() => setEditing("new")}>Tambah pengguna</Button>
      </header>

      <Card
        title="Daftar pengguna"
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <input
                type="search"
                className="input !min-h-[34px] w-48 pl-9 text-[13px]"
                placeholder="Cari nama atau username"
                aria-label="Cari pengguna"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="inline-flex rounded-control border border-line bg-sunken p-0.5" role="group" aria-label="Filter role">
              {filters.map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => setRoleFilter(filter.value)}
                  aria-pressed={roleFilter === filter.value}
                  className={`min-h-[28px] rounded-[4px] px-3 text-[13px] font-semibold transition-colors duration-150 ${
                    roleFilter === filter.value ? "bg-surface text-ink" : "text-muted hover:text-ink"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </>
        }
      >
        {loading ? (
          <SkeletonRows rows={4} />
        ) : error && users.length === 0 ? (
          <EmptyState title="Pengguna tidak dapat dimuat">{apiErrorMessage(error)}</EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState title="Tidak ada pengguna yang cocok">Ubah kata kunci atau filter role untuk melihat pengguna lain.</EmptyState>
        ) : (
          <Table label="Daftar pengguna">
            <thead>
              <tr>
                <th>Pengguna</th>
                <th>Role</th>
                <th>Status</th>
                <th className="hidden md:table-cell">Login terakhir</th>
                <th className="text-right">Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((user) => (
                <tr key={user.id}>
                  <td>
                    <p className="font-semibold">
                      {user.full_name}
                      {user.is_self && <span className="ml-2 text-[13px] font-normal text-muted">(Anda)</span>}
                    </p>
                    <p className="mono-id mt-0.5">{user.username}</p>
                  </td>
                  <td>
                    {roleMeta(user.role).short}
                  </td>
                  <td><StatusBadge tone={user.is_active ? "ok" : "offline"}>{user.is_active ? "Aktif" : "Nonaktif"}</StatusBadge></td>
                  <td className="hidden text-muted md:table-cell" title={formatDateTime(user.last_login)}>
                    {user.last_login ? timeAgo(user.last_login) : "belum pernah masuk"}
                  </td>
                  <td className="text-right">
                    {user.role === "operator" && !user.is_self ? (
                      <span className="text-[13px] text-muted" title="Akun Operator lain tidak dapat diubah atau dihapus">Dilindungi</span>
                    ) : (
                      <span className="inline-flex gap-2">
                        <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(user)} aria-label={`Ubah ${user.username}`}>
                          Ubah
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={Trash2}
                          disabled={user.is_self}
                          title={user.is_self ? "Anda tidak dapat menghapus akun sendiri" : undefined}
                          onClick={() => setDeleting(user)}
                          aria-label={`Hapus ${user.username}`}
                        >
                          Hapus
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <p className="flex items-start gap-2 text-[13px] text-muted">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Akun Operator tidak dapat diubah atau dihapus oleh Operator lain. Akun sendiri hanya bisa diubah nama dan kata sandinya, bukan role atau statusnya.
      </p>

      {editing && (
        <UserFormModal user={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
      {deleting && <DeleteUserModal user={deleting} onClose={() => setDeleting(null)} onDeleted={refresh} />}
    </div>
  );
}
