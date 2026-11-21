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

/** The repo root, or null when git cannot say (not a repo, missing dir, git error or timeout). */
async function gitRoot(cwd: string): Promise<string | null> {
  try {
    const common = await git(cwd, "--path-format=absolute", "--git-common-dir");
    if (common.endsWith("/.git")) return dirname(common);   // collapses worktrees into their main repo
    const top = await git(cwd, "--show-toplevel");
    return top === "" ? null : top;
  } catch {
    return null;
  }
}

/**
 * Maps a working directory to its repo root (main repo for worktrees), or the directory itself.
 * Only successful git resolutions are cached, so a directory that later becomes a repo is picked up. Never rejects.
 */
export function createRepoResolver(): (cwd: string) => Promise<string> {
  const cache = new Map<string, string>();
  return async cwd => {
    const hit = cache.get(cwd);
    if (hit !== undefined) return hit;
    const root = await gitRoot(cwd);
    if (root === null) return cwd;
    cache.set(cwd, root);
    return root;
  };
}
