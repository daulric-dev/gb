import type { ReactNode } from "react";
import { Text } from "./Text";

export function Label({ children }: { children: ReactNode }) {
  return (
    <Text variant="label" style={{ marginBottom: 6 }}>
      {children}
    </Text>
  );
}
