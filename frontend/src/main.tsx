import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { PrefsProvider, usePrefs } from "./lib/prefs";
import { ApiError, IN_BROWSER_SERVER } from "./api/client";
import { TooltipProvider } from "./components/ui/overlay";
import { ErrorBoundary } from "./components/ErrorBoundary";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => {
        if (error instanceof ApiError && error.status > 0 && error.status < 500 && error.status !== 429) return false;
        return count < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    mutations: { retry: false },
  },
});

// A static host has no server to answer deep links, so the self-contained build keeps the route in the URL hash.
const Router = IN_BROWSER_SERVER ? HashRouter : BrowserRouter;

if (import.meta.env.DEV) void import("./devtools");

/**
 * Browser edition: a small service worker makes the page cross-origin isolated, which lets
 * the in-browser AI use every CPU core instead of one (see public/coi-serviceworker.js).
 * The first visit reloads once, as soon as the worker is in control.
 */
if (IN_BROWSER_SERVER && "serviceWorker" in navigator && window.isSecureContext && !window.crossOriginIsolated) {
  navigator.serviceWorker.register(new URL("coi-serviceworker.js", document.baseURI), { scope: "./" }).then((reg) => {
    const reloadOnce = () => {
      if (sessionStorage.getItem("lexintel.coi-reloaded")) return;
      sessionStorage.setItem("lexintel.coi-reloaded", "1");
      location.reload();
    };
    if (navigator.serviceWorker.controller) reloadOnce();
    else reg.addEventListener("updatefound", () => reg.installing?.addEventListener("statechange", (e) => {
      if ((e.target as ServiceWorker).state === "activated") reloadOnce();
    }));
  }).catch((e) => console.warn("cross-origin isolation unavailable; AI runs on one core", e));
}

const ThemedToaster: React.FC = () => {
  const { theme, dir } = usePrefs();
  return <Toaster theme={theme} dir={dir} position={dir === "rtl" ? "bottom-left" : "bottom-right"} richColors closeButton />;
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PrefsProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <TooltipProvider>
              <Router>
                <App />
              </Router>
              <ThemedToaster />
            </TooltipProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </PrefsProvider>
  </React.StrictMode>
);
