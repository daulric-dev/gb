import { useEffect, useState } from "react";
import { View } from "react-native";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Button } from "@/components/ui/Button";

/**
 * A single-field name sheet, reused for renaming a file/folder and for
 * creating a folder. The parent owns the API call via `onSubmit`.
 */
export function NameSheet({
  open,
  title,
  description,
  label = "Name",
  initialValue = "",
  submitLabel = "Save",
  placeholder,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description?: string;
  label?: string;
  initialValue?: string;
  submitLabel?: string;
  placeholder?: string;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);

  // Reset the field each time the sheet opens for a new target.
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const submit = async () => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={title} description={description}>
      <View style={{ gap: 6 }}>
        <Label>{label}</Label>
        <Input
          value={value}
          onChangeText={setValue}
          placeholder={placeholder}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={submit}
        />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
        <Button variant="outline" onPress={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onPress={submit} loading={busy} disabled={!value.trim()}>
          {submitLabel}
        </Button>
      </View>
    </Sheet>
  );
}
