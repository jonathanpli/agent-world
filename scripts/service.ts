import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runService } from "../src/installer/service";

function run(file: string, args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise(done => {
    const child = spawn(file, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d; });
    child.stderr.on("data", (d: Buffer) => { stderr += d; });
    child.on("error", e => done({ status: 1, stdout, stderr: `${stderr}${e.message}` }));
    child.on("close", code => done({ status: code ?? 1, stdout, stderr }));
  });
}

/** True when something accepts connections on 127.0.0.1:port. */
function portInUse(port: number): Promise<boolean> {
  return new Promise(done => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.setTimeout(1000);
    socket.on("connect", () => { socket.destroy(); done(true); });
    socket.on("timeout", () => { socket.destroy(); done(false); });
    socket.on("error", () => done(false));
  });
}

const code = await runService(process.argv.slice(2), {
  platform: process.platform,
  nodeVersion: process.version,
  execPath: process.execPath,
  repoDir: resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  agentsDir: join(homedir(), "Library", "LaunchAgents"),
  homeDir: homedir(),
  uid: process.getuid?.() ?? 0,
  env: process.env,
  run,
  portInUse,
  readFile: p => readFileSync(p, "utf8"),
  writeFile: (p, text, mode) => { writeFileSync(p, text, { mode }); chmodSync(p, mode); },
  mkdir: p => { mkdirSync(p, { recursive: true }); },
  unlink: unlinkSync,
  exists: existsSync,
  log: line => console.log(line),
});
process.exit(code);
