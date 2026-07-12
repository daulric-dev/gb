import { Redirect } from "expo-router";
import { useAuth } from "@/providers/AuthProvider";
import { Loading } from "@/components/layout/Loading";

/**
 * Entry gate. Mirrors the web app's flow:
 *   - not authenticated        → /login
 *   - authenticated, no school → /needs-setup (finish onboarding on web)
 *   - authenticated + school   → dashboard tabs
 */
export default function Index() {
  const { profile, loading } = useAuth();

  if (loading) return <Loading />;
  if (!profile) return <Redirect href="/(auth)/login" />;
  if (!profile.school) return <Redirect href="/(auth)/needs-setup" />;
  return <Redirect href="/(tabs)" />;
}
