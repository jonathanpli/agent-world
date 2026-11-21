import type { Ctx } from "../../src/client/engine/theme";

/** A stand-in 2D context: any method call is a no-op that returns the proxy, any property can be set and read back. */
export function mockCtx(): Ctx {
  const props = new Map<PropertyKey, unknown>();
  const proxy: unknown = new Proxy(function noop() {}, {
    get(_t, key) {
      if (props.has(key)) return props.get(key);
      if (key === Symbol.toPrimitive) return () => 0;
      if (key === "then") return undefined;            // not a thenable
      return proxy;
    },
    set(_t, key, value) { props.set(key, value); return true; },
    apply() { return proxy; },
  });
  return proxy as Ctx;
}
