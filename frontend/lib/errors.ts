import { ApiError } from "@/lib/api";

/**
 * Turning errors into what the user sees.
 *
 * Toasts, alerts and inline errors only ever show short, human text: never a
 * stack trace, Prisma or SQL text, a file path, a `TypeError`, a JSON parse
 * error or an HTML error page. Every catch that shows something goes through
 * `userMessage(err, fallback)`; the full error stays in the console.
 */

/** What the API answers for an unexpected failure (backend `GENERIC_ERROR_MESSAGE`). */
export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/** A request that never got an answer. */
export const NETWORK_ERROR_MESSAGE =
  "Can't reach the server. Check your connection and try again.";

/** A 429 whose own text is not fit to show (e.g. the throttler's default). */
export const RATE_LIMIT_MESSAGE = "Too many attempts. Wait a moment and try again.";

const MAX_LENGTH = 200;

/**
 * An error whose message was written for the user (a blocked location, a
 * failed upload), so `userMessage` may show it.
 */
export class FriendlyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FriendlyError";
  }
}

/** Text that is a server or runtime internal, not a message for a person. */
const INTERNAL = [
  /\n\s*at\s/, // stack frames
  /\bat\s+(async\s+)?\S+\s+\(/,
  /Invalid `prisma/i,
  /\bprisma\./i,
  /\bP\d{4}\b/, // Prisma error codes
  /SQLSTATE|\bsyntax error at or near\b|violates .*constraint|duplicate key value|relation ".*" does not exist|column ".*" does not exist/i,
  /\bE(CONN[A-Z]+|TIMEDOUT|NOTFOUND|AI_AGAIN|PIPE|HOSTUNREACH)\b/,
  /\b(Type|Reference|Syntax|Range|Internal)Error\b/,
  /\b\w+Exception:/, // e.g. "ThrottlerException: Too Many Requests"
  /\bcannot read propert|\bis not a function\b|\bis not defined\b|\bundefined is not\b/i,
  /Unexpected token|Unexpected end of JSON|JSON\.parse|is not valid JSON/i,
  /<(!doctype|html|head|body)\b/i,
  /[\w-]+\.(ts|tsx|js|mjs|cjs|jsx)(:\d+)+/,
  /node_modules|webpack-internal|file:\/\//,
  /(^|\s)\/(usr|var|app|home|Users|src|opt|tmp)\//,
  /^Cannot (GET|POST|PUT|PATCH|DELETE|QUERY|HEAD|OPTIONS) \//, // Nest route-not-found
];

/**
 * `text` as one short line, or null when it is empty, a multi-line dump or
 * looks like an internal.
 */
export function safeText(text: unknown): string | null {
  if (typeof text !== "string") return null;
  if (INTERNAL.some((re) => re.test(text))) return null;
  if ((text.match(/\n/g) ?? []).length > 2) return null;
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return null;
  return line.length > MAX_LENGTH ? `${line.slice(0, MAX_LENGTH - 1).trimEnd()}…` : line;
}

/** The API's own message (validation errors come as a list; the first is shown). */
function apiText(err: ApiError): unknown {
  const message = (err.data as { message?: unknown } | undefined)?.message;
  if (Array.isArray(message)) return message.find((m) => typeof m === "string");
  return typeof message === "string" ? message : err.message;
}

function errorId(err: ApiError): string | null {
  const id = (err.data as { errorId?: unknown } | undefined)?.errorId;
  return typeof id === "string" && /^[\w-]{1,64}$/.test(id) ? id : null;
}

/** A fetch that never got a response (Chrome, Firefox and Safari wordings). */
function isFetchFailure(err: unknown): boolean {
  return (
    err instanceof TypeError &&
    /failed to fetch|networkerror|load failed|network request failed/i.test(err.message)
  );
}

/**
 * The message to show for `err`:
 * - an `ApiError` 4xx: the API's message, when it is safe text (a 429
 *   without one gets `RATE_LIMIT_MESSAGE`);
 * - an `ApiError` 5xx: the generic message, with the API's error id as a
 *   reference when it sent one;
 * - no response at all: "Can't reach the server…";
 * - a `FriendlyError`: its message, when it is safe text;
 * - anything else: `fallback`.
 */
export function userMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return NETWORK_ERROR_MESSAGE;
    if (err.status >= 500) {
      const id = errorId(err);
      return id ? `${GENERIC_ERROR_MESSAGE} Reference: ${id}` : GENERIC_ERROR_MESSAGE;
    }
    const text = safeText(apiText(err));
    if (err.status === 429) return text ?? RATE_LIMIT_MESSAGE;
    if (err.status >= 400) return text ?? fallback;
    return fallback;
  }
  if (isFetchFailure(err)) return NETWORK_ERROR_MESSAGE;
  if (err instanceof FriendlyError) return safeText(err.message) ?? fallback;
  return fallback;
}
