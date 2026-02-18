import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { SplashScreen } from "@/components/SplashScreen";
import "./index.css";
import App from "./App";

const THEME_STORAGE_KEY = "book-writer-theme";

type AppTheme = "light" | "dark";

function detectInitialTheme(): AppTheme {
  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);

  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyDocumentTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

applyDocumentTheme(detectInitialTheme());

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    if (import.meta.env.PROD) {
      void navigator.serviceWorker.register("/sw.js");
      return;
    }

    // Prevent stale SW cache behavior from interfering with OAuth callbacks in dev.
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        void registration.unregister();
      });
    });
  });
}

function AppBootstrap() {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setShowSplash(false);
    }, 1000);

    return () => {
      window.clearTimeout(timerId);
    };
  }, []);

  return showSplash ? <SplashScreen /> : <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppBootstrap />
  </StrictMode>,
);
