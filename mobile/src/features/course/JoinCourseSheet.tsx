import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { KeyRound, ScanLine } from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { studentCourseHref } from "@/lib/course";
import type { PortalCourseCard } from "@/lib/portal";
import { useToast } from "@/providers/ToastProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { Text } from "@/components/ui/Text";

/**
 * Join a course with the code a teacher shares: typed here, or scanned from
 * the course's join QR (the Scan screen recognises those too). The same
 * endpoint as the web portal's "Join a course".
 */
export function JoinCourseSheet({
  open,
  onClose,
  onJoined,
}: {
  open: boolean;
  onClose: () => void;
  onJoined?: (course: PortalCourseCard) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { colors } = useTheme();
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setCode("");
    setError(null);
    onClose();
  };

  async function join() {
    const joinCode = code.trim().toUpperCase();
    if (!joinCode) {
      setError("Enter the code your teacher gave you");
      return;
    }
    if (joining) return;
    setJoining(true);
    setError(null);
    try {
      const course = await api<PortalCourseCard>("/portal/me/courses/join", {
        method: "POST",
        body: { joinCode },
      });
      toast.success(`Joined ${course.name}`);
      onJoined?.(course);
      close();
      router.push(studentCourseHref(course.id));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? "No open course uses that code. Check it with your teacher - it may have been turned off or replaced."
          : err instanceof ApiError
            ? err.message
            : "Could not join the course",
      );
    } finally {
      setJoining(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Join a course"
      description="Enter the join code your teacher shared, or scan the course's QR code."
    >
      <View style={{ gap: 12 }}>
        <View style={{ gap: 6 }}>
          <Label>Join code</Label>
          <Input
            value={code}
            onChangeText={(v) => {
              setCode(v.replace(/\s+/g, "").toUpperCase());
              if (error) setError(null);
            }}
            placeholder="e.g. AB12CD"
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            maxLength={20}
            returnKeyType="go"
            onSubmitEditing={join}
          />
          {error ? (
            <Text size="sm" style={{ color: colors.destructive }}>
              {error}
            </Text>
          ) : null}
        </View>
        <Button
          onPress={join}
          loading={joining}
          disabled={!code.trim()}
          icon={<KeyRound color={colors.primaryForeground} size={18} />}
        >
          Join course
        </Button>
        <Button
          variant="outline"
          onPress={() => {
            close();
            router.push("/attendance/scan");
          }}
          icon={<ScanLine color={colors.foreground} size={18} />}
        >
          Scan a join QR code
        </Button>
      </View>
    </Sheet>
  );
}
