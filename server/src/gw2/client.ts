// Kleiner Client für die öffentliche GW2-API v2 (ohne API-Key).

/** Ein Item, wie es /v2/items?ids=… liefert. Nur die Felder, die wir direkt nutzen, sind typisiert. */
export interface Gw2Item {
  id: number;
  name: string;
  description?: string;
  type: string;
  rarity: string;
  level: number;
  icon?: string;
  chat_link?: string;
  game_types?: string[];
  flags?: string[];
  restrictions?: string[];
  vendor_value?: number;
  details?: Record<string, unknown>;
  [field: string]: unknown;
}

export interface Gw2ClientOptions {
  baseUrl: string;
  /** Mindestabstand zwischen zwei Requests. 200 ms = höchstens 5 pro Sekunde (API erlaubt ca. 300/min). */
  minIntervalMs?: number;
  /** Wartezeit vor dem ersten Retry, verdoppelt sich mit jedem weiteren Versuch. */
  retryBaseDelayMs?: number;
  maxAttempts?: number;
}

/** Fehler mit HTTP-Status, damit der Aufrufer zwischen "Retry sinnvoll" und "endgültig" unterscheiden kann. */
export class Gw2ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'Gw2ApiError';
  }
}

export const IDS_PER_REQUEST = 200;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class Gw2Client {
  private readonly baseUrl: string;
  private readonly minIntervalMs: number;
  private readonly retryBaseDelayMs: number;
  private readonly maxAttempts: number;
  private nextSlot = 0; // frühester Zeitpunkt (ms) für den nächsten Request

  constructor(options: Gw2ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.minIntervalMs = options.minIntervalMs ?? 200;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1000;
    this.maxAttempts = options.maxAttempts ?? 5;
  }

  /** Alle Item-IDs. */
  async getItemIds(): Promise<number[]> {
    const data = await this.getJson('/v2/items');
    if (!Array.isArray(data) || !data.every((id) => Number.isInteger(id))) {
      throw new Gw2ApiError('Unerwartete Antwort von /v2/items', null);
    }
    return data as number[];
  }

  /**
   * Details zu bis zu 200 IDs. Unbekannte IDs fehlen einfach in der Antwort
   * (HTTP 206 Partial Content); sind alle unbekannt, antwortet die API mit 404.
   */
  async getItems(ids: number[]): Promise<Gw2Item[]> {
    if (ids.length === 0) return [];
    if (ids.length > IDS_PER_REQUEST) throw new Error(`Höchstens ${IDS_PER_REQUEST} IDs pro Request`);
    const data = await this.getJson(`/v2/items?ids=${ids.join(',')}&lang=en`, { notFoundAsEmpty: true });
    if (!Array.isArray(data)) throw new Gw2ApiError('Unerwartete Antwort von /v2/items?ids=', null);
    return data.filter(
      (item): item is Gw2Item => typeof item === 'object' && item !== null && Number.isInteger(item.id),
    );
  }

  /** Aktuelle Build-ID oder null, wenn die API keine plausible Antwort liefert. */
  async getBuildId(): Promise<number | null> {
    try {
      const data = (await this.getJson('/v2/build')) as { id?: unknown } | null;
      const id = data?.id;
      return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
    } catch {
      return null;
    }
  }

  // GET mit Drosselung und Retry. Wiederholt wird bei Netzwerkfehlern, 429 und 5xx.
  private async getJson(path: string, opts: { notFoundAsEmpty?: boolean } = {}): Promise<unknown> {
    const url = this.baseUrl + path;
    for (let attempt = 1; ; attempt++) {
      await this.throttle();
      let retryAfterMs: number | null = null;
      let error: Gw2ApiError;
      let res: Response | null = null;
      try {
        res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (res.ok) return await res.json(); // 200 und 206
      } catch {
        res = null; // Netzwerkfehler oder abgebrochene/kaputte Antwort → wie Netzwerkfehler behandeln
      }
      if (res) {
        if (res.status === 404 && opts.notFoundAsEmpty) return [];
        await res.body?.cancel();
        error = new Gw2ApiError(`GW2-API ${res.status} für ${path}`, res.status);
        if (res.status !== 429 && res.status < 500) throw error; // 4xx: Wiederholen bringt nichts
        retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
      } else {
        error = new Gw2ApiError(`Netzwerkfehler für ${path}`, null);
      }
      if (attempt >= this.maxAttempts) throw error;
      // Exponentielles Backoff: 1 s, 2 s, 4 s, 8 s (bzw. Retry-After, falls größer).
      const backoff = this.retryBaseDelayMs * 2 ** (attempt - 1);
      await sleep(Math.max(backoff, retryAfterMs ?? 0));
    }
  }

  // Einfache Drosselung: Jeder Request bekommt einen Zeitslot im Abstand von minIntervalMs.
  private async throttle(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.minIntervalMs;
    if (slot > now) await sleep(slot - now);
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  // Obergrenze, damit ein seltsamer Header den Import nicht ewig blockiert.
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 60_000) : null;
}
