import { describe, expect, test } from "vitest";
import { commitSubject, momentFor } from "../../src/adapters/moments";
import type { MomentKind } from "../../src/shared/types";

const table: [string, boolean, MomentKind | null][] = [
  ['git commit -m "x"', false, "commit"],
  ["git commit --dry-run", false, null],
  ['echo "git commit"', false, null],
  ["git -C sub commit -m x", false, "commit"],
  ['cd app && rtk git commit -m "a && b"', false, "commit"],
  ["FOO=1 npm test", false, "tests_passed"],
  ["npm run test:unit -- --watch=false", false, "tests_passed"],
  ["npx vitest run", false, "tests_passed"],
  ["pytest -q", false, "tests_passed"],
  ["go test ./...", false, "tests_passed"],
  ["cargo test", false, "tests_passed"],
  ["bun test", false, "tests_passed"],
  ["pnpm test", false, "tests_passed"],
  ["yarn test", false, "tests_passed"],
  ["dotnet test", false, "tests_passed"],
  ["pytest -q", true, "tests_failed"],
  ["go test ./...", true, "tests_failed"],
  ["cargo test", true, "tests_failed"],
  ["bun test", true, "tests_failed"],
  ["pnpm test", true, "tests_failed"],
  ["yarn test", true, "tests_failed"],
  ["dotnet test", true, "tests_failed"],
  ["npm test", true, "tests_failed"],
  ["npx vitest run", true, "tests_failed"],
  ["npm run test:unit", true, "tests_failed"],
  ["git commit -m x", true, null],
  ["git push origin main", true, null],
  ["npm test || git commit -m x", false, "commit"],
  ["gh pr create --fill", false, "pr_opened"],
  ["gh pr merge 12 --squash", false, "pr_merged"],
  ["git push origin main", false, "push"],
  ["git push --dry-run", false, null],
  ["git commit -m x && git push && gh pr create --fill", false, "pr_opened"],
  ["cat <<'EOF'\ngit commit\nEOF", false, null],
  ["git commit -F - <<EOF\nmsg\nEOF\ngit push", false, "commit"],
  ["npm install", false, null],
  ["npm run build", false, null],
  ["cd git commit", false, null],
  ["", false, null],
  ["", true, null],
  ["git add . && \\\n  git commit -m x", false, "commit"],
  ["git -C x \\\n commit -m y", false, "commit"],
  ["npm test \\\n  -- --run", false, "tests_passed"],
  ["git add . && \\\r\n git commit -m x", false, "commit"],
  ["echo hi # ; git commit -m x", false, null],
  ["# git commit -m x", false, null],
  ["echo a#b && git commit -m x", false, "commit"],
  ['git commit -m "fix #12"', false, "commit"],
  ["echo hi # note\ngit commit -m x", false, "commit"],
];

describe("momentFor", () => {
  test.each(table)("%j (failed=%s) -> %s", (command, failed, expected) => { expect(momentFor(command, failed)).toBe(expected); });
});

describe("commitSubject", () => {
  test("branch and hash", () => { expect(commitSubject("[main 1a2b3c4] fix the gauge\n 1 file changed")).toBe("fix the gauge"); });
  test("root commit", () => { expect(commitSubject("[feat/x (root-commit) abc1234] init")).toBe("init"); });
  test("cut to 80", () => { expect(commitSubject(`[main 1a2b3c4] ${"s".repeat(200)}`)).toBe("s".repeat(80)); });
  test("not a commit line", () => { expect(commitSubject("nothing to commit")).toBeNull(); });
});
