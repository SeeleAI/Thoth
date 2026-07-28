import type { Logger } from "pino";
import type { ProviderUsage } from "@thoth/protocol/messages";

export type ProviderApiFetch = typeof fetch;

export interface ProviderUsageReader {
  readonly providerId: string;
  readonly displayName: string;
  fetchUsage(): Promise<ProviderUsage>;
}

export interface ProviderUsageReaderFactoryOptions {
  logger: Logger;
  fetch?: ProviderApiFetch;
}

export interface ProviderUsageReaderManifestEntry {
  readonly providerId: string;
  create(options: ProviderUsageReaderFactoryOptions): ProviderUsageReader;
}
