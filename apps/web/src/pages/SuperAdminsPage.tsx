import UsersPage from "./UsersPage.tsx";

/**
 * Super Admins — a dedicated, super-admin-only console for managing the other
 * super admins who run this Advise CRM. Advisors live on the separate
 * "Smart Advisors" roster (/users); each page shows exactly one role slice so
 * nobody is listed on both. Reuses the full user CRUD from UsersPage; the route
 * is gated by RequireSuperAdmin and the sidebar entry is super-admin-only.
 */
export default function SuperAdminsPage() {
  return (
    <UsersPage
      title="Super Admins"
      subtitle="Manage the super admins who run this workspace"
      roles={["super_admin"]}
    />
  );
}
