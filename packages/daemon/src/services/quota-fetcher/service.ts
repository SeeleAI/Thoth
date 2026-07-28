import type { Logger } from "pino";
import type { ProviderUsage } from "@thoth/protocol/messages";
import {
  createProviderUsageReaders,
  unavailableUsage,
  type ProviderApiFetch,
  type ProviderUsageReader,
} from "@thoth/drivers/provider-usage";

export interface ProviderUsageServiceOptions {
  logger: Logger;
  readers?: ProviderUsageReader[];
  fetch?: ProviderApiFetch;
  cacheTtlMs?: number;
  now?: () => number;
}

export interface ProviderUsageListResult {
  fetchedAt: string;
  providers: ProviderUsage[];
}

const DEFAULT_PROVIDER_USAGE_CACHE_TTL_MS = 5 * 60 * 1000;

export class ProviderUsageService {
  private readonly logger: Logger;
  private readonly readers: ProviderUsageReader[];
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private cached: { fetchedAtMs: number; result: ProviderUsageListResult } | null = null;
  private inFlight: Promise<ProviderUsageListResult> | null = null;
  private readonly lastKnownGood = new Map<string, ProviderUsage>();

  constructor(options: ProviderUsageServiceOptions) {
    this.logger = options.logger.child({ module: "provider-usage-service" });
    this.readers =
      options.readers ??
      createProviderUsageReaders({
        logger: this.logger,
        fetch: options.fetch,
      });
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_PROVIDER_USAGE_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async listUsage(options?: { forceRefresh?: boolean }): Promise<ProviderUsageListResult> {
    const nowMs = this.now();
    if (
      !options?.forceRefresh &&
      this.cached &&
      nowMs - this.cached.fetchedAtMs < this.cacheTtlMs
    ) {
      return this.cached.result;
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    const request = this.fetchFreshUsage(nowMs);
    this.inFlight = request;
    try {
      return await request;
    } finally {
      if (this.inFlight === request) {
        this.inFlight = null;
      }
    }
  }

  private async fetchFreshUsage(nowMs: number): Promise<ProviderUsageListResult> {
    const settled = await Promise.allSettled(this.readers.map((reader) => reader.fetchUsage()));
    const providers = settled.map((result, index) => {
      const reader = this.readers[index]!;
      if (result.status === "fulfilled") {
        if (result.value.status === "available") {
          this.lastKnownGood.set(reader.providerId, structuredClone(result.value));
          return result.value;
        }
        return this.withLastKnownGood(reader.providerId, result.value);
      }
      this.logger.debug(
        { err: result.reason, providerId: reader.providerId },
        "Provider usage fetch failed",
      );
      return this.withLastKnownGood(
        reader.providerId,
        unavailableUsage({
          providerId: reader.providerId,
          displayName: reader.displayName,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        }),
      );
    });

    const result = { fetchedAt: new Date(nowMs).toISOString(), providers };
    this.cached = { fetchedAtMs: nowMs, result };
    return result;
  }

  private withLastKnownGood(providerId: string, failure: ProviderUsage): ProviderUsage {
    const previous = this.lastKnownGood.get(providerId);
    if (!previous) return failure;
    const reason = failure.error ?? "Provider usage is temporarily unavailable";
    return {
      ...structuredClone(previous),
      status: "available",
      sourceLabel: "Last known good",
      warnings: [...(previous.warnings ?? []), `Using last-known-good usage: ${reason}`],
      error: reason,
    };
  }
}
