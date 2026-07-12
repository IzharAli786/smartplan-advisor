import UsersPage from "./UsersPage.tsx";

/**
 * Super Admins — a dedicated, super-admin-only console for managing ALL users
 * (advisors, managers and other super admins like Tom). It reuses the full user
 * CRUD from UsersPage; the route is gated by RequireSuperAdmin and the sidebar
 * entry is shown only to super admins. Kept separate from the "Smart Advisors"
 * roster (/users) for clarity.
 */
export default function SuperAdminsPage() {
  return (
    <UsersPage
      title="Super Admins"
      subtitle="Manage all users — advisors, managers and super admins"
    />
  );
}
