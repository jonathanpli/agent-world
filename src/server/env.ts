import { join } from "node:path";
import { CONFIG } from "../shared/config";

export type ServerEnv = { port: number; home: string; warnings: string[] };

const MAX_PORT = 65_535;

/** Pure: reads AGENT_WORLD_PORT and AGENT_WORLD_HOME, falling back to defaults (with a warning for a bad port). */
export function serverEnv(env: Record<string, string | undefined>, demo: boolean, homeDir: string): ServerEnv {
  const warnings: string[] = [];
  const fallbackPort: number = demo ? CONFIG.demoPort : CONFIG.port;
  let port = fallbackPort;
  const rawPort = env.AGENT_WORLD_PORT;
  if (rawPort !== undefined) {
    const n = /^\d+$/.test(rawPort.trim()) ? Number(rawPort.trim()) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= MAX_PORT) port = n;
    else warnings.push(`Ignoring AGENT_WORLD_PORT="${rawPort}" (not a port from 1 to ${MAX_PORT}); using ${fallbackPort}`);
  }
  const rawHome = env.AGENT_WORLD_HOME;
  const home = rawHome !== undefined && rawHome.trim() !== "" ? rawHome : join(homeDir, ".agent-world");
  return { port, home, warnings };
}
