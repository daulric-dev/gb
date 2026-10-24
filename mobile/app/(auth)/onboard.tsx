import { useEffect, useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { api, ApiError } from "@/lib/api";
import { useAuth, type UserProfile } from "@/providers/AuthProvider";
import { homeRouteFor } from "@/lib/routing";
import { fetchSuggestedProfile } from "@/lib/sso";
import { useToast } from "@/providers/ToastProvider";
import { AuthShell } from "@/components/auth/AuthShell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Text } from "@/components/ui/Text";

type AccountType = "staff" | "student";

export default function OnboardScreen() {
  const router = useRouter();
  const toast = useToast();
  const { refresh } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("staff");
  const [loading, setLoading] = useState(false);

  // Someone who arrived by single sign-on already told their provider their
  // name; offer it rather than asking again. Only fills fields still empty.
  useEffect(() => {
    let cancelled = false;
    fetchSuggestedProfile()
      .then((suggested) => {
        if (cancelled || !suggested) return;
        if (suggested.firstName) {
          setFirstName((v) => v || suggested.firstName || "");
        }
        if (suggested.lastName) {
          setLastName((v) => v || suggested.lastName || "");
        }
      })
      .catch(() => {
        /* nothing to suggest; they type it */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit() {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error("Enter your first and last name");
      return;
    }
    setLoading(true);
    try {
      const updated = await api<UserProfile>("/auth/onboard", {
        method: "PATCH",
        body: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          accountType,
        },
        skipAuthRedirect: true,
      });
      await refresh();
      // A school email address joins its school during onboarding, so the
      // returned profile may already have one. Without it, both account types
      // land on the schools screen to request to join.
      const joined =
        updated?.school && updated.school_management?.role !== "admin"
          ? updated.school
          : null;
      if (joined) toast.success(`You've joined ${joined.name}`);
      router.replace(homeRouteFor(updated ?? null));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Onboarding failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader style={{ alignItems: "center" }}>
          <CardTitle>Complete your profile</CardTitle>
          <CardDescription>
            Tell us a bit about yourself to get started
          </CardDescription>
        </CardHeader>
        <CardContent style={{ gap: 16 }}>
          <View>
            <Label>First name</Label>
            <Input
              placeholder="John"
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
              autoFocus
              returnKeyType="next"
            />
          </View>
          <View>
            <Label>Last name</Label>
            <Input
              placeholder="Doe"
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
            />
          </View>
          <View style={{ gap: 8 }}>
            <Label>I am joining as</Label>
            <SegmentedControl<AccountType>
              value={accountType}
              onChange={setAccountType}
              options={[
                { value: "staff", label: "Staff" },
                { value: "student", label: "Student" },
              ]}
            />
            <Text variant="muted" style={{ fontSize: 12 }}>
              {accountType === "student"
                ? "Request to join your school; an administrator approves you."
                : "An administrator approves staff before you get access."}
            </Text>
          </View>
          <Button onPress={handleSubmit} loading={loading}>
            Continue
          </Button>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
