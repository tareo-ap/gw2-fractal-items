import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nextCheckAt, parseCheckSchedule } from './checkSchedule.js';

// Default schedule: daily 06:00 and Tuesday 17:00-19:00 every 30 min, time zone Europe/Berlin.
const schedule = parseCheckSchedule({ UPDATE_CHECK: 'on' })!;
const next = (iso: string) => nextCheckAt(new Date(iso), schedule).toISOString();

// Daylight saving time (CEST = UTC+2): Monday 2026-07-06, Tuesday 2026-07-07
describe('nextCheckAt (Europe/Berlin, daylight saving time)', () => {
    it('Monday 20:00 -> Tuesday 06:00', () => assert.equal(next('2026-07-06T18:00:00Z'), '2026-07-07T04:00:00.000Z'));
    it('Tuesday 07:00 -> Tuesday 17:00', () => assert.equal(next('2026-07-07T05:00:00Z'), '2026-07-07T15:00:00.000Z'));
    it('Tuesday 17:10 -> 17:30', () => assert.equal(next('2026-07-07T15:10:00Z'), '2026-07-07T15:30:00.000Z'));
    it('Tuesday 17:30 exactly -> 18:00 (strictly later)', () =>
        assert.equal(next('2026-07-07T15:30:00Z'), '2026-07-07T16:00:00.000Z'));
    it('Tuesday 18:45 -> 19:00 (window end counts)', () =>
        assert.equal(next('2026-07-07T16:45:00Z'), '2026-07-07T17:00:00.000Z'));
    it('Tuesday 19:05 -> Wednesday 06:00', () =>
        assert.equal(next('2026-07-07T17:05:00Z'), '2026-07-08T04:00:00.000Z'));
    it('Wednesday 06:00 -> Thursday 06:00', () =>
        assert.equal(next('2026-07-08T04:00:00Z'), '2026-07-09T04:00:00.000Z'));
});

describe('nextCheckAt (clock change)', () => {
    it('Winter time (CET = UTC+1): Tuesday 06:00 = 05:00 UTC', () =>
        assert.equal(next('2026-01-12T20:00:00Z'), '2026-01-13T05:00:00.000Z'));
    it('Spring: Saturday 28 March 06:00 CET -> Sunday 29 March 06:00 CEST (04:00 UTC)', () => {
        assert.equal(next('2026-03-28T05:00:00Z'), '2026-03-29T04:00:00.000Z');
        assert.equal(next('2026-03-27T10:00:00Z'), '2026-03-28T05:00:00.000Z');
    });
    it('Autumn: Saturday 24 October 06:00 CEST -> Sunday 25 October 06:00 CET (05:00 UTC)', () => {
        assert.equal(next('2026-10-24T05:00:00Z'), '2026-10-25T05:00:00.000Z');
        assert.equal(next('2026-10-24T10:00:00Z'), '2026-10-25T05:00:00.000Z');
    });
    it('Tuesday after the switch: window 17:00 CEST = 15:00 UTC', () =>
        assert.equal(next('2026-03-31T04:00:00Z'), '2026-03-31T15:00:00.000Z'));
});

describe('nextCheckAt (options)', () => {
    it('without a window only daily', () => {
        const daily = parseCheckSchedule({
            UPDATE_CHECK: 'on',
            UPDATE_CHECK_PATCH_WINDOW: 'off',
            UPDATE_CHECK_DAILY_AT: '03:15',
            UPDATE_CHECK_TZ: 'UTC',
        })!;
        assert.equal(nextCheckAt(new Date('2026-07-07T05:00:00Z'), daily).toISOString(), '2026-07-08T03:15:00.000Z');
    });
});

describe('parseCheckSchedule', () => {
    const run = (env: Record<string, string | undefined>) => {
        const warnings: string[] = [];
        return { result: parseCheckSchedule(env, (m) => warnings.push(m)), warnings };
    };

    it('default is off', () => assert.equal(run({}).result, null));
    it('on with defaults', () => {
        assert.deepEqual(run({ UPDATE_CHECK: 'on' }).result, {
            timeZone: 'Europe/Berlin',
            dailyMinute: 360,
            window: { day: 2, startMinute: 1020, endMinute: 1140 },
            windowEveryMinutes: 30,
        });
    });
    it('invalid values: warning and off', () => {
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
