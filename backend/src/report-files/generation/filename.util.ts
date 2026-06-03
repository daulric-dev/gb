/**
 * Ensure each entry in a zip gets a distinct name. Two students can share a
 * first + last name, which would otherwise silently overwrite one another.
 * Ported from the frontend bulk-export helper.
 */
export function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const stem = dot === -1 ? name : name.slice(0, dot);
  const ext = dot === -1 ? '' : name.slice(dot);
  let n = 2;
  let candidate = `${stem}_${n}${ext}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${stem}_${n}${ext}`;
  }
  used.add(candidate);
  return candidate;
}
