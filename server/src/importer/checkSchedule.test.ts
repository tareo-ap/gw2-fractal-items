import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nextCheckAt, parseCheckSchedule } from './checkSchedule.js';

const cfg = parseCheckSchedule({ UPDATE_CHECK: 'on' })!;
const next = (iso: string) => nextCheckAt(new Date(iso), cfg).toISOString();

// Sommerzeit (MESZ = UTC+2): Montag 2026-07-06, Dienstag 2026-07-07
describe('nextCheckAt (Europe/Berlin, Sommerzeit)', () => {
  it('Montag 20:00 → Dienstag 06:00', () => assert.equal(next('2026-07-06T18:00:00Z'), '2026-07-07T04:00:00.000Z'));
  it('Dienstag 07:00 → Dienstag 17:00', () => assert.equal(next('2026-07-07T05:00:00Z'), '2026-07-07T15:00:00.000Z'));
  it('Dienstag 17:10 → 17:30', () => assert.equal(next('2026-07-07T15:10:00Z'), '2026-07-07T15:30:00.000Z'));
  it('Dienstag 17:30 exakt → 18:00 (strikt später)', () => assert.equal(next('2026-07-07T15:30:00Z'), '2026-07-07T16:00:00.000Z'));
  it('Dienstag 18:45 → 19:00 (Fensterende zählt)', () => assert.equal(next('2026-07-07T16:45:00Z'), '2026-07-07T17:00:00.000Z'));
  it('Dienstag 19:05 → Mittwoch 06:00', () => assert.equal(next('2026-07-07T17:05:00Z'), '2026-07-08T04:00:00.000Z'));
  it('Mittwoch 06:00 → Donnerstag 06:00', () => assert.equal(next('2026-07-08T04:00:00Z'), '2026-07-09T04:00:00.000Z'));
});

describe('nextCheckAt (Zeitumstellung)', () => {
  it('Winterzeit (MEZ = UTC+1): Dienstag 06:00 = 05:00 UTC', () => assert.equal(next('2026-01-12T20:00:00Z'), '2026-01-13T05:00:00.000Z'));
  it('Frühjahr: Samstag 28.03. 06:00 MEZ → Sonntag 29.03. 06:00 MESZ (04:00 UTC)', () => {
    assert.equal(next('2026-03-28T05:00:00Z'), '2026-03-29T04:00:00.000Z');
    assert.equal(next('2026-03-27T10:00:00Z'), '2026-03-28T05:00:00.000Z');
  });
  it('Herbst: Samstag 24.10. 06:00 MESZ → Sonntag 25.10. 06:00 MEZ (05:00 UTC)', () => {
    assert.equal(next('2026-10-24T05:00:00Z'), '2026-10-25T05:00:00.000Z');
    assert.equal(next('2026-10-24T10:00:00Z'), '2026-10-25T05:00:00.000Z');
  });
  it('Dienstag nach der Umstellung: Fenster 17:00 MESZ = 15:00 UTC', () => assert.equal(next('2026-03-31T04:00:00Z'), '2026-03-31T15:00:00.000Z'));
});

describe('nextCheckAt (Optionen)', () => {
  it('ohne Fenster nur täglich', () => {
    const daily = parseCheckSchedule({ UPDATE_CHECK: 'on', UPDATE_CHECK_PATCH_WINDOW: 'off', UPDATE_CHECK_DAILY_AT: '03:15', UPDATE_CHECK_TZ: 'UTC' })!;
    assert.equal(nextCheckAt(new Date('2026-07-07T05:00:00Z'), daily).toISOString(), '2026-07-08T03:15:00.000Z');
  });
});

describe('parseCheckSchedule', () => {
  const run = (env: Record<string, string | undefined>) => {
    const warnings: string[] = [];
    return { result: parseCheckSchedule(env, (m) => warnings.push(m)), warnings };
  };

  it('Default ist aus', () => assert.equal(run({}).result, null));
  it('on mit Defaults', () => {
    assert.deepEqual(run({ UPDATE_CHECK: 'on' }).result, {
      timeZone: 'Europe/Berlin',
      dailyMinute: 360,
      window: { day: 2, startMinute: 1020, endMinute: 1140 },
      windowEveryMinutes: 30,
    });
  });
  it('ungültige Werte: Warnung und aus', () => {
    for (const env of <Record<string, string>[]>[
      { UPDATE_CHECK: 'maybe' },
      { UPDATE_CHECK: 'on', UPDATE_CHECK_TZ: 'Nowhere/Land' },
      { UPDATE_CHECK: 'on', UPDATE_CHECK_DAILY_AT: '25:00' },
      { UPDATE_CHECK: 'on', UPDATE_CHECK_PATCH_WINDOW: 'Tue 19:00-17:00' },
      { UPDATE_CHECK: 'on', UPDATE_CHECK_PATCH_WINDOW: 'Xyz 17:00-19:00' },
      { UPDATE_CHECK: 'on', UPDATE_CHECK_PATCH_EVERY_MINUTES: '0' },
    ]) {
      const { result, warnings } = run(env);
      assert.equal(result, null, JSON.stringify(env));
      assert.equal(warnings.length, 1, JSON.stringify(env));
    }
  });
});
