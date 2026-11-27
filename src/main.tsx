import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/caveat";
import "./styles/app.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { Safety, ToastProvider } from "./components/ui.tsx";

const stored = localStorage.getItem("yt-theme");
if (stored === "light" || stored === "dark") document.documentElement.setAttribute("data-theme", stored);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: true } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Safety><App /></Safety>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
