import { expect, test } from "vitest";
import { createDemo } from "../../src/adapters/demo";
import { mulberry32 } from "../../src/shared/rng";
import { newWorld } from "../helpers/events";

test("simulator drives a world for an hour without breaking it", () => {
  let t = 0; const seen = new Set<string>(); const tiers = new Set<number>(); const efforts = new Set<string>();
  const w = newWorld(); const live = () => w.snapshot(t, false).sessions.length;
  const demo = createDemo({ rng: mulberry32(7), now: () => t, emit: e => { seen.add(e.kind); if (e.tier) tiers.add(e.tier); if (e.effort) efforts.add(e.effort); w.apply(e); } });
  for (let i = 0; i < 3600; i++) { t = i * 1000; demo.step(); if (i > 60) { expect(live()).toBeGreaterThanOrEqual(3); expect(live()).toBeLessThanOrEqual(6); } }
  expect([...seen].sort()).toEqual(["model_change","needs_input","prompt","session_end","session_start","task_done","tool"]);
  expect(tiers.size).toBe(4); expect(efforts.size).toBe(5);
  expect(w.snapshot(t, false).repos.length).toBe(4);
});
