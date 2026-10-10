import type { DatabaseSync } from 'node:sqlite';
import type { AutoCheckResult, AutoCheckStatus } from '../../../shared/types.js';
import type { Gw2Client } from '../gw2/client.js';
import { describeSchedule, nextCheckAt, type CheckScheduleConfig } from './checkSchedule.js';
import { ImportAlreadyRunningError, type Importer } from './importer.js';

/**
 * Prüft regelmäßig die Game-Build-ID und startet einen Import, wenn sie sich seit dem letzten
 * abgeschlossenen Update geändert hat. Ohne abgeschlossenes Update passiert nichts: Der erste Vollimport bleibt manuell.
 * Prüfzeitpunkte kommen aus dem Zeitplan (nextCheckAt), direkt nach dem Start wird nicht geprüft.
 * Die Prüfungen laufen als setTimeout-Kette, damit sie sich nie überlappen. Fehler werden geloggt, nie geworfen.
 */
export class BuildWatcher {
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private lastCheckAt: string | null = null;
  private lastSeenBuild: number | null = null;
  private lastResult: AutoCheckResult | null = null;
  private nextCheckAt: string | null = null;

  constructor(
    private readonly db: DatabaseSync,
    private readonly client: Gw2Client,
    private readonly importer: Importer,
    private readonly schedule: CheckScheduleConfig,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.scheduleNext(new Date());
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextCheckAt = null;
  }

  getStatus(): AutoCheckStatus {
    return {
      enabled: !this.stopped,
      schedule: describeSchedule(this.schedule),
      lastCheckAt: this.lastCheckAt,
      lastSeenBuild: this.lastSeenBuild,
      lastResult: this.lastResult,
      nextCheckAt: this.nextCheckAt,
    };
  }

  /** Eine Prüfung sofort ausführen (auch für Tests). Wirft nie. */
  async checkNow(): Promise<AutoCheckResult> {
    let result: AutoCheckResult;
    try {
      result = await this.check();
    } catch (err) {
      console.error('Automatische Update-Prüfung fehlgeschlagen:', err);
      result = 'error';
    }
    this.lastCheckAt = new Date().toISOString();
    this.lastResult = result;
    return result;
  }

  private async check(): Promise<AutoCheckResult> {
    const build = await this.client.getBuildId();
    if (build === null) {
      console.error('Automatische Update-Prüfung: Build-ID konnte nicht gelesen werden');
      return 'error';
    }
    this.lastSeenBuild = build;

    const baseline = this.db
      .prepare(`SELECT build_id FROM updates WHERE status = 'done' AND build_id IS NOT NULL ORDER BY id DESC LIMIT 1`)
      .get() as { build_id: number } | undefined;
    if (!baseline) return 'noBaseline';
    if (baseline.build_id === build) return 'unchanged';

    if (this.importer.getStatus().running) return 'running';
    try {
      this.importer.start();
    } catch (err) {
      if (err instanceof ImportAlreadyRunningError) return 'running';
      throw err;
    }
    console.log(`Neue Game-Build ${build} (zuletzt ${baseline.build_id}): Update gestartet`);
    return 'started';
  }

  private scheduleNext(after: Date): void {
    const at = nextCheckAt(after, this.schedule);
    this.nextCheckAt = at.toISOString();
    this.timer = setTimeout(() => {
      // Timer können minimal zu früh feuern: ab dem geplanten Zeitpunkt weiterplanen, sonst gäbe es einen Doppel-Check.
      void this.checkNow().finally(() => {
        if (!this.stopped) this.scheduleNext(new Date(Math.max(Date.now(), at.getTime())));
      });
    }, Math.max(0, at.getTime() - Date.now()));
    this.timer.unref(); // hält den Prozess nicht am Leben
  }
}
