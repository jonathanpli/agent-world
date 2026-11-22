import type { MomentKind } from "../shared/types";

const SEPARATORS = ["&&", "||", ";", "|", "&", "\n"];
/** A lone `&` (background) separates commands; inside a redirection (`2>&1`, `>&2`, `&>file`) it does not. */
const inRedirect = (command: string, i: number): boolean => command[i - 1] === ">" || command[i - 1] === "<" || command[i + 1] === ">";

/** Splits a shell command into simple commands, each a list of words with quotes removed. Quoted text stays inside one word; heredoc bodies are dropped. */
function simpleCommands(command: string): string[][] {
  const out: string[][] = [];
  let words: string[] = [];
  let word: string | null = null;
  let heredocs: { tag: string; strip: boolean }[] = [];
  const endWord = () => { if (word !== null) words.push(word); word = null; };
  const endCommand = () => { endWord(); if (words.length > 0) out.push(words); words = []; };
  let i = 0;
  while (i < command.length) {
    const c = command[i];
    if (c === "'") {
      const end = command.indexOf("'", i + 1);
      word = (word ?? "") + command.slice(i + 1, end === -1 ? command.length : end);
      i = end === -1 ? command.length : end + 1;
    } else if (c === '"') {
      let j = i + 1;
      let text = "";
      while (j < command.length && command[j] !== '"') {
        if (command[j] === "\\" && j + 1 < command.length) j++;
        text += command[j++];
      }
      word = (word ?? "") + text;
      i = j + 1;
    } else if (c === "\\" && (command[i + 1] === "\n" || command.startsWith("\r\n", i + 1))) {
      i += command[i + 1] === "\n" ? 2 : 3;   // line continuation: nothing
    } else if (c === "\\" && i + 1 < command.length) {
      word = (word ?? "") + command[i + 1];
      i += 2;
    } else if (c === "#" && word === null) {
      const nl = command.indexOf("\n", i);   // comment: the newline itself still ends the command
      i = nl === -1 ? command.length : nl;
    } else if (c === "<" && command.startsWith("<<", i) && command[i + 2] !== "<" && command[i + 2] !== "(") {
      let j = i + 2;
      const strip = command[j] === "-";
      if (strip) j++;
      while (command[j] === " " || command[j] === "\t") j++;
      let tag = "";
      while (j < command.length && !/[\s;&|<>()]/.test(command[j])) {
        if (command[j] === "'" || command[j] === '"' || command[j] === "\\") { j++; continue; }
        tag += command[j++];
      }
      if (tag !== "") heredocs.push({ tag, strip });
      endWord();
      i = j;
    } else if (c === "\n" && heredocs.length > 0) {
      endCommand();
      i++;
      for (const h of heredocs) {
        for (;;) {
          if (i >= command.length) break;
          const nl = command.indexOf("\n", i);
          const line = command.slice(i, nl === -1 ? command.length : nl);
          i = nl === -1 ? command.length : nl + 1;
          if ((h.strip ? line.replace(/^\t+/, "") : line) === h.tag) break;
        }
      }
      heredocs = [];
    } else {
      const sep = SEPARATORS.find((s) => command.startsWith(s, i) && !(s === "&" && inRedirect(command, i)));
      if (sep !== undefined) { endCommand(); i += sep.length; }
      else if (c === " " || c === "\t" || c === "\r") { endWord(); i++; }
      else { word = (word ?? "") + c; i++; }
    }
  }
  endCommand();
  return out;
}

/** Drops a leading `cd …` command, env assignments and one `rtk`; null when nothing is left to run. */
function core(words: string[]): string[] | null {
  let w = words;
  if (w[0] === "cd") return null;
  while (w.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) w = w.slice(1);
  if (w[0] === "rtk") w = w.slice(1);
  return w.length > 0 ? w : null;
}

function gitSubcommand(w: string[]): { sub: string; rest: string[] } | null {
  for (let i = 1; i < w.length; i++) {
    if (w[i] === "-C" || w[i] === "-c") { i++; continue; }
    if (w[i].startsWith("-")) continue;
    return { sub: w[i], rest: w.slice(i + 1) };
  }
  return null;
}

const TEST_SCRIPT = /^test(:|$)/;
const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"];
const WRAPPERS = ["npx", "bunx"];
const RUNNERS = ["vitest", "jest", "pytest", "rspec", "phpunit"];
const LAUNCHERS = ["mvn", "mvnw", "gradle", "gradlew"];

function isTestRunner(w: string[]): boolean {
  const program = (w[0].split("/").pop() ?? "");
  const arg = w.slice(1).find((a) => !a.startsWith("-"));
  if (PACKAGE_MANAGERS.includes(program)) {
    if (arg === "test" || arg === "t") return true;
    if (arg === "run") return TEST_SCRIPT.test(w.slice(w.indexOf("run") + 1).find((a) => !a.startsWith("-")) ?? "");
    return false;
  }
  if (WRAPPERS.includes(program)) return arg !== undefined && RUNNERS.includes(arg);
  if (RUNNERS.includes(program)) return true;
  if (program === "go" || program === "cargo" || program === "dotnet") return arg === "test";
  if (LAUNCHERS.includes(program)) return arg === "test";
  if (program.startsWith("python")) return w[1] === "-m" && w[2] === "pytest";
  return false;
}

function matchOne(w: string[]): Exclude<MomentKind, "tests_failed"> | null {
  const program = w[0];
  if (program === "git") {
    const g = gitSubcommand(w);
    if (g === null || g.rest.includes("--dry-run")) return null;
    if (g.sub === "commit") return "commit";                 // for commit, -n is --no-verify: it still commits
    return g.sub === "push" && !g.rest.includes("-n") ? "push" : null;
  }
  // `gh pr merge --auto` only queues the merge for when checks pass: not a merge yet
  if (program === "gh" && w[1] === "pr") return w[2] === "create" ? "pr_opened" : w[2] === "merge" && !w.includes("--auto") ? "pr_merged" : null;
  return isTestRunner(w) ? "tests_passed" : null;
}

const PRECEDENCE: readonly MomentKind[] = ["pr_merged", "pr_opened", "commit", "push", "tests_passed"];

/** The git or test moment a Bash command represents, or null. A failed command can only be a failed test run. */
export function momentFor(command: string, failed: boolean): MomentKind | null {
  const found = new Set<MomentKind>();
  for (const words of simpleCommands(command)) {
    const w = core(words);
    const m = w === null ? null : matchOne(w);
    if (m !== null) found.add(m);
  }
  if (failed) return found.has("tests_passed") ? "tests_failed" : null;
  return PRECEDENCE.find((m) => found.has(m)) ?? null;
}

/** The subject of a `git commit` result whose first line is `[branch hash] subject`, at most 80 characters. */
export function commitSubject(stdout: string): string | null {
  const first = stdout.split("\n", 1)[0].trim();
  const m = /^\[[^\]]*\s[0-9a-f]{4,40}\]\s+(.+)$/.exec(first);
  return m === null ? null : m[1].trim().slice(0, 80);
}
