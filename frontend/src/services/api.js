import axios from "axios";

const ACCESS_KEY = "slop.access";
const REFRESH_KEY = "slop.refresh";

export const tokenStore = {
  get access() { return localStorage.getItem(ACCESS_KEY); },
  get refresh() { return localStorage.getItem(REFRESH_KEY); },
  save({ access, refresh }) {
    if (access) localStorage.setItem(ACCESS_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

const api = axios.create({ baseURL: "/api" });

// Attach the JWT to every request.
api.interceptors.request.use((config) => {
  const token = tokenStore.access;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, refresh once (single-flight so parallel polls share one refresh) and replay the request.
let refreshInFlight = null;

function refreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = axios
      .post("/api/auth/token/refresh/", { refresh: tokenStore.refresh })
      .then(({ data }) => {
        tokenStore.save({ access: data.access, refresh: data.refresh });
        return data.access;
      })
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const isAuthCall = original?.url?.includes("/auth/token/");
    if (error.response?.status === 401 && !original._retried && !isAuthCall && tokenStore.refresh) {
      original._retried = true;
      try {
        const access = await refreshAccessToken();
        original.headers.Authorization = `Bearer ${access}`;
        return await api(original);
      } catch (refreshError) {
        // Only clear credentials if the refresh token was explicitly rejected by the server
        const status = refreshError.response?.status;
        if (status === 401 || status === 400) {
          tokenStore.clear();
          window.dispatchEvent(new Event("slop:session-expired"));
        }
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  },
);

export default api;

/** Turns a DRF error response into one readable sentence. */
export function apiErrorMessage(error, fallback = "Terjadi kesalahan. Coba lagi.") {
  const data = error?.response?.data;
  if (!data) return error?.message === "Network Error" ? "Server tidak dapat dihubungi." : fallback;
  if (typeof data === "string") return fallback;
  if (data.detail) return Array.isArray(data.detail) ? data.detail.join(" ") : String(data.detail);
  const first = Object.entries(data)[0];
  if (first) return `${first[0]}: ${Array.isArray(first[1]) ? first[1].join(" ") : first[1]}`;
  return fallback;
}
