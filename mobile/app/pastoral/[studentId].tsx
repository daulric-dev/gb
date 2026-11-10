import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { ShieldAlert } from "lucide-react-native";
import { api } from "@/lib/api";
import { isFeatureDisabledError } from "@/lib/features";
import {
  localToday,
  mayUsePastoral,
  pastoralPaths,
  SEVERITIES,
  type PastoralAbilities,
  type PastoralCategory,
  type PastoralNote,
  type PastoralSeverity,
} from "@/lib/pastoral";
import { useTheme } from "@/theme/ThemeProvider";
import { useToast } from "@/providers/ToastProvider";
import { Screen } from "@/components/layout/Screen";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { Text } from "@/components/ui/Text";

/** A selectable chip with its state exposed to screen readers. */
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={[
        styles.chip,
        {
          borderColor: selected ? colors.primary : colors.border,
          backgroundColor: selected ? colors.primary : "transparent",
        },
      ]}
    >
      <Text style={{ color: selected ? colors.primaryForeground : colors.foreground, fontSize: 14 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A student's pastoral timeline for staff, with a quick note. What a person
 * sees follows the same permissions as the web (the server enforces them):
 * readers see the school's notes, writers their own, safeguarding notes need
 * the safeguarding permission. Never reachable from the student or parent
 * tabs.
 */
export default function PastoralStudentScreen() {
  const { studentId, name } = useLocalSearchParams<{ studentId: string; name?: string }>();
  const toast = useToast();
  const [me, setMe] = useState<PastoralAbilities | null>(null);
  const [categories, setCategories] = useState<PastoralCategory[]>([]);
  const [notes, setNotes] = useState<PastoralNote[] | null>(null);
  const [off, setOff] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [severity, setSeverity] = useState<PastoralSeverity>("low");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, c, n] = await Promise.all([
        api<PastoralAbilities>(pastoralPaths.me),
        api<PastoralCategory[]>(pastoralPaths.categories),
        api<PastoralNote[]>(pastoralPaths.notes(studentId)),
      ]);
      setMe(m);
      setCategories(c.filter((x) => !x.archived));
      setNotes(n);
    } catch (err) {
      if (isFeatureDisabledError(err)) setOff(true);
      setNotes([]);
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load().finally(() => setRefreshing(false));
  }, [load]);

  async function add() {
    if (!categoryId) {
      toast.error("Choose a category");
      return;
    }
    if (!body.trim()) {
      toast.error("Write the note");
      return;
    }
    setSaving(true);
    try {
      await api(pastoralPaths.notes(studentId), {
        method: "POST",
        body: { categoryId, severity, occurredOn: localToday(), body: body.trim() },
      });
      setBody("");
      toast.success("Note added");
      await load();
    } catch {
      toast.error("Failed to add the note");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen
      title="Pastoral notes"
      description={name ? String(name) : "Private staff notes"}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {off ? (
        <Text variant="muted">Pastoral notes are turned off for your school.</Text>
      ) : notes === null ? (
        <Skeleton style={{ height: 120, borderRadius: 14 }} />
      ) : !mayUsePastoral(me) ? (
        <Text variant="muted">You don&apos;t have access to pastoral notes.</Text>
      ) : (
        <>
          <Text variant="muted">
            Never shown to the student or their parents.
          </Text>

          {me?.canCreate ? (
            <Card>
              <CardHeader>
                <CardTitle>Quick note</CardTitle>
              </CardHeader>
              <CardContent style={{ gap: 12 }}>
                <View accessibilityRole="radiogroup" accessibilityLabel="Category" style={styles.chips}>
                  {categories.map((c) => (
                    <Chip
                      key={c.id}
                      label={c.isSafeguarding ? `${c.label} (restricted)` : c.label}
                      selected={categoryId === c.id}
                      onPress={() => setCategoryId(c.id)}
                    />
                  ))}
                </View>
                <View accessibilityRole="radiogroup" accessibilityLabel="Severity" style={styles.chips}>
                  {SEVERITIES.map((s) => (
                    <Chip key={s.value} label={s.label} selected={severity === s.value} onPress={() => setSeverity(s.value)} />
                  ))}
                </View>
                <Input
                  accessibilityLabel="Note"
                  placeholder="What happened?"
                  value={body}
                  onChangeText={setBody}
                  multiline
                  maxLength={20000}
                  style={{ minHeight: 96, textAlignVertical: "top" }}
                />
                <Button onPress={() => void add()} loading={saving} accessibilityLabel="Add note">
                  Add note
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {notes.length === 0 ? (
            <Text variant="muted">No notes you can see yet.</Text>
          ) : (
            <View style={{ gap: 12 }}>
              {notes.map((n) => (
                <Card key={n.id}>
                  <CardContent style={{ gap: 6 }}>
                    <View style={styles.chips}>
                      <Text weight="600">{n.occurredOn}</Text>
                      <Badge variant="outline">{n.categoryLabel}</Badge>
                      {n.isSafeguarding ? <ShieldAlert size={16} accessibilityLabel="Safeguarding" /> : null}
                      <Badge>{SEVERITIES.find((s) => s.value === n.severity)?.label ?? n.severity}</Badge>
                      <Badge variant="secondary">{n.status === "open" ? "Open" : "Resolved"}</Badge>
                    </View>
                    <Text>{n.body}</Text>
                    <Text variant="muted" style={{ fontSize: 12 }}>
                      {n.authorName ? `By ${n.authorName}` : ""}
                      {n.followUpOn && n.status === "open"
                        ? ` · Follow up ${n.followUpOn}${n.assignedToName ? ` (${n.assignedToName})` : ""}`
                        : ""}
                    </Text>
                  </CardContent>
                </Card>
              ))}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    justifyContent: "center",
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
