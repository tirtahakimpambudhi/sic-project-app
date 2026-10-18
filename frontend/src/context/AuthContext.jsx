import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api, { tokenStore } from "../services/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // `booting` is true until we know whether a stored token still maps to a user.
  const [booting, setBooting] = useState(Boolean(tokenStore.access));

  useEffect(() => {
    if (!tokenStore.access) return;
    api
      .get("/auth/me/")
      .then(({ data }) => setUser(data))
      .catch((err) => {
        // If server definitively rejects with 401 and refresh cannot be done, clear tokens
        if (err.response?.status === 401 && !tokenStore.refresh) {
          tokenStore.clear();
        }
      })
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener("slop:session-expired", onExpired);
    return () => window.removeEventListener("slop:session-expired", onExpired);
  }, []);

  const login = useCallback(async (username, password) => {
    const { data } = await api.post("/auth/token/", { username, password });
    tokenStore.save(data);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      booting,
      login,
      logout,
      isOperator: user?.role === "operator",
      hasRole: (...roles) => Boolean(user) && roles.includes(user.role),
    }),
    [user, booting, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
