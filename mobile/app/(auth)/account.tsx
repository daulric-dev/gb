import { Redirect, useRouter } from "expo-router";
import { useAuth } from "@/providers/AuthProvider";
import { Loading } from "@/components/layout/Loading";
import { AccountSettingsScreen } from "@/features/account/AccountSettingsScreen";

/**
 * Account settings outside the school tabs, for an organisation admin who
 * belongs to no school (reached from /(auth)/organisation).
 */
export default function AccountScreen() {
  const router = useRouter();
  const { profile, loading } = useAuth();

  if (loading) return <Loading />;
  if (!profile) return <Redirect href="/(auth)/login" />;

  return (
    <AccountSettingsScreen
      onBack={() =>
        router.canGoBack() ? router.back() : router.replace("/(auth)/organisation")
      }
    />
  );
}
