import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Plus, Trash2 } from "lucide-react-native";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/providers/ToastProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Text } from "@/components/ui/Text";
import type {
  BandPayload,
  GradeScaleDetail,
  GradeScaleType,
} from "./types";

/**
 * A band as edited in the form. Numeric fields are held as strings so the
 * text inputs can be cleared mid-edit; they're coerced on save.
 */
interface FormBand {
  label: string;
  minPercentage: string;
  maxPercentage: string;
  gpaPoints: string;
  isPass: boolean;
}

function emptyBand(): FormBand {
  return {
    label: "",
    minPercentage: "0",
    maxPercentage: "0",
    gpaPoints: "",
    isPass: true,
  };
}

function band(
  label: string,
  min: number,
  max: number,
  gpa: number | null,
  isPass: boolean,
): FormBand {
  return {
    label,
    minPercentage: String(min),
    maxPercentage: String(max),
    gpaPoints: gpa == null ? "" : String(gpa),
    isPass,
  };
}

function defaultBandsFor(type: GradeScaleType): FormBand[] {
  if (type === "pass_fail") {
    return [
      band("Pass", 50, 100, null, true),
      band("Fail", 0, 49.99, null, false),
    ];
  }
  if (type === "gpa") {
    return [
      band("A", 90, 100, 4.0, true),
      band("B", 80, 89.99, 3.0, true),
      band("C", 70, 79.99, 2.0, true),
      band("D", 60, 69.99, 1.0, true),
      band("F", 0, 59.99, 0.0, false),
    ];
  }
  return [
    band("A", 90, 100, null, true),
    band("B", 80, 89.99, null, true),
    band("C", 70, 79.99, null, true),
    band("D", 60, 69.99, null, true),
    band("F", 0, 59.99, null, false),
  ];
}

const TYPE_OPTIONS: { value: GradeScaleType; label: string }[] = [
  { value: "letter", label: "Letter (A–F)" },
  { value: "gpa", label: "GPA" },
  { value: "pass_fail", label: "Pass / Fail" },
];

/**
 * Create or edit a grade scale. Pass `existing` to edit; otherwise a new scale
 * is created. Mirrors the web `ScaleForm`: on edit, the name/default flag are
 * PATCHed and the bands are replaced via `PUT /grade-scales/:id/bands`.
 */
