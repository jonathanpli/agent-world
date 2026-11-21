/** node:sqlite loads without a flag from Node 22.13. Kept free of imports so it can run before anything else loads. */
const MIN: readonly [number, number] = [22, 13];

/** A friendly message when `version` (like process.version) is too old to run the server, or null when it is fine. */
export function nodeVersionProblem(version: string): string | null {
  const [major = 0, minor = 0] = version.replace(/^v/, "").split(".").map(Number);
  if (major > MIN[0] || (major === MIN[0] && minor >= MIN[1])) return null;
  return `Agent World needs Node ${MIN[0]}.${MIN[1]} or newer (this is ${version}). Run \`nvm use\` in the project directory, or install Node 22.13 or newer.`;
}
