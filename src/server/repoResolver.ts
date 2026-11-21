import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { CONFIG } from "../shared/config";

function git(cwd: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, "rev-parse", ...args], { timeout: CONFIG.gitTimeoutMs }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout.trim());
    });
  });
}

async function resolveRepo(cwd: string): Promise<string> {
  try {
    const common = await git(cwd, "--path-format=absolute", "--git-common-dir");
    if (common.endsWith("/.git")) return dirname(common);   // collapses worktrees into their main repo
    const top = await git(cwd, "--show-toplevel");
    return top === "" ? cwd : top;
  } catch {
    return cwd;
  }
}

/** Maps a working directory to its repo root (main repo for worktrees), or the directory itself. Cached per cwd; never rejects. */
export function createRepoResolver(): (cwd: string) => Promise<string> {
  const cache = new Map<string, Promise<string>>();
  return cwd => {
    let p = cache.get(cwd);
    if (p === undefined) { p = resolveRepo(cwd); cache.set(cwd, p); }
    return p;
  };
}
