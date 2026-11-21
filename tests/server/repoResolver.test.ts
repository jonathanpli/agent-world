import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createRepoResolver } from "../../src/server/repoResolver";

const git = (...args: string[]) => execFileSync("git", args, { stdio: "ignore" });
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), "aw-repo-")));

test("subdirectory resolves to the root", async () => {
  const r = join(tmp(), "r");
  git("init", "-q", r);
  mkdirSync(join(r, "a", "b"), { recursive: true });
  expect(await createRepoResolver()(join(r, "a", "b"))).toBe(realpathSync(r));
});

test("a worktree resolves to the main repo", async () => {
  const base = tmp(); const r = join(base, "r"); const wt = join(base, "wt");
  git("init", "-q", r);
  git("-C", r, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  git("-C", r, "worktree", "add", "-q", wt);
  const resolve = createRepoResolver();
  expect(await resolve(wt)).toBe(realpathSync(r));
  expect(await resolve(r)).toBe(realpathSync(r));
});

test("non-repo, missing dir, and a path with spaces (Review Focus 3)", async () => {
  const resolve = createRepoResolver();
  const plain = tmp();
  expect(await resolve(plain)).toBe(plain);
  expect(await resolve("/no/such/dir")).toBe("/no/such/dir");
  const r = join(tmp(), "my repo");
  git("init", "-q", r);
  const sub = join(r, "sub dir");
  mkdirSync(sub);
  expect(await resolve(sub)).toBe(realpathSync(r));
});

test("a failed resolution is not cached: a directory that becomes a repo is picked up", async () => {
  const resolve = createRepoResolver();
  const d = tmp(); const sub = join(d, "sub"); mkdirSync(sub);
  expect(await resolve(sub)).toBe(sub);
  git("init", "-q", d);
  expect(await resolve(sub)).toBe(d);
});
