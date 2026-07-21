export interface ProviderWorkspacePort {
  resolveRepoRoot(cwd: string, options?: unknown): Promise<string>;
}

export interface ManagedProviderProcessInput {
  owner: { provider: string; kind: string };
  pid: number;
  command: string;
  args: string[];
  metadata?: Record<string, unknown>;
}

export interface ManagedProviderProcessPort {
  record(input: ManagedProviderProcessInput): Promise<{ id: string }>;
  remove(id: string): Promise<void>;
}
