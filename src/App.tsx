import { useEffect, useState, lazy, Suspense } from "react";
import { Routes, Route, Navigate, useNavigate, useLocation } from "react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Layout
import AppShell from "./components/layout/AppShell";
import logoIcon from "./assets/logo-icon.png";
import { useT } from "./lib/i18n";

// Pages — lazy loaded for code splitting
const Dashboard = lazy(() => import("./pages/Dashboard"));
const ScenarioWorkshop = lazy(() => import("./pages/ScenarioWorkshop"));
const AgentManagement = lazy(() => import("./pages/AgentManagement"));
const ModelManagement = lazy(() => import("./pages/ModelManagement"));
const ChannelManagement = lazy(() => import("./pages/ChannelManagement"));
const LogCenter = lazy(() => import("./pages/LogCenter"));
const CostDashboard = lazy(() => import("./pages/CostDashboard"));
const Settings = lazy(() => import("./pages/Settings"));

// Onboarding — lazy loaded (only needed for first-time users)
const OnboardingLayout = lazy(() => import("./pages/onboarding/OnboardingLayout"));
const Welcome = lazy(() => import("./pages/onboarding/Welcome"));
const ModelConfig = lazy(() => import("./pages/onboarding/ModelConfig"));
const ChannelConnect = lazy(() => import("./pages/onboarding/ChannelConnect"));
const ScenarioSelect = lazy(() => import("./pages/onboarding/ScenarioSelect"));
const Complete = lazy(() => import("./pages/onboarding/Complete"));

// Components
import ErrorBoundary from "./components/ui/ErrorBoundary";

// Store & IPC
import { useAppStore } from "./stores/appStore";
import { useOnboardingStore } from "./stores/onboardingStore";
import { checkOpenClawInstalled, getGatewayStatus, listAgents, readOpenClawConfig } from "./lib/tauri";
import {
  loadLastCompletedStep,
  loadOnboardingData,
  getResumeStepId,
  stepToRoute,
  resetOnboardingProgress,
} from "./lib/onboardingProgress";

/** Prefetch data for Agent/Model pages into appStore so first navigation is instant.
 *  Each call is independent — fast ones land first, slow ones fill in later. */
function prefetchAppData() {
  const { setStatus, setAgents, setConfig } = useAppStore.getState();
  // Instant: file read
  readOpenClawConfig().then(setConfig).catch(() => {});
  // Fast: agent list (~0.9s)
  listAgents().then(setAgents).catch(() => {});
  // Slow: full status (~2.5s) — cache already provides instant first render
  getGatewayStatus().then(setStatus).catch(() => {});
}

function StartupGuard({ children }: { children: React.ReactNode }) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const onboarded = useAppStore((s) => s.onboarded);
  const setOnboarded = useAppStore((s) => s.setOnboarded);
  const [checking, setChecking] = useState(true);

  // Sync window title with current language
  useEffect(() => {
    getCurrentWindow().setTitle(t("common.windowTitle")).catch(() => {});
  }, [t]);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const status = await checkOpenClawInstalled();
        const lastStep = await loadLastCompletedStep();

        if (cancelled) return;

        const installed = status === "installed";

        // 1. Installed + no local record → go straight to main UI
        if (installed && !lastStep) {
          setOnboarded(true);
          prefetchAppData();
          setChecking(false);
          return;
        }

        // 2. Installed + has local record
        if (installed && lastStep) {
          if (lastStep === "complete") {
            // All setup steps completed → main UI
            setOnboarded(true);
            prefetchAppData();
            setChecking(false);
            return;
          }
          // Setup incomplete → resume at the corresponding step
        }

        // 3. Not installed (including stale_dir) → clear old progress, start fresh
        if (!installed) {
          await resetOnboardingProgress();
          setOnboarded(false);
          setChecking(false);
          if (!location.pathname.startsWith("/onboarding")) {
            navigate("/onboarding", { replace: true });
          }
          return;
        }

        // 4. Installed + has local record but incomplete → resume at the corresponding step
        setOnboarded(false);
        setChecking(false);

        // Hydrate onboarding store with persisted selections
        const savedData = await loadOnboardingData();
        if (savedData) {
          useOnboardingStore.getState().hydrate(savedData);
        }

        // Navigate to resume point if not already on an onboarding page
        if (!location.pathname.startsWith("/onboarding")) {
          const resumeStep = getResumeStepId(lastStep);
          navigate(stepToRoute(resumeStep), { replace: true });
        }
      } catch (e) {
        console.warn("StartupGuard check failed:", e);
        if (!cancelled) {
          setChecking(false);
        }
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (checking) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--bg-surface)]">
        <div className="flex flex-col items-center gap-3">
          <img src={logoIcon} alt="ClawZ" className="h-10 w-10" />
          <span className="text-sm text-[var(--text-secondary)]">
            {t("common.launching")}
          </span>
        </div>
      </div>
    );
  }

  // If not onboarded and trying to access main app, redirect
  if (!onboarded && !location.pathname.startsWith("/onboarding")) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}

function LazyFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
    <StartupGuard>
      <Suspense fallback={<LazyFallback />}>
      <Routes>
        {/* Onboarding flow (full-screen, no sidebar) */}
        <Route path="/onboarding" element={<OnboardingLayout />}>
          <Route index element={<Welcome />} />
          <Route path="model" element={<ModelConfig />} />
          <Route path="channel" element={<ChannelConnect />} />
          <Route path="scenario" element={<ScenarioSelect />} />
          <Route path="complete" element={<Complete />} />
        </Route>

        {/* Main app with sidebar */}
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/workshop" element={<ScenarioWorkshop />} />
          <Route path="/agents" element={<AgentManagement />} />
          <Route path="/models" element={<ModelManagement />} />
          <Route path="/channels" element={<ChannelManagement />} />
          <Route path="/logs" element={<LogCenter />} />
          <Route path="/cost" element={<CostDashboard />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
      </Suspense>
    </StartupGuard>
    </ErrorBoundary>
  );
}

export default App;
