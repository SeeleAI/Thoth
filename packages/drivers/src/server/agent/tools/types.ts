import type { z } from "zod";

export interface ThothToolExecutionContext {
  signal?: AbortSignal;
  providerToolCall?: {
    provider: string;
    threadId: string;
    turnId: string;
    callId: string;
    toolName: string;
    namespace?: string | null;
    /** Adapter-confirmed membership in its currently active provider turn. */
    isActiveProviderTurn?: boolean;
  };
}

export interface ThothToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface ThothToolConfig {
  title?: string;
  description?: string;
  inputSchema?: z.ZodRawShape | z.ZodType;
  outputSchema?: z.ZodRawShape | z.ZodType;
}

export interface ThothToolDefinition extends ThothToolConfig {
  name: string;
  description: string;
  handler: (input: unknown, context: ThothToolExecutionContext) => Promise<ThothToolResult>;
}

export interface ThothToolCatalog {
  tools: ReadonlyMap<string, ThothToolDefinition>;
  getTool(name: string): ThothToolDefinition | undefined;
  executeTool(
    name: string,
    input: unknown,
    context?: ThothToolExecutionContext,
  ): Promise<ThothToolResult>;
}

export interface ThothToolRuntimeCallerConfig {
  /** Provider-neutral runtime metadata. Provider-private keys remain nested. */
  extra?: Record<string, unknown>;
}

export interface ThothToolRuntimeContext {
  callerAgentId?: string;
  callerAgentConfig?: ThothToolRuntimeCallerConfig;
  enableVoiceTools?: boolean;
  voiceOnly?: boolean;
}

export type ThothToolCatalogFactory = (
  context: ThothToolRuntimeContext,
) => ThothToolCatalog | Promise<ThothToolCatalog>;
