export const SERVICE_LABEL = "com.agent-world.server";

const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const unescapeXml = (s: string): string =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** The launchd agent definition: starts at login, restarts on crash, logs to one file. Every string is XML-escaped. */
export function buildPlist(o: { nodePath: string; tsxCli: string; repoDir: string; logPath: string; env: Record<string, string> }): string {
  const s = (v: string): string => `<string>${escapeXml(v)}</string>`;
  const envKeys = Object.keys(o.env);
  const env = envKeys.length === 0
    ? ""
    : `  <key>EnvironmentVariables</key>\n  <dict>\n${envKeys.map(k => `    <key>${escapeXml(k)}</key>\n    ${s(o.env[k]!)}\n`).join("")}  </dict>\n`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${s(SERVICE_LABEL)}
  <key>ProgramArguments</key>
  <array>
    ${s(o.nodePath)}
    ${s(o.tsxCli)}
    ${s("src/server/main.ts")}
  </array>
  <key>WorkingDirectory</key>
  ${s(o.repoDir)}
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  ${s(o.logPath)}
  <key>StandardErrorPath</key>
  ${s(o.logPath)}
${env}</dict>
</plist>
`;
}

/** Reads `launchctl print gui/<uid>/<label>` output: a running service has `state = running` and a `pid = N` line. */
export function parsePrint(output: string): { running: boolean; pid: number | null } {
  const state = /^\s*state = (\S+)/m.exec(output)?.[1];
  const pid = /^\s*pid = (\d+)\s*$/m.exec(output)?.[1];
  const running = state === "running";
  return { running, pid: running && pid !== undefined ? Number(pid) : null };
}

/** What `status` shows about an installed plist: the node it runs, the port it was given and its PATH (null when not set). */
export function readPlistInfo(plist: string): { nodePath: string | null; port: string | null; path: string | null } {
  const args = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1];
  const port = /<key>AGENT_WORLD_PORT<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1];
  const path = /<key>PATH<\/key>\s*<string>([^<]*)<\/string>/.exec(plist)?.[1];
  const un = (v: string | undefined): string | null => (v === undefined ? null : unescapeXml(v));
  return { nodePath: un(args), port: un(port), path: un(path) };
}
