import type { AutoCheckSchedule } from '../../../shared/types.js';

// Schedule of the automatic build check: daily at a fixed time, plus at shorter intervals in a
// weekly patch window (GW2 patches usually arrive on Tuesday evenings).
// All times are in an IANA time zone; conversion uses Intl (no dependency).

// Index = Date.getUTCDay() value (0 = Sunday).
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

// Weekly time window with more frequent checks (the usual patch time).
export interface PatchWindow {
    day: number; // 0 = Sunday … 6 = Saturday
    startMinute: number; // minutes since midnight
    endMinute: number;
}

// Parsed schedule settings (see parseCheckSchedule).
export interface CheckScheduleConfig {
    timeZone: string;
    dailyMinute: number; // minutes since midnight
    window: PatchWindow | null;
    windowEveryMinutes: number; // check interval inside the patch window
}

// Formats minutes since midnight as "HH:MM".
const pad = (value: number) => String(value).padStart(2, '0');
const hhmm = (minute: number) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

/** Readable form of the schedule for API and UI. */
export function describeSchedule(config: CheckScheduleConfig): AutoCheckSchedule {
    return {
        timeZone: config.timeZone,
        dailyAt: hhmm(config.dailyMinute),
        patchWindow: config.window
            ? {
                  day: WEEKDAYS[config.window.day]!,
                  start: hhmm(config.window.startMinute),
                  end: hhmm(config.window.endMinute),
              }
            : null,
        patchEveryMinutes: config.windowEveryMinutes,
    };
}

// "HH:MM" -> minutes since midnight, or null if invalid.
const parseTime = (value: string): number | null => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
    return Number(match[1]) * 60 + Number(match[2]);
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
    // Environment variable with fallback; empty/whitespace-only counts as unset.
    const get = (name: string, fallback: string) => (env[name]?.trim() ? env[name]!.trim() : fallback);
    const mode = get('UPDATE_CHECK', 'off').toLowerCase();
    if (mode === 'off') return null;
    // Warns and returns null (= check off), so callers can `return invalid(...)`.
    const invalid = (name: string, hint: string): null => {
        warn(`${name}="${env[name]}" is invalid (${hint}): automatic check off`);
        return null;
    };
    if (mode !== 'on') return invalid('UPDATE_CHECK', 'expected on or off');

    const timeZone = get('UPDATE_CHECK_TZ', 'Europe/Berlin');
    try {
        new Intl.DateTimeFormat('en-US', { timeZone }); // throws RangeError for an unknown time zone
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
        const match = /^([A-Za-z]{3})\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(windowText);
        const day = match ? WEEKDAYS.findIndex((weekday) => weekday.toLowerCase() === match[1]!.toLowerCase()) : -1;
        const start = match ? parseTime(match[2]!) : null;
        const end = match ? parseTime(match[3]!) : null;
        if (day < 0 || start === null || end === null || end <= start) {
            return invalid('UPDATE_CHECK_PATCH_WINDOW', 'e.g. "Tue 17:00-19:00" or "off"');
        }
        window = { day, startMinute: start, endMinute: end };
    }
    return { timeZone, dailyMinute, window, windowEveryMinutes };
}

// Intl.DateTimeFormat is expensive to create: one cached instance per time zone.
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Offset of the time zone from UTC (ms) at time utcMs: local time minus UTC. */
function offsetMs(utcMs: number, timeZone: string): number {
    let formatter = formatters.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
        });
        formatters.set(timeZone, formatter);
    }
    // Split the formatted local time into its parts (year, month, ...), skipping separators like "/" and ":".
    const parts: Record<string, number> = {};
    for (const part of formatter.formatToParts(new Date(utcMs)))
        if (part.type !== 'literal') parts[part.type] = Number(part.value);
    const local = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
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
export function nextCheckAt(now: Date, config: CheckScheduleConfig): Date {
    const nowMs = now.getTime();
    const local = new Date(nowMs + offsetMs(nowMs, config.timeZone)); // UTC fields = local time
    let earliestMs = Infinity;
    // Today plus 8 days is enough: the daily check is due tomorrow at the latest, the window within 7 days.
    // Look at each local day in turn and collect that day's check times (minutes since midnight).
    for (let offset = 0; offset <= 8; offset++) {
        const date = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + offset));
        const [year, month, day] = [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()];
        const minutes = [config.dailyMinute];
        if (config.window && date.getUTCDay() === config.window.day) {
            for (
                let minute = config.window.startMinute;
                minute <= config.window.endMinute;
                minute += config.windowEveryMinutes
            )
                minutes.push(minute);
        }
        // Keep the earliest candidate time that lies in the future.
        for (const minute of minutes) {
            const checkMs = zonedToUtc(year, month, day, minute, config.timeZone);
            if (checkMs > nowMs && checkMs < earliestMs) earliestMs = checkMs;
        }
        if (Number.isFinite(earliestMs)) break; // later days cannot be earlier
    }
    return new Date(earliestMs);
}
