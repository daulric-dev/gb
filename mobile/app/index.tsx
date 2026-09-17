import { Redirect } from "expo-router";
import { useAuth } from "@/providers/AuthProvider";
import { Loading } from "@/components/layout/Loading";

export default function Index() {
  const { profile, loading } = useAuth();

  if (loading) return <Loading />;
  if (!profile) return <Redirect href="/(auth)/login" />;
  if (!profile.first_name) return <Redirect href="/(auth)/onboard" />;

  // Students live in the portal; without a school they have not redeemed a
  // claim code yet, which is a different fix from picking a school.
  if (profile.account_type === "student") {
    if (!profile.school) return <Redirect href="/(auth)/schools" />;
    return <Redirect href="/(portal)" />;
  }

  if (!profile.school) return <Redirect href="/(auth)/schools" />;
  return <Redirect href="/(tabs)" />;
}
