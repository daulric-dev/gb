import { useState } from "react";
import { View } from "react-native";
import { AuthShell } from "@/components/auth/AuthShell";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { Text } from "@/components/ui/Text";

export function ServerSetupScreen({
  error,
  onConnect,
}: {
  error: string | null;
  onConnect: (url: string) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function connect() {
    if (connecting) return;
    setConnecting(true);
    setLocalError(null);
    try {
      await onConnect(url);
    } catch (cause) {
      setLocalError(
        cause instanceof Error
          ? cause.message
          : "Couldn't connect to that server. Please try again.",
      );
    } finally {
      setConnecting(false);
    }
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader style={{ alignItems: "center" }}>
          <CardTitle>Connect to your school</CardTitle>
          <CardDescription>
            Enter the GradeBook server address provided by your school.
          </CardDescription>
        </CardHeader>
        <CardContent style={{ gap: 16 }}>
          <View>
            <Label>School server URL</Label>
            <Input
              placeholder="https://school.example.com"
              value={url}
              onChangeText={(value) => {
                setUrl(value);
                setLocalError(null);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              autoComplete="url"
              editable={!connecting}
              onSubmitEditing={() => void connect()}
              returnKeyType="go"
            />
          </View>
          <Text variant="muted" size="sm" style={{ textAlign: "center" }}>
            Only connect to a server address you trust. Your sign-in details
            will be sent to that server.
          </Text>
          {localError || error ? (
            <Text tone="destructive" size="sm" style={{ textAlign: "center" }}>
              {localError ?? error}
            </Text>
          ) : null}
          <Button
            onPress={() => void connect()}
            loading={connecting}
            disabled={!url.trim()}
          >
            Connect
          </Button>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
