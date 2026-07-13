import UsersPage from "./UsersPage.tsx";

/**
 * Super Admins — a dedicated, super-admin-only console for managing the
 * managerial roles (managers and super admins). Advisors live on the separate
 * "Smart Advisors" roster (/users); each page shows exactly one role slice so
 * nobody is listed on both. Reuses the full user CRUD from UsersPage; the route
 * is gated by RequireSuperAdmin and the sidebar entry is super-admin-only.
 *
 * Creating a super admin here also mirrors them into the SmartPlan Eco-Admin
 * once they set their password (see services/smartplan-sync.ts), so the same
 * login works at SmartPlan's /eco-admin/login.
 */
export default function SuperAdminsPage() {
  return (
    <UsersPage
      title="Super Admins"
      subtitle="Manage managers and super admins"
      roles={["super_admin", "manager"]}
    />
  );
}
