import React, { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { can } from "./lib/roles";
import { PublicLayout } from "./components/layout/PublicLayout";
import { AppLayout } from "./components/layout/AppLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Spinner } from "./components/ui/core";

const pages = {
  Home: () => import("./pages/public/Home"),
  FileComplaint: () => import("./pages/public/FileComplaint"),
  TrackComplaint: () => import("./pages/public/TrackComplaint"),
  Login: () => import("./pages/public/Login"),
  NotFound: () => import("./pages/public/NotFound"),
  Dashboard: () => import("./pages/app/Dashboard"),
  Cases: () => import("./pages/app/Cases"),
  CaseWorkspace: () => import("./pages/app/case/CaseWorkspace"),
  Complaints: () => import("./pages/app/Complaints"),
  Hearings: () => import("./pages/app/Hearings"),
  CourtroomSelect: () => import("./pages/app/courtroom/CourtroomSelect"),
  Stand: () => import("./pages/app/courtroom/Stand"),
  Research: () => import("./pages/app/Research"),
  Library: () => import("./pages/app/Library"),
  LawDocumentView: () => import("./pages/app/LawDocumentView"),
  Analytics: () => import("./pages/app/Analytics"),
  AdminUsers: () => import("./pages/app/admin/Users"),
  AdminAudit: () => import("./pages/app/admin/Audit"),
  AdminSystem: () => import("./pages/app/admin/System"),
  Profile: () => import("./pages/app/Profile"),
};

/**
 * Every page is its own chunk, so the first screen loads fast. Once the browser is idle the
 * rest are fetched in the background, so moving between pages never waits on the network.
 */
export function prefetchPages(): void {
  const run = () => Object.values(pages).forEach((load, i) => window.setTimeout(() => { load().catch(() => undefined); }, i * 60));
  const idle = (window as any).requestIdleCallback as ((cb: () => void, opts?: { timeout: number }) => void) | undefined;
  if (idle) idle(run, { timeout: 4000 }); else window.setTimeout(run, 1500);
}

const Home = lazy(pages.Home);
const FileComplaint = lazy(pages.FileComplaint);
const TrackComplaint = lazy(pages.TrackComplaint);
const Login = lazy(pages.Login);
const NotFound = lazy(pages.NotFound);

const Dashboard = lazy(pages.Dashboard);
const Cases = lazy(pages.Cases);
const CaseWorkspace = lazy(pages.CaseWorkspace);
const Complaints = lazy(pages.Complaints);
const Hearings = lazy(pages.Hearings);
const CourtroomSelect = lazy(pages.CourtroomSelect);
const Stand = lazy(pages.Stand);
const Research = lazy(pages.Research);
const Library = lazy(pages.Library);
const LawDocumentView = lazy(pages.LawDocumentView);
const Analytics = lazy(pages.Analytics);
const AdminUsers = lazy(pages.AdminUsers);
const AdminAudit = lazy(pages.AdminAudit);
const AdminSystem = lazy(pages.AdminSystem);
const Profile = lazy(pages.Profile);

/** A spinner only if loading takes noticeably long, so quick loads never flash one. */
const PageFallback = () => {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    const id = window.setTimeout(() => setShow(true), 250);
    return () => window.clearTimeout(id);
  }, []);
  return <div className="grid min-h-[40vh] place-items-center">{show && <Spinner />}</div>;
};

const RequireAuth: React.FC<{ children: React.ReactNode; allow?: (role?: string) => boolean }> = ({ children, allow }) => {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <PageFallback />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (allow && !allow(user.role)) return <Navigate to="/app" replace />;
  return <>{children}</>;
};

const Page: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ErrorBoundary compact>
    <Suspense fallback={<PageFallback />}>{children}</Suspense>
  </ErrorBoundary>
);

export const App: React.FC = () => (
  <Routes>
    <Route element={<PublicLayout />}>
      <Route index element={<Page><Home /></Page>} />
      <Route path="complaints/new" element={<Page><FileComplaint /></Page>} />
      <Route path="complaints/track" element={<Page><TrackComplaint /></Page>} />
      <Route path="login" element={<Page><Login /></Page>} />
    </Route>

    <Route
      path="app"
      element={
        <RequireAuth>
          <AppLayout />
        </RequireAuth>
      }
    >
      <Route index element={<Page><Dashboard /></Page>} />
      <Route path="cases" element={<Page><Cases /></Page>} />
      <Route path="cases/:caseId" element={<Page><CaseWorkspace /></Page>} />
      <Route path="complaints" element={<RequireAuth allow={can.triageComplaints}><Page><Complaints /></Page></RequireAuth>} />
      <Route path="hearings" element={<Page><Hearings /></Page>} />
      <Route path="courtroom" element={<RequireAuth allow={can.runStand}><Page><CourtroomSelect /></Page></RequireAuth>} />
      <Route path="courtroom/:hearingId" element={<RequireAuth allow={can.runStand}><Page><Stand /></Page></RequireAuth>} />
      <Route path="research" element={<Page><Research /></Page>} />
      <Route path="library" element={<Page><Library /></Page>} />
      <Route path="library/:docId" element={<Page><LawDocumentView /></Page>} />
      <Route path="analytics" element={<Page><Analytics /></Page>} />
      <Route path="profile" element={<Page><Profile /></Page>} />
      <Route path="admin/users" element={<RequireAuth allow={can.admin}><Page><AdminUsers /></Page></RequireAuth>} />
      <Route path="admin/audit" element={<RequireAuth allow={can.admin}><Page><AdminAudit /></Page></RequireAuth>} />
      <Route path="admin/system" element={<RequireAuth allow={can.admin}><Page><AdminSystem /></Page></RequireAuth>} />
      <Route path="*" element={<Page><NotFound inApp /></Page>} />
    </Route>

    <Route element={<PublicLayout />}>
      <Route path="*" element={<Page><NotFound /></Page>} />
    </Route>
  </Routes>
);

export default App;
