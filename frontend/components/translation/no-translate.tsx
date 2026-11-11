import type { ComponentPropsWithoutRef, ElementType } from "react";

/**
 * Content that must never be sent to the machine translation service:
 * people's names, marks, feedback, messages, email addresses. The page
 * translator (lib/page-translator.ts) skips any subtree marked
 * `translate="no"`; browsers' own translators honour it too.
 *
 * Prefer adding `translate="no"` to an existing element; use this wrapper
 * where there is none (`<NoTranslate>{student.name}</NoTranslate>`).
 */
export function NoTranslate<T extends ElementType = "span">({
  as,
  ...props
}: { as?: T } & Omit<ComponentPropsWithoutRef<T>, "as" | "translate">) {
  const Tag = (as ?? "span") as ElementType;
  return <Tag {...props} translate="no" />;
}
