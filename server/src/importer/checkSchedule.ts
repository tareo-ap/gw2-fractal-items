import type { AutoCheckSchedule } from '../../../shared/types.js';

// Zeitplan der automatischen Build-Prüfung: täglich zu einer festen Uhrzeit, dazu in einem
// wöchentlichen Patch-Fenster (GW2-Patches kommen meist dienstags abends) in kürzerem Abstand.
// Alle Zeiten gelten in einer IANA-Zeitzone; die Umrechnung läuft über Intl (keine Abhängigkeit).

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;


export interface PatchWindow {
  day: number; // 0 = Sonntag … 6 = Samstag
  startMinute: number; // Minuten seit Mitternacht
  endMinute: number;
}

export interface CheckScheduleConfig {
  timeZone: string;
  dailyMinute: number; // Minuten seit Mitternacht
  window: PatchWindow | null;
  windowEveryMinutes: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (minute: number) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

/** Lesbare Form des Zeitplans für API und UI. */
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
 * Liest die Umgebungsvariablen UPDATE_CHECK (on|off), UPDATE_CHECK_TZ, UPDATE_CHECK_DAILY_AT,
 * UPDATE_CHECK_PATCH_WINDOW ("Tue 17:00-19:00" oder "off") und UPDATE_CHECK_PATCH_EVERY_MINUTES.
 * Gibt null zurück, wenn die Prüfung aus ist. Ungültige Werte: Warnung über warn, Prüfung aus.
 */
export function parseCheckSchedule(env: Record<string, string | undefined>, warn: (message: string) => void = console.warn): CheckScheduleConfig | null {
  const get = (name: string, fallback: string) => (env[name]?.trim() ? env[name]!.trim() : fallback);
  const mode = get('UPDATE_CHECK', 'off').toLowerCase();
  if (mode === 'off') return null;
  const invalid = (name: string, hint: string): null => {
    warn(`${name}="${env[name]}" ist ungültig (${hint}): automatische Prüfung aus`);
    return null;
  };
  if (mode !== 'on') return invalid('UPDATE_CHECK', 'on oder off erwartet');

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
  if (!Number.isInteger(windowEveryMinutes) || windowEveryMinutes < 1) return invalid('UPDATE_CHECK_PATCH_EVERY_MINUTES', 'ganze Zahl >= 1 erwartet');

  const windowText = get('UPDATE_CHECK_PATCH_WINDOW', 'Tue 17:00-19:00');
  let window: PatchWindow | null = null;
  if (windowText.toLowerCase() !== 'off') {
    const m = /^([A-Za-z]{3})\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(windowText);
    const day = m ? WEEKDAYS.findIndex((d) => d.toLowerCase() === m[1]!.toLowerCase()) : -1;
    const start = m ? parseTime(m[2]!) : null;
    const end = m ? parseTime(m[3]!) : null;
    if (day < 0 || start === null || end === null || end <= start) {
      return invalid('UPDATE_CHECK_PATCH_WINDOW', 'z. B. "Tue 17:00-19:00" oder "off"');
    }
    window = { day, startMinute: start, endMinute: end };
  }
  return { timeZone, dailyMinute, window, windowEveryMinutes };
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Abweichung der Zeitzone von UTC (ms) zum Zeitpunkt utcMs: Ortszeit minus UTC. */
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
  for (const part of fmt.formatToParts(new Date(utcMs))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  const local = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return local - Math.floor(utcMs / 1000) * 1000;
}

/** Ortszeit (als Datum + Minuten seit Mitternacht) → UTC-Zeitpunkt. Nicht existierende Zeiten (Sprung nach vorn) rutschen nach hinten. */
function zonedToUtc(year: number, month: number, day: number, minute: number, timeZone: string): number {
  const asUtc = Date.UTC(year, month, day, 0, minute);
  let result = asUtc - offsetMs(asUtc, timeZone);
  result = asUtc - offsetMs(result, timeZone); // zweiter Durchgang, falls die Umstellung dazwischen lag
  return result;
}

/** Nächster Prüfzeitpunkt nach `now` (strikt später) gemäß Zeitplan. */
export function nextCheckAt(now: Date, cfg: CheckScheduleConfig): Date {
  const nowMs = now.getTime();
  const local = new Date(nowMs + offsetMs(nowMs, cfg.timeZone)); // UTC-Felder = Ortszeit
  let best = Infinity;
  // Heute plus 8 Tage genügen: Tagesprüfung ist spätestens morgen dran, das Fenster spätestens in 7 Tagen.
  for (let offset = 0; offset <= 8; offset++) {
    const date = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + offset));
    const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()];
    const minutes = [cfg.dailyMinute];
    if (cfg.window && date.getUTCDay() === cfg.window.day) {
      for (let t = cfg.window.startMinute; t <= cfg.window.endMinute; t += cfg.windowEveryMinutes) minutes.push(t);
    }
    for (const minute of minutes) {
      const at = zonedToUtc(y, m, d, minute, cfg.timeZone);
      if (at > nowMs && at < best) best = at;
    }
    if (Number.isFinite(best)) break; // spätere Tage können nicht früher sein
  }
  return new Date(best);
}

