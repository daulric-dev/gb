import { Redirect } from "expo-router";
import { useAuth } from "@/providers/AuthProvider";
import { Loading } from "@/components/layout/Loading";
import { homeRouteFor } from "@/lib/routing";

export default function Index() {
  const { profile, loading } = useAuth();

  if (loading) return <Loading />;
  // One place decides where a session lands; the layouts re-check it so a
  // direct URL cannot drop someone into the wrong app.
  return <Redirect href={homeRouteFor(profile)} />;
}
