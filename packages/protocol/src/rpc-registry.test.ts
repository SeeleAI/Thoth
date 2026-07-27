import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  RPC_PROTOCOL_VERSION,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  rpcRegistry,
} from "./messages.js";

describe("rpcRegistry", () => {
  it("is the complete source for every JSON session message", () => {
    const entries = Object.values(rpcRegistry.entries);
    const operations = entries.filter(
      (entry) => entry.kind === "unary" || entry.kind === "subscription",
    );
    const reverseOperations = entries.filter((entry) => entry.kind === "reverseUnary");

    expect(operations).toHaveLength(137);
    expect(reverseOperations).toHaveLength(1);
    expect(SessionInboundMessageSchema.options).toHaveLength(138);
    expect(SessionOutboundMessageSchema.options).toHaveLength(146);
    expect(new Set(operations.map((entry) => entry.requestType)).size).toBe(137);
    expect(new Set(SessionOutboundMessageSchema.options.map(messageType)).size).toBe(146);

    expect(new Set(SessionInboundMessageSchema.options.map(messageType))).toEqual(
      new Set(rpcRegistry.inputSchemas.map(messageType)),
    );
    expect(new Set(SessionOutboundMessageSchema.options.map(messageType))).toEqual(
      new Set(rpcRegistry.outputSchemas.map(messageType)),
    );
  });

  it("binds every request to one typed handler and common error/version contract", () => {
    for (const [operation, entry] of Object.entries(rpcRegistry.entries)) {
      expect(entry.operation).toBe(operation);
      expect(entry.version).toBe(RPC_PROTOCOL_VERSION);
      expect(entry.permission).toBe("session");
      expect(entry.error).toBe(rpcRegistry.error);

      if (entry.kind === "serverEvent") {
        expect(entry.handlerKey).toBeNull();
        expect(entry.requestType).toBeNull();
        continue;
      }

      if (entry.kind === "reverseUnary") {
        expect(entry.handlerKey).toBeNull();
        expect(entry.requestType).toBe(messageType(entry.input));
        expect(entry.responseType).toBe(messageType(entry.output));
        continue;
      }

      expect(entry.handlerKey).toBe(operation);
      expect(rpcRegistry.operationForRequestType(entry.requestType)).toBe(entry);
      expect(entry.requestType).toBe(messageType(entry.input));
      expect(entry.responseType).toBe(entry.output ? messageType(entry.output) : null);
    }
  });

  it("keeps binary file and terminal frames outside JSON RPC", () => {
    const types = new Set([
      ...rpcRegistry.inputSchemas.map(messageType),
      ...rpcRegistry.outputSchemas.map(messageType),
    ]);
    for (const binaryOnlyType of ["file_begin", "file_chunk", "file_end", "terminal_frame"]) {
      expect(types.has(binaryOnlyType)).toBe(false);
    }
  });
});

function messageType(schema: z.ZodType): string {
  expect(schema).toBeInstanceOf(z.ZodObject);
  const literal = (schema as z.ZodObject).shape.type;
  expect(literal).toBeInstanceOf(z.ZodLiteral);
  const [value] = (literal as z.ZodLiteral).values;
  expect(typeof value).toBe("string");
  return value as string;
}
