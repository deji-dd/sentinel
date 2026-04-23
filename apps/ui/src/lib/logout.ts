import type { NavigateFunction } from "react-router-dom";

export type LogoutOptions = {
  sessionToken?: string | null;
  navigate?: NavigateFunction;
  redirectTo?: string;
  setLoggedOut?: (value: boolean) => void;
  closeWindow?: boolean;
  closeWindowDelayMs?: number;
};

export async function performMasterLogout({
  sessionToken,
  navigate,
  redirectTo,
  setLoggedOut,
  closeWindow = false,
  closeWindowDelayMs = 500,
}: LogoutOptions = {}): Promise<void> {
  try {
    const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:3001";
    if (sessionToken) {
      await fetch(`${API_BASE}/api/auth/sign-out`, {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
    }
  } catch (err) {
    console.error("Sign out request failed:", err);
  } finally {
    localStorage.removeItem("sentinel_session");

    if (setLoggedOut) {
      setLoggedOut(true);
    }

    if (navigate && redirectTo) {
      navigate(redirectTo);
    }

    if (closeWindow) {
      setTimeout(() => {
        window.close();
      }, closeWindowDelayMs);
    }
  }
}
