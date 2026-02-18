import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { SplashScreen } from "@/components/SplashScreen";
import "./index.css";
import App from "./App";

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
    }, 250);

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
