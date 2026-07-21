import type { HarnessAdapter } from "./types.js";

export type HarnessAdapterResolver = (id: string) => HarnessAdapter | null;

export class HarnessAdapterRegistry {
  private readonly adapters = new Map<string, HarnessAdapter>();

  constructor(private readonly resolver?: HarnessAdapterResolver) {}

  register(adapter: HarnessAdapter): void {
    const id = adapter.id.trim();
    if (!id) {
      throw new Error("Harness adapter id cannot be empty");
    }
    if (this.adapters.has(id)) {
      throw new Error(`Harness adapter ${id} is already registered`);
    }
    this.adapters.set(id, adapter);
  }

  get(id: string): HarnessAdapter {
    const registered = this.adapters.get(id);
    if (registered) {
      return registered;
    }
    const adapter = this.resolver?.(id) ?? null;
    if (!adapter) {
      throw new Error(`Harness adapter ${id} is not registered`);
    }
    if (adapter.id !== id) {
      throw new Error(`Harness adapter resolver returned ${adapter.id} for ${id}`);
    }
    this.adapters.set(id, adapter);
    return adapter;
  }

  list(): readonly HarnessAdapter[] {
    return [...this.adapters.values()];
  }
}
