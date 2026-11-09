import { describe, expect, test } from 'bun:test';
import {
  FEATURES,
  FEATURE_KEYS,
  effectiveForOrganisation,
  effectiveForSchool,
  featureDefinition,
  isFeatureKey,
  organisationSettings,
} from './feature.catalog';

describe('feature catalog', () => {
  test('defines every key once, with the contracted defaults', () => {
    expect(FEATURES.map((f) => f.key)).toEqual([...FEATURE_KEYS]);
    const defaults = Object.fromEntries(FEATURES.map((f) => [f.key, f.default]));
    expect(defaults).toEqual({
      messaging: true,
      student_messaging: false,
      chat_channels: false,
      announcements: true,
      discussions: true,
      attendance: true,
      files: true,
      calendar: true,
      course_copy: true,
      push_notifications: true,
      integrations: false,
      report_cards: true,
      parent_portal: false,
      parent_notifications: false,
      timetable: false,
      attendance_alerts: false,
      rostering: false,
      lti: false,
    });
  });

  test('lti is off by default, needs nothing else, and a school can switch it off', () => {
    expect(featureDefinition('lti').requires).toEqual([]);
    expect(effectiveForOrganisation(organisationSettings({})).lti).toBe(false);
    const org = organisationSettings({ lti: true });
    expect(effectiveForOrganisation(org).lti).toBe(true);
    expect(effectiveForSchool(org, []).lti).toBe(true);
    expect(effectiveForSchool(org, ['lti']).lti).toBe(false);
  });

  test('rostering is off by default and needs nothing else', () => {
    expect(featureDefinition('rostering').requires).toEqual([]);
    expect(effectiveForOrganisation(organisationSettings({})).rostering).toBe(false);
    expect(effectiveForOrganisation(organisationSettings({ rostering: true })).rostering).toBe(true);
  });

  test('timetable and attendance alerts require attendance; both default off', () => {
    expect(featureDefinition('timetable').requires).toEqual(['attendance']);
    expect(featureDefinition('attendance_alerts').requires).toEqual(['attendance']);
    const org = organisationSettings({ timetable: true, attendance_alerts: true });
    expect(effectiveForSchool(org, []).timetable).toBe(true);
    expect(effectiveForSchool(org, ['attendance']).timetable).toBe(false);
    expect(effectiveForSchool(org, ['attendance']).attendance_alerts).toBe(false);
  });

  test('student messaging and channels require messaging', () => {
    expect(featureDefinition('student_messaging').requires).toEqual(['messaging']);
    expect(featureDefinition('chat_channels').requires).toEqual(['messaging']);
    expect(featureDefinition('messaging').requires).toEqual([]);
  });

  test('parent notifications require the parent portal; both default off', () => {
    expect(featureDefinition('parent_notifications').requires).toEqual(['parent_portal']);
    expect(featureDefinition('parent_portal').default).toBe(false);
    const org = organisationSettings({ parent_notifications: true });
    expect(effectiveForOrganisation(org).parent_notifications).toBe(false);
    const both = organisationSettings({ parent_portal: true, parent_notifications: true });
    expect(effectiveForSchool(both, []).parent_notifications).toBe(true);
    expect(effectiveForSchool(both, ['parent_portal']).parent_notifications).toBe(false);
  });

  test('every requirement is a catalog key and every feature has a label', () => {
    for (const f of FEATURES) {
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.description.length).toBeGreaterThan(0);
      for (const r of f.requires) expect(isFeatureKey(r)).toBe(true);
    }
    expect(isFeatureKey('billing')).toBe(false);
    expect(isFeatureKey(42)).toBe(false);
  });
});

describe('organisationSettings', () => {
  test('defaults without overrides; unknown keys and non-booleans ignored', () => {
    const org = organisationSettings({
      student_messaging: true,
      calendar: false,
      billing: true,
      files: 'no',
    });
    expect(org.student_messaging).toBe(true);
    expect(org.calendar).toBe(false);
    expect(org.files).toBe(true);
    expect('billing' in org).toBe(false);
    expect(organisationSettings(null).messaging).toBe(true);
    expect(organisationSettings([]).chat_channels).toBe(false);
  });
});

describe('effective features', () => {
  test('a feature is off when something it requires is off', () => {
    const org = organisationSettings({
      messaging: false,
      student_messaging: true,
      chat_channels: true,
    });
    const eff = effectiveForOrganisation(org);
    expect(eff.messaging).toBe(false);
    expect(eff.student_messaging).toBe(false);
    expect(eff.chat_channels).toBe(false);
  });

  test('a school narrows the organisation, never widens it', () => {
    const org = organisationSettings({ student_messaging: true, calendar: false });
    const eff = effectiveForSchool(org, ['attendance', 'calendar', 'unknown']);
    expect(eff.student_messaging).toBe(true);
    expect(eff.attendance).toBe(false);
    expect(eff.calendar).toBe(false);
    expect(eff.files).toBe(true);
  });

  test('a school switching messaging off takes its dependants with it', () => {
    const org = organisationSettings({ student_messaging: true, chat_channels: true });
    const eff = effectiveForSchool(org, ['messaging']);
    expect(eff.student_messaging).toBe(false);
    expect(eff.chat_channels).toBe(false);
  });
});
