// Small client for the public GW2 API v2 (no API key).

/** An item as returned by /v2/items?ids=…. Only the fields we use directly are typed. */
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
    /** Minimum gap between two requests. 200 ms = at most 5 per second (the API allows about 300/min). */
    minIntervalMs?: number;
    /** Wait before the first retry, doubles with each further attempt. */
    retryBaseDelayMs?: number;
    maxAttempts?: number;
}

/** Error with an HTTP status so the caller can distinguish "retry makes sense" from "final". */
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
    private nextSlot = 0; // earliest time (ms) for the next request

    constructor(options: Gw2ClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.minIntervalMs = options.minIntervalMs ?? 200;
        this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1000;
        this.maxAttempts = options.maxAttempts ?? 5;
    }

    /** All item IDs. */
    async getItemIds(): Promise<number[]> {
        const data = await this.getJson('/v2/items');
        if (!Array.isArray(data) || !data.every((id) => Number.isInteger(id))) {
            throw new Gw2ApiError('Unexpected response from /v2/items', null);
        }
        return data as number[];
    }

    /**
     * Details for up to 200 IDs. Unknown IDs are simply missing from the response
     * (HTTP 206 Partial Content); if all are unknown, the API responds with 404.
     */
    async getItems(ids: number[], lang: 'en' | 'de' = 'en'): Promise<Gw2Item[]> {
        if (ids.length === 0) return [];
        if (ids.length > IDS_PER_REQUEST) throw new Error(`At most ${IDS_PER_REQUEST} IDs per request`);
        const data = await this.getJson(`/v2/items?ids=${ids.join(',')}&lang=${lang}`, { notFoundAsEmpty: true });
        if (!Array.isArray(data)) throw new Gw2ApiError('Unexpected response from /v2/items?ids=', null);
        return data.filter(
            (item): item is Gw2Item => typeof item === 'object' && item !== null && Number.isInteger(item.id),
        );
    }

    /** Current build ID, or null if the API returns no plausible response. */
    async getBuildId(): Promise<number | null> {
        try {
            const data = (await this.getJson('/v2/build')) as { id?: unknown } | null;
            const id = data?.id;
            return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
        } catch {
            return null;
        }
    }

    // GET with throttling and retry. Retries on network errors, 429 and 5xx.
    private async getJson(path: string, opts: { notFoundAsEmpty?: boolean } = {}): Promise<unknown> {
        const url = this.baseUrl + path;
        for (let attempt = 1; ; attempt++) {
            await this.throttle();
            let retryAfterMs: number | null = null;
            let error: Gw2ApiError;
            let res: Response | null = null;
            try {
                res = await fetch(url, { headers: { Accept: 'application/json' } });
                if (res.ok) return await res.json(); // 200 and 206
            } catch {
                res = null; // Network error or aborted/broken response -> treat like a network error
            }
            if (res) {
                if (res.status === 404 && opts.notFoundAsEmpty) return [];
                await res.body?.cancel();
                error = new Gw2ApiError(`GW2 API ${res.status} for ${path}`, res.status);
                if (res.status !== 429 && res.status < 500) throw error; // 4xx: retrying is pointless
                retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
            } else {
                error = new Gw2ApiError(`Network error for ${path}`, null);
            }
            if (attempt >= this.maxAttempts) throw error;
            // Exponential backoff: 1 s, 2 s, 4 s, 8 s (or Retry-After, if larger).
            const backoff = this.retryBaseDelayMs * 2 ** (attempt - 1);
            await sleep(Math.max(backoff, retryAfterMs ?? 0));
        }
    }

    // Simple throttling: each request gets a time slot minIntervalMs apart.
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
    // Upper limit so a strange header cannot block the import forever.
    return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 60_000) : null;
}
