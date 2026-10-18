import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { APP_NAME_FULL } from "../config/app.js";
import { BrandMark } from "../components/Navbar.jsx";
import Button from "../components/Button.jsx";
import Field from "../components/Field.jsx";
import InlineAlert from "../components/InlineAlert.jsx";
import ThemeToggle from "../components/ThemeToggle.jsx";
import { apiErrorMessage } from "../services/api.js";

export default function Login() {
  const { user, booting, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (booting) return null;
  if (user) return <Navigate to={location.state?.from ?? "/"} replace />;

  const update = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(form.username.trim(), form.password);
      navigate(location.state?.from ?? "/", { replace: true });
    } catch (err) {
      setError(
        err.response?.status === 401
          ? "Username atau kata sandi salah."
          : apiErrorMessage(err, "Tidak dapat masuk. Coba lagi."),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="relative flex items-center justify-center px-6 py-12">
        <ThemeToggle className="absolute right-4 top-4" />
        <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-5" noValidate>
          <BrandMark className="h-11 w-11" />
          <div>
            <h1 className="text-2xl font-bold">Masuk ke dasbor</h1>
            <p className="mt-1 text-sm text-muted">Gunakan akun Operator atau Satpol PP yang diberikan kepada Anda.</p>
          </div>

          {error && <InlineAlert>{error}</InlineAlert>}

          <Field label="Username">
            {(props) => (
              <input {...props} className="input" autoComplete="username" autoFocus required
                value={form.username} onChange={update("username")} />
            )}
          </Field>
          <Field label="Kata sandi">
            {(props) => (
              <input {...props} className="input" type="password" autoComplete="current-password" required
                value={form.password} onChange={update("password")} />
            )}
          </Field>

          <Button type="submit" className="w-full" loading={submitting} disabled={!form.username || !form.password}>
            Masuk
          </Button>
        </form>
      </div>

      <aside className="hidden bg-accent px-14 py-16 text-accent-ink lg:flex lg:flex-col lg:justify-end">
        <h2 className="max-w-xl text-2xl font-semibold leading-snug">{APP_NAME_FULL}</h2>
        <p className="mt-3 max-w-lg text-[15px]">
          Sensor di bahu jalan mengirim peringatan saat ada objek yang bertahan melewati batas waktu.
        </p>
      </aside>
    </div>
  );
}
