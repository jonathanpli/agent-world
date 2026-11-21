import { CONFIG } from "../shared/config";

export const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "Notification", "Stop", "PostModelSwitch", "SessionEnd",
  "SubagentStart", "SubagentStop", "PostToolUseFailure", "PreCompact", "PostCompact"] as const;

type Settings = Record<string, unknown>;
type Group = { hooks?: unknown };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads settings.hooks as an object, or throws if it is some other shape (we never overwrite shapes we do not own). */
function hooksOf(settings: Settings): Record<string, unknown> {
  const h = settings.hooks;
  if (h === undefined) return {};
  if (!isObject(h)) throw new Error("settings.hooks exists but is not an object");
  return h;
}

function groupsOf(hooks: Record<string, unknown>, event: string): unknown[] | undefined {
  const g = hooks[event];
  if (g === undefined) return undefined;
  if (!Array.isArray(g)) throw new Error(`settings.hooks.${event} exists but is not an array`);
  return g;
}

const commandsOf = (g: unknown): string[] =>
  isObject(g) && Array.isArray((g as Group).hooks)
    ? ((g as Group).hooks as unknown[]).flatMap(h => (isObject(h) && typeof h.command === "string" ? [h.command] : []))
    : [];

export function mergeHooks(settings: Settings, scriptPath: string): Settings {
  const out = structuredClone(settings);
  const hooks = hooksOf(out);
  for (const event of HOOK_EVENTS) {
    const groups = groupsOf(hooks, event) ?? [];
    if (!groups.some(g => commandsOf(g).includes(scriptPath))) {
      groups.push({ hooks: [{ type: "command", command: scriptPath, timeout: CONFIG.hookTimeoutSeconds }] });
    }
    hooks[event] = groups;
  }
  out.hooks = hooks;
  return out;
}

/** Quotes a path for use as a shell command string; plain paths pass through unchanged. */
export function shellQuote(path: string): string {
  return /^[A-Za-z0-9_./@:+-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
}

export function removeHooks(settings: Settings, scriptPath: string): Settings {
  const out = structuredClone(settings);
  if (out.hooks === undefined) return out;
  const hooks = hooksOf(out);
  let removedAny = false;
  for (const event of HOOK_EVENTS) {
    const groups = groupsOf(hooks, event);
    if (!groups) continue;
    let removed = false;
    const kept = groups.flatMap(g => {
      if (!commandsOf(g).includes(scriptPath)) return [g];
      removed = true;
      const rest = ((g as Group).hooks as unknown[]).filter(h => !(isObject(h) && h.command === scriptPath));
      return rest.length > 0 ? [{ ...(g as object), hooks: rest }] : [];
    });
    if (!removed) continue;
    removedAny = true;
    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
  if (removedAny && Object.keys(hooks).length === 0) delete out.hooks;
  return out;
}
