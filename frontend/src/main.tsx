import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { PrefsProvider, usePrefs } from "./lib/prefs";
import { ApiError } from "./api/client";
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
              <BrowserRouter>
                <App />
              </BrowserRouter>
              <ThemedToaster />
            </TooltipProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </PrefsProvider>
  </React.StrictMode>
);
