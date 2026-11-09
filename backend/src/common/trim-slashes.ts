/**
 * The string without trailing '/' characters, in linear time.
 *
 * Replaces `s.replace(/\/+$/, '')`: that regex backtracks quadratically on
 * input with many slashes that are not at the end (CodeQL
 * js/polynomial-redos), and several callers pass request paths or
 * user-entered URLs.
 */
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return end === value.length ? value : value.slice(0, end);
}
