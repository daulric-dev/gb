import { describe, expect, test } from 'bun:test';
import {
  domainOfEmail,
  isFreeMailDomain,
  normalizeDomain,
  txtHasToken,
} from './email-domain.util';

describe('normalizeDomain', () => {
  test('cleans what people paste', () => {
    expect(normalizeDomain(' Riverside.EDU ')).toBe('riverside.edu');
    expect(normalizeDomain('@students.riverside.edu')).toBe('students.riverside.edu');
    expect(normalizeDomain('https://riverside.edu/about')).toBe('riverside.edu');
    expect(normalizeDomain('riverside.edu.')).toBe('riverside.edu');
  });

  test('country second-level domains work like any other', () => {
    expect(normalizeDomain('srmss.edu.gd')).toBe('srmss.edu.gd');
    expect(normalizeDomain('students.smss.edu.gd')).toBe('students.smss.edu.gd');
    expect(domainOfEmail('kai@SRMSS.edu.gd')).toBe('srmss.edu.gd');
  });

  test('rejects anything that is not a domain', () => {
    expect(normalizeDomain('riverside')).toBeNull();
    expect(normalizeDomain('jo@riverside.edu')).toBeNull();
    expect(normalizeDomain('-bad.edu')).toBeNull();
    expect(normalizeDomain('')).toBeNull();
  });
});

describe('domainOfEmail', () => {
  test('takes the part after the last @', () => {
    expect(domainOfEmail('Jo.Lee@Students.Riverside.edu')).toBe('students.riverside.edu');
  });
  test('no domain, no match', () => {
    expect(domainOfEmail('nobody')).toBeNull();
    expect(domainOfEmail(null)).toBeNull();
  });
});

describe('isFreeMailDomain', () => {
  test('blocks public providers only', () => {
    expect(isFreeMailDomain('gmail.com')).toBe(true);
    expect(isFreeMailDomain('outlook.com')).toBe(true);
    expect(isFreeMailDomain('riverside.edu')).toBe(false);
  });
});

describe('txtHasToken', () => {
  test('matches a record, including one split into chunks', () => {
    expect(txtHasToken([['v=spf1 -all'], ['gradebook-verification=abc']], 'abc')).toBe(true);
    expect(txtHasToken([['gradebook-verif', 'ication=abc']], 'abc')).toBe(true);
  });
  test('needs the exact token', () => {
    expect(txtHasToken([['gradebook-verification=abcd']], 'abc')).toBe(false);
    expect(txtHasToken([], 'abc')).toBe(false);
  });
});
