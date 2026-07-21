export function createStub<T extends object>(stubs: { [K in keyof T]?: unknown }): T {
  return new Proxy(stubs as Record<string | symbol, unknown>, {
    get(target, prop, receiver) {
      if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver);
      if (typeof prop === "symbol") return undefined;
      return (..._args: unknown[]): never => {
        throw new Error(`createStub: "${String(prop)}" was called but not stubbed`);
      };
    },
  }) as unknown as T;
}

export function asInternals<T>(obj: unknown): T {
  return obj as T;
}
