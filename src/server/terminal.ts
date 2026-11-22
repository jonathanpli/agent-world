/**
 * Where a session's terminal is, as the hook reports it in X-AW-* headers. Server-side only: it is never put in a
 * Session, a snapshot or a delta.
 */
export type TerminalInfo = {
  bundleId?: string; termProgram?: string; itermSession?: string; tty?: string;
  tmuxPane?: string; tmuxSocket?: string; cmuxWorkspace?: string; cmuxSurface?: string; cmuxPanel?: string; cmuxSocket?: string;
};

const ID = /^[A-Za-z0-9.:_%-]{1,80}$/;
const SOCKET = /^\/[A-Za-z0-9/._-]{1,199}$/;
const TTY = /^ttys[0-9]{1,4}$/;
const BUNDLE_ID = /^[A-Za-z0-9.-]{1,80}$/;

/** Each field, the header it arrives in (lower case, as Node gives it) and the pattern its value must match. */
const FIELDS: readonly [keyof TerminalInfo, string, RegExp][] = [
  ["bundleId", "x-aw-bundle-id", BUNDLE_ID],
  ["termProgram", "x-aw-term-program", ID],
  ["itermSession", "x-aw-iterm-session", ID],
  ["tty", "x-aw-tty", TTY],
  ["tmuxPane", "x-aw-tmux-pane", ID],
  ["tmuxSocket", "x-aw-tmux-socket", SOCKET],
  ["cmuxWorkspace", "x-aw-cmux-workspace", ID],
  ["cmuxSurface", "x-aw-cmux-surface", ID],
  ["cmuxPanel", "x-aw-cmux-panel", ID],
  ["cmuxSocket", "x-aw-cmux-socket", SOCKET],
];

/** The fields of `read(name, header)` that are strings matching their pattern, or null when none is. */
function collect(read: (field: keyof TerminalInfo, header: string) => unknown): TerminalInfo | null {
  const out: TerminalInfo = {};
  for (const [field, header, pattern] of FIELDS) {
    const v = read(field, header);
    if (typeof v === "string" && pattern.test(v)) out[field] = v;
  }
  return Object.keys(out).length === 0 ? null : out;
}

/** The terminal a hook request reports. Invalid values and repeated headers are dropped one by one; null when nothing is left. */
export function terminalFromHeaders(headers: Record<string, string | string[] | undefined>): TerminalInfo | null {
  return collect((_field, header) => headers[header]);
}

/** A terminal read back from the store, validated as strictly as when it arrived; null when nothing valid is left. */
export function asTerminalInfo(v: unknown): TerminalInfo | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const rec = v as Record<string, unknown>;
  return collect(field => (Object.hasOwn(rec, field) ? rec[field] : undefined));
}

/** True when both describe the same terminal. */
export function sameTerminal(a: TerminalInfo | undefined, b: TerminalInfo): boolean {
  return a !== undefined && FIELDS.every(([field]) => a[field] === b[field]);
}
