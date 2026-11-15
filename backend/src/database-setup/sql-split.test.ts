import { describe, expect, test } from 'bun:test';
import { splitSqlStatements } from './sql-split';

describe('splitSqlStatements', () => {
  test('splits on semicolons outside strings, identifiers, comments and dollar quotes', () => {
    const sql = `
      -- a comment; with a semicolon
      CREATE TABLE "a;b" (x text DEFAULT 'it''s; fine');
      /* block; /* nested; */ still comment */
      CREATE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE NOTICE 'x;y';
        RETURN NEW;
      END;
      $$;
      CREATE FUNCTION g() RETURNS int AS $body$ SELECT 1; $body$ LANGUAGE sql;
      SELECT E'a\\';b';
      UPDATE t SET x = $1;
    `;
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(5);
    expect(out[0]).toBe(`CREATE TABLE "a;b" (x text DEFAULT 'it''s; fine')`);
    expect(out[1]).toContain('RAISE NOTICE');
    expect(out[1]).toEndWith('$$');
    expect(out[2]).toContain('$body$ SELECT 1; $body$');
    expect(out[3]).toBe(`SELECT E'a\\';b'`);
    expect(out[4]).toBe('UPDATE t SET x = $1');
  });

  test('drops comment-only fragments and a missing final semicolon is fine', () => {
    expect(splitSqlStatements('-- nothing\n;\n/* x */')).toEqual([]);
    expect(splitSqlStatements('SELECT 1')).toEqual(['SELECT 1']);
  });
});
