import { describe, expect, test } from 'bun:test';
import { postgresTextSearch, textSearch } from './text-search';

describe('textSearch', () => {
  test('the PostgreSQL implementation is the active one and matches case-insensitively', () => {
    expect(textSearch).toBe(postgresTextSearch);
    expect(textSearch.contains('ann')).toEqual({ contains: 'ann', mode: 'insensitive' });
    expect(textSearch.equals('Maths')).toEqual({ equals: 'Maths', mode: 'insensitive' });
  });
});
