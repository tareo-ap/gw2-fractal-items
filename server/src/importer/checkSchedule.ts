import type { AutoCheckSchedule } from '../../../shared/types.js';

// Schedule of the automatic build check: daily at a fixed time, plus at shorter intervals in a
// weekly patch window (GW2 patches usually arrive on Tuesday evenings).
// All times are in an IANA time zone; conversion uses Intl (no dependency).

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface PatchWindow {
    day: number; // 0 = Sunday … 6 = Saturday
    startMinute: number; // minutes since midnight
    endMinute: number;
}

export interface CheckScheduleConfig {
    timeZone: string;
    dailyMinute: number; // minutes since midnight
    window: PatchWindow | null;
    windowEveryMinutes: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (minute: number) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

/** Readable form of the schedule for API and UI. */
export function describeSchedule(cfg: CheckScheduleConfig): AutoCheckSchedule {
    return {
        timeZone: cfg.timeZone,
        dailyAt: hhmm(cfg.dailyMinute),
        patchWindow: cfg.window
            ? { day: WEEKDAYS[cfg.window.day]!, start: hhmm(cfg.window.startMinute), end: hhmm(cfg.window.endMinute) }
            : null,
        patchEveryMinutes: cfg.windowEveryMinutes,
    };
}

const parseTime = (value: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
    return Number(m[1]) * 60 + Number(m[2]);
};

/**
 * Reads the environment variables UPDATE_CHECK (on|off), UPDATE_CHECK_TZ, UPDATE_CHECK_DAILY_AT,
 * UPDATE_CHECK_PATCH_WINDOW ("Tue 17:00-19:00" or "off") and UPDATE_CHECK_PATCH_EVERY_MINUTES.
 * Returns null if the check is off. Invalid values: warning via warn, check off.
 */
export function parseCheckSchedule(
    env: Record<string, string | undefined>,
    warn: (message: string) => void = console.warn,
): CheckScheduleConfig | null {
    const get = (name: string, fallback: string) => (env[name]?.trim() ? env[name]!.trim() : fallback);
    const mode = get('UPDATE_CHECK', 'off').toLowerCase();
    if (mode === 'off') return null;
    const invalid = (name: string, hint: string): null => {
        warn(`${name}="${env[name]}" is invalid (${hint}): automatic check off`);
        return null;
    };
    if (mode !== 'on') return invalid('UPDATE_CHECK', 'expected on or off');

    const timeZone = get('UPDATE_CHECK_TZ', 'Europe/Berlin');
    try {
        new Intl.DateTimeFormat('en-US', { timeZone });
    } catch {
        return invalid('UPDATE_CHECK_TZ', 'unbekannte Zeitzone');
    }

    const dailyMinute = parseTime(get('UPDATE_CHECK_DAILY_AT', '06:00'));
    if (dailyMinute === null) return invalid('UPDATE_CHECK_DAILY_AT', 'HH:MM erwartet');

    const everyText = get('UPDATE_CHECK_PATCH_EVERY_MINUTES', '30');
    const windowEveryMinutes = Number(everyText);
    if (!Number.isInteger(windowEveryMinutes) || windowEveryMinutes < 1)
        return invalid('UPDATE_CHECK_PATCH_EVERY_MINUTES', 'ganze Zahl >= 1 erwartet');

    const windowText = get('UPDATE_CHECK_PATCH_WINDOW', 'Tue 17:00-19:00');
    let window: PatchWindow | null = null;
    if (windowText.toLowerCase() !== 'off') {
        const m = /^([A-Za-z]{3})\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(windowText);
        const day = m ? WEEKDAYS.findIndex((d) => d.toLowerCase() === m[1]!.toLowerCase()) : -1;
        const start = m ? parseTime(m[2]!) : null;
        const end = m ? parseTime(m[3]!) : null;
        if (day < 0 || start === null || end === null || end <= start) {
            return invalid('UPDATE_CHECK_PATCH_WINDOW', 'e.g. "Tue 17:00-19:00" or "off"');
        }
        window = { day, startMinute: start, endMinute: end };
    }
    return { timeZone, dailyMinute, window, windowEveryMinutes };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Offset of the time zone from UTC (ms) at time utcMs: local time minus UTC. */
function offsetMs(utcMs: number, timeZone: string): number {
    let fmt = formatters.get(timeZone);
    if (!fmt) {
        fmt = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
        });
        formatters.set(timeZone, fmt);
    }
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(new Date(utcMs)))
        if (part.type !== 'literal') p[part.type] = Number(part.value);
    const local = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
    return local - Math.floor(utcMs / 1000) * 1000;
}

/** Local time (as date + minutes since midnight) -> UTC time. Non-existent times (spring-forward gap) shift later. */
function zonedToUtc(year: number, month: number, day: number, minute: number, timeZone: string): number {
    const asUtc = Date.UTC(year, month, day, 0, minute);
    let result = asUtc - offsetMs(asUtc, timeZone);
    result = asUtc - offsetMs(result, timeZone); // second pass in case the DST switch fell in between
    return result;
}

/** Next check time after `now` (strictly later) according to the schedule. */
export function nextCheckAt(now: Date, cfg: CheckScheduleConfig): Date {
    const nowMs = now.getTime();
    const local = new Date(nowMs + offsetMs(nowMs, cfg.timeZone)); // UTC fields = local time
    let best = Infinity;
    // Today plus 8 days is enough: the daily check is due tomorrow at the latest, the window within 7 days.
    for (let offset = 0; offset <= 8; offset++) {
        const date = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + offset));
        const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()];
        const minutes = [cfg.dailyMinute];
        if (cfg.window && date.getUTCDay() === cfg.window.day) {
            for (let t = cfg.window.startMinute; t <= cfg.window.endMinute; t += cfg.windowEveryMinutes)
                minutes.push(t);
        }
        for (const minute of minutes) {
            const at = zonedToUtc(y, m, d, minute, cfg.timeZone);
            if (at > nowMs && at < best) best = at;
        }
        if (Number.isFinite(best)) break; // later days cannot be earlier
    }
    return new Date(best);
}
