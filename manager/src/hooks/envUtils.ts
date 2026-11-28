import type { EnvVariable } from "@/types/env";

const SECRET_KEYWORDS = [
  "secret",
  "key",
  "token",
  "password",
  "passwd",
  "pwd",
  "pass",
  "pepper",
  "salt",
  "hash",
  "auth",
  "jwt",
  "private",
  "credential",
  "api_key",
  "access_key",
];

export function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Parses raw .env file text into structured EnvVariable objects.
 * Handles:
 * - KEY=VALUE
 * - export KEY=VALUE
 * - Single/double quoted values (with stripped quotes)
 * - Header comments (# comment on preceding line)
 * - Commented template variables (# KEY=default_val)
 * - Inline comments (KEY=val # inline comment)
 */
export function parseRawEnvText(rawText: string): EnvVariable[] {
  const vars: EnvVariable[] = [];
  let pendingComment: string | undefined = undefined;

  for (const line of rawText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      pendingComment = undefined;
      continue;
    }

    if (trimmed.startsWith("#")) {
      const commentBody = trimmed.replace(/^#+\s*/, "");
      // Check if this commented line is a template variable like "# API_URL=http://..."
      let lineToTest = commentBody;
      if (lineToTest.startsWith("export ")) {
        lineToTest = lineToTest.substring(7).trim();
      }
      if (lineToTest.includes("=")) {
        const [k, ...vParts] = lineToTest.split("=");
        const key = k.trim();
        if (key && !vars.some((v) => v.key.toUpperCase() === key.toUpperCase())) {
          let val = vParts.join("=").trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          vars.push({
            key,
            value: val,
            is_secret: isSecretKey(key),
            comment: pendingComment,
          });
          pendingComment = undefined;
          continue;
        }
      }
      pendingComment = commentBody;
      continue;
    }

    let lineToParse = trimmed;
    if (lineToParse.startsWith("export ")) {
      lineToParse = lineToParse.substring(7).trim();
    }

    if (lineToParse.includes("=")) {
      const [k, ...vParts] = lineToParse.split("=");
      const key = k.trim();
      if (!key) continue;

      let val = vParts.join("=").trim();
      let inlineComment: string | undefined = undefined;

      // Extract inline comments outside quotes
      if (val.startsWith('"')) {
        const closeQuoteIdx = val.indexOf('"', 1);
        if (closeQuoteIdx > 0) {
          const afterQuote = val.slice(closeQuoteIdx + 1).trim();
          if (afterQuote.startsWith("#")) {
            inlineComment = afterQuote.replace(/^#+\s*/, "");
          }
          val = val.slice(1, closeQuoteIdx);
        }
      } else if (val.startsWith("'")) {
        const closeQuoteIdx = val.indexOf("'", 1);
        if (closeQuoteIdx > 0) {
          const afterQuote = val.slice(closeQuoteIdx + 1).trim();
          if (afterQuote.startsWith("#")) {
            inlineComment = afterQuote.replace(/^#+\s*/, "");
          }
          val = val.slice(1, closeQuoteIdx);
        }
      } else {
        const hashIdx = val.indexOf(" #");
        if (hashIdx >= 0) {
          inlineComment = val.slice(hashIdx + 2).trim();
          val = val.slice(0, hashIdx).trim();
        }
      }

      const isSecret = isSecretKey(key);
      const commentToUse = inlineComment || pendingComment;

      const existingIdx = vars.findIndex((v) => v.key.toUpperCase() === key.toUpperCase());
      if (existingIdx >= 0) {
        vars[existingIdx] = {
          key,
          value: val,
          is_secret: isSecret,
          comment: commentToUse || vars[existingIdx].comment,
        };
      } else {
        vars.push({
          key,
          value: val,
          is_secret: isSecret,
          comment: commentToUse,
        });
      }
      pendingComment = undefined;
    }
  }

  return vars;
}
