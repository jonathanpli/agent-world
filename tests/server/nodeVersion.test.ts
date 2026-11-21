import { expect, test } from "vitest";
import { nodeVersionProblem } from "../../src/server/nodeVersion";

test("nodeVersionProblem names the required version for anything older than 22.13 (unflagged node:sqlite)", () => {
  for (const v of ["v18.20.4", "v20.11.0", "v22.4.1", "v22.12.0"]) expect(nodeVersionProblem(v)).toMatch(/Node 22\.13 or newer.*nvm use/);
  expect(nodeVersionProblem("v18.20.4")).toContain("v18.20.4");
  for (const v of ["v22.13.0", "v22.23.3", "v23.0.0", "v24.1.0"]) expect(nodeVersionProblem(v)).toBeNull();
});
