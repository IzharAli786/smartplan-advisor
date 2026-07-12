import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext.tsx";
import Layout from "./components/Layout.tsx";
import { RequireAuth, RequireManager, RequireSuperAdmin } from "./components/guards.tsx";

import LoginPage from "./pages/LoginPage.tsx";
import RegisterPage from "./pages/RegisterPage.tsx";
import SetPasswordPage from "./pages/SetPasswordPage.tsx";
import ForgotPasswordPage from "./pages/ForgotPasswordPage.tsx";
import TodayPage from "./pages/TodayPage.tsx";
import PipelinePage from "./pages/PipelinePage.tsx";
import NewOpportunityPage from "./pages/NewOpportunityPage.tsx";
import OpportunityDetailPage from "./pages/OpportunityDetailPage.tsx";
import LibraryPage from "./pages/LibraryPage.tsx";
import NotificationsPage from "./pages/NotificationsPage.tsx";
import DashboardPage from "./pages/DashboardPage.tsx";
import AdvisorDetailPage from "./pages/AdvisorDetailPage.tsx";
import ClaimsPage from "./pages/ClaimsPage.tsx";
import ReportsPage from "./pages/ReportsPage.tsx";
import UsersPage from "./pages/UsersPage.tsx";
import SuperAdminsPage from "./pages/SuperAdminsPage.tsx";
import SettingsPage from "./pages/SettingsPage.tsx";
import BrandingPage from "./pages/BrandingPage.tsx";
import AdminMenuPage from "./pages/AdminMenuPage.tsx";
import QuotesPage from "./pages/QuotesPage.tsx";
import QuoteEditorPage from "./pages/QuoteEditorPage.tsx";
import QuoteDetailPage from "./pages/QuoteDetailPage.tsx";
import PublicQuotePage from "./pages/PublicQuotePage.tsx";
import AddressBookPage from "./pages/AddressBookPage.tsx";
import EmailTemplatesPage from "./pages/EmailTemplatesPage.tsx";
import ImportPipelinePage from "./pages/ImportPipelinePage.tsx";
import ImportLeadsPage from "./pages/ImportLeadsPage.tsx";
import LeadsPage from "./pages/LeadsPage.tsx";
import PerformancePage from "./pages/PerformancePage.tsx";

/** Index route: advisors land on Today; managers on the Dashboard. */
function HomeRoute() {
  const { isManager } = useAuth();
  return isManager ? <Navigate to="/dashboard" replace /> : <TodayPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/set-password" element={<SetPasswordPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/q/:token" element={<PublicQuotePage />} />

      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<HomeRoute />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/new" element={<NewOpportunityPage />} />
        <Route path="/opportunity/:id" element={<OpportunityDetailPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/quotes" element={<QuotesPage />} />
        <Route path="/quotes/new" element={<QuoteEditorPage />} />
        <Route path="/quotes/:id" element={<QuoteDetailPage />} />
        <Route path="/quotes/:id/edit" element={<QuoteEditorPage />} />
        <Route path="/address-book" element={<AddressBookPage />} />
        <Route path="/leads" element={<LeadsPage />} />
        <Route path="/performance" element={<PerformancePage />} />

        {/* Managerial */}
        <Route path="/dashboard" element={<RequireManager><DashboardPage /></RequireManager>} />
        <Route path="/advisors/:id" element={<RequireManager><AdvisorDetailPage /></RequireManager>} />
        <Route path="/claims" element={<RequireManager><ClaimsPage /></RequireManager>} />
        <Route path="/reports" element={<RequireManager><ReportsPage /></RequireManager>} />
        <Route path="/pipeline/import" element={<RequireManager><ImportPipelinePage /></RequireManager>} />
        <Route path="/leads/import" element={<RequireManager><ImportLeadsPage /></RequireManager>} />
        <Route path="/settings" element={<RequireManager><SettingsPage /></RequireManager>} />
        <Route path="/settings/email-templates" element={<RequireManager><EmailTemplatesPage /></RequireManager>} />
        <Route path="/branding" element={<RequireManager><BrandingPage /></RequireManager>} />
        {/* Collateral management merged into Library; keep the old path working. */}
        <Route path="/collateral-admin" element={<Navigate to="/library" replace />} />
        <Route path="/admin" element={<RequireManager><AdminMenuPage /></RequireManager>} />

        {/* Roster: managerial can view + edit advisors; creation is gated to super admin in-page */}
        <Route path="/users" element={<RequireManager><UsersPage /></RequireManager>} />

        {/* Super Admins: full user administration, super-admin only */}
        <Route path="/super-admins" element={<RequireSuperAdmin><SuperAdminsPage /></RequireSuperAdmin>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
