import React, { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { can } from "./lib/roles";
import { PublicLayout } from "./components/layout/PublicLayout";
import { AppLayout } from "./components/layout/AppLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Spinner } from "./components/ui/core";

const Home = lazy(() => import("./pages/public/Home"));
const FileComplaint = lazy(() => import("./pages/public/FileComplaint"));
const TrackComplaint = lazy(() => import("./pages/public/TrackComplaint"));
const Login = lazy(() => import("./pages/public/Login"));
const NotFound = lazy(() => import("./pages/public/NotFound"));

const Dashboard = lazy(() => import("./pages/app/Dashboard"));
const Cases = lazy(() => import("./pages/app/Cases"));
const CaseWorkspace = lazy(() => import("./pages/app/case/CaseWorkspace"));
const Complaints = lazy(() => import("./pages/app/Complaints"));
const Hearings = lazy(() => import("./pages/app/Hearings"));
const CourtroomSelect = lazy(() => import("./pages/app/courtroom/CourtroomSelect"));
const Stand = lazy(() => import("./pages/app/courtroom/Stand"));
const Research = lazy(() => import("./pages/app/Research"));
const Library = lazy(() => import("./pages/app/Library"));
const LawDocumentView = lazy(() => import("./pages/app/LawDocumentView"));
const Analytics = lazy(() => import("./pages/app/Analytics"));
const AdminUsers = lazy(() => import("./pages/app/admin/Users"));
const AdminAudit = lazy(() => import("./pages/app/admin/Audit"));
const AdminSystem = lazy(() => import("./pages/app/admin/System"));
const Profile = lazy(() => import("./pages/app/Profile"));

const PageFallback = () => (
  <div className="grid min-h-[40vh] place-items-center">
    <Spinner />
  </div>
);

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
