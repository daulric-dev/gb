/**
 * Split a PostgreSQL script into single statements, so each can go through
 * `$executeRawUnsafe` (one statement per call) inside one transaction.
 * Understands `--` and nested `/* *\/` comments, '...' strings (with ''
 * escapes, and E'...' backslash escapes), "..." identifiers and $tag$
 * dollar-quoted bodies. Comment-only fragments are dropped.
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  // Index of the current statement's first non-comment character, or -1.
  let begin = -1;
  let i = 0;
  const n = sql.length;
  const mark = (at: number) => {
    if (begin === -1) begin = at;
  };

  const push = (end: number) => {
    if (begin !== -1) {
      const text = sql.slice(begin, end).trim();
      if (text) out.push(text);
    }
    begin = -1;
  };

  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    if (c === '-' && next === '-') {
      const eol = sql.indexOf('\n', i);
      i = eol === -1 ? n : eol + 1;
      continue;
    }
    if (c === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth--;
          i += 2;
        } else i++;
      }
      continue;
    }
    if (c === "'") {
      const escapes = i > 0 && /[eE]/.test(sql[i - 1]) && !/[\w$]/.test(sql[i - 2] ?? '');
      mark(escapes ? i - 1 : i);
      i++;
      while (i < n) {
        if (escapes && sql[i] === '\\') {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '"') {
      mark(i);
      i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '$') {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      // `$1` (a parameter) is not a dollar quote; neither is `x$y`.
      if (tag && !/[\w$]/.test(sql[i - 1] ?? '')) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        mark(i);
        i = close === -1 ? n : close + tag[0].length;
        continue;
      }
    }
    if (c === ';') {
      push(i);
      i++;
      continue;
    }
    if (!/\s/.test(c)) mark(i);
    i++;
  }
  push(n);
  return out;
}