export function ScaleForm({
  existing,
  onSaved,
}: {
  existing: GradeScaleDetail | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { colors } = useTheme();

  const [name, setName] = useState(existing?.name ?? "");
  const [scaleType, setScaleType] = useState<GradeScaleType>(
    existing?.scaleType ?? "letter",
  );
  const [isDefault, setIsDefault] = useState(existing?.isDefault ?? false);
  const [bands, setBands] = useState<FormBand[]>(
    existing
      ? existing.bands.map((b) =>
          band(b.label, b.minPercentage, b.maxPercentage, b.gpaPoints, b.isPass),
        )
      : defaultBandsFor("letter"),
  );
  const [saving, setSaving] = useState(false);

  // Reset bands to a sensible template when the type changes (create flow).
  // Don't clobber an existing scale's bands when editing and the type is
  // unchanged. Type can't change while editing (the Select is disabled).
  useEffect(() => {
    if (existing && existing.scaleType === scaleType) return;
    setBands(defaultBandsFor(scaleType));
  }, [scaleType, existing]);

  const updateBand = (idx: number, patch: Partial<FormBand>) => {
    setBands((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  const addBand = () => setBands((prev) => [...prev, emptyBand()]);

  const removeBand = (idx: number) =>
    setBands((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (bands.length === 0) {
      toast.error("Add at least one band");
      return;
    }
    for (const b of bands) {
      if (!b.label.trim()) {
        toast.error("Every band needs a label");
        return;
      }
      if (Number(b.minPercentage) > Number(b.maxPercentage)) {
        toast.error(`Band "${b.label}" has min > max`);
        return;
      }
    }

    setSaving(true);
    try {
      const payloadBands: BandPayload[] = bands.map((b) => ({
        label: b.label.trim(),
        minPercentage: Number(b.minPercentage),
        maxPercentage: Number(b.maxPercentage),
        gpaPoints:
          scaleType === "gpa" && b.gpaPoints !== ""
            ? Number(b.gpaPoints)
            : null,
        isPass: b.isPass,
      }));

      if (existing) {
        await api(`/grade-scales/${existing.id}`, {
          method: "PATCH",
          body: { name: name.trim(), isDefault },
        });
        await api(`/grade-scales/${existing.id}/bands`, {
          method: "PUT",
          body: { bands: payloadBands },
        });
        toast.success("Scale updated");
      } else {
        await api("/grade-scales", {
          method: "POST",
          body: {
            name: name.trim(),
            scaleType,
            isDefault,
            bands: payloadBands,
          },
        });
        toast.success("Scale created");
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save scale");
    } finally {
      setSaving(false);
    }
  };

  const showGpa = scaleType === "gpa";

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 6 }}>
        <Label>Name</Label>
        <Input
          value={name}
          onChangeText={setName}
          placeholder="e.g. Standard Letter Grades"
        />
      </View>

      <View style={{ gap: 6 }}>
        <Label>Type</Label>
        <Select<GradeScaleType>
          value={scaleType}
          onChange={setScaleType}
          disabled={!!existing}
          options={TYPE_OPTIONS}
        />
        {existing ? (
          <Text variant="muted" style={{ fontSize: 12 }}>
            Type can&apos;t be changed after creation.
          </Text>
        ) : null}
      </View>

      <View style={styles.defaultRow}>
        <View style={{ flex: 1 }}>
          <Text weight="500">Default scale</Text>
          <Text variant="muted" style={{ fontSize: 12 }}>
            Use this scale to display grades school-wide.
          </Text>
        </View>
        <Switch value={isDefault} onValueChange={setIsDefault} />
      </View>

      <View style={{ gap: 8 }}>
        <View style={styles.bandsHeader}>
          <Label>Bands</Label>
          <Button
            variant="outline"
            size="sm"
            onPress={addBand}
            icon={<Plus size={14} color={colors.foreground} />}
          >
            Add band
          </Button>
        </View>

        <View style={{ gap: 10 }}>
          {bands.map((b, i) => (
            <View
              key={i}
              style={[
                styles.bandCard,
                { borderColor: colors.border, backgroundColor: colors.background },
              ]}
            >
              <View style={styles.bandTopRow}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="muted" style={styles.fieldLabel}>
                    Label
                  </Text>
                  <Input
                    value={b.label}
                    onChangeText={(v) => updateBand(i, { label: v })}
                    placeholder="A"
                  />
                </View>
                <Pressable
                  onPress={() => removeBand(i)}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.removeBtn,
                    { opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Trash2 size={18} color={colors.destructive} />
                </Pressable>
              </View>

              <View style={styles.numRow}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="muted" style={styles.fieldLabel}>
                    Min %
                  </Text>
                  <Input
                    keyboardType="numeric"
                    value={b.minPercentage}
                    onChangeText={(v) => updateBand(i, { minPercentage: v })}
                  />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text variant="muted" style={styles.fieldLabel}>
                    Max %
                  </Text>
                  <Input
                    keyboardType="numeric"
                    value={b.maxPercentage}
                    onChangeText={(v) => updateBand(i, { maxPercentage: v })}
                  />
                </View>
                {showGpa ? (
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text variant="muted" style={styles.fieldLabel}>
                      GPA
                    </Text>
                    <Input
                      keyboardType="numeric"
                      value={b.gpaPoints}
                      onChangeText={(v) => updateBand(i, { gpaPoints: v })}
                    />
                  </View>
                ) : null}
              </View>

              <View style={styles.passRow}>
                <Text style={{ fontSize: 13 }}>Pass</Text>
                <Switch
                  value={b.isPass}
                  onValueChange={(v) => updateBand(i, { isPass: v })}
                />
              </View>
            </View>
          ))}
        </View>

        <Text variant="muted" style={{ fontSize: 12 }}>
          Bands may not overlap. Gaps are allowed — scores in a gap display as
          numeric.
        </Text>
      </View>

      <Button onPress={handleSave} loading={saving}>
        {existing ? "Save changes" : "Create scale"}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  defaultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  bandsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bandCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  bandTopRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
  },
  numRow: {
    flexDirection: "row",
    gap: 10,
  },
  passRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  fieldLabel: {
    fontSize: 12,
  },
  removeBtn: {
    height: 44,
    justifyContent: "center",
    paddingHorizontal: 4,
  },
});
