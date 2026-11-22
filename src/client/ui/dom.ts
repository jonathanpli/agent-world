import type { CharState } from "../../shared/types";
import { api } from "../net";

type Child = Node | string | null | undefined | false;

/** Creates an element. Strings become text nodes, so untrusted text is never parsed as HTML. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, props: { class?: string; title?: string; type?: string; [data: `data-${string}`]: string } = {}, ...children: Child[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) if (v !== undefined) e.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

export const STATE_ICON: Record<CharState, string> = { working: "●", needs_input: "!", done: "✓", idle: "◌", off_duty: "○" };
export const STATE_TEXT: Record<CharState, string> = { working: "working", needs_input: "needs you", done: "done", idle: "idle", off_duty: "off duty" };

/** Turns a failed API promise into a message shown inline; resolves to whether the call succeeded. */
export async function attempt(p: Promise<unknown>, show: (msg: string) => void): Promise<boolean> {
  try {
    await p;
    show("");
    return true;
  } catch (e) {
    show(e instanceof Error ? e.message : String(e));
    return false;
  }
}

/** Brings a session's terminal forward; shows the server's note (if any) or the failure message, and clears it on a plain success. */
export async function jumpTo(key: string, show: (msg: string) => void): Promise<void> {
  try {
    show((await api.focus(key)).note ?? "");
  } catch (e) {
    show(e instanceof Error ? e.message : String(e));
  }
}
