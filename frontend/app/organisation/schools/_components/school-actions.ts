import { toast } from "sonner";
import { api } from "@/lib/api";
import { useSwitchSchool } from "@/hooks/use-my-schools";
import {
  errorMessage,
  revokedMessage,
  revokeUserSessions,
  type OrganisationSchool,
} from "@/lib/organisation";

/**
 * Activate or deactivate a school (deactivating asks first). Resolves true
 * when it changed, so the caller reloads.
 */
export async function toggleSchoolActive(school: OrganisationSchool): Promise<boolean> {
  const next = !school.isActive;
  if (
    !next &&
    !window.confirm(
      `Deactivate ${school.name}? Its staff and students lose access until it is activated again.`,
    )
  ) {
    return false;
  }
  try {
    await api(`/organisation/schools/${school.id}`, {
      method: "PATCH",
      body: { isActive: next },
    });
    toast.success(`${school.name} ${next ? "activated" : "deactivated"}`);
    return true;
  } catch (err) {
    toast.error(errorMessage(err, "Failed to update the school"));
    return false;
  }
}

/** Sign the school's admin out of every device, after a confirm. */
export async function signOutSchoolAdmin(school: OrganisationSchool): Promise<void> {
  const admin = school.admin;
  if (!admin) return;
  const who = admin.name || admin.email;
  if (!window.confirm(`Sign ${who} out of every device? They can sign in again.`)) {
    return;
  }
  try {
    const res = await revokeUserSessions(admin.userId);
    toast.success(revokedMessage(who, res?.revoked));
  } catch (err) {
    toast.error(errorMessage(err, "Failed to sign out"));
  }
}

/**
 * Open a school's own dashboard (students, staff, calendar, grade scales,
 * roles, email domains): switches the active school to it, then goes to its
 * settings. `switching` is the school being switched to.
 */
export function useOpenSchoolDashboard() {
  const { switchTo, switching } = useSwitchSchool();
  const open = (school: OrganisationSchool) => {
    if (!school.isActive) {
      toast.error("Activate the school before opening its dashboard");
      return;
    }
    void switchTo(school.id, "/dashboard/settings");
  };
  return { open, switching };
}
