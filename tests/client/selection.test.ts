import { expect, test, vi } from "vitest";
import type { Actor } from "../../src/client/engine/actors";
import { createSelection } from "../../src/client/engine/selection";

const actor = (id: string, x: number): Actor => ({ id, pos: { x, y: 0 }, target: { x, y: 0 }, facing: 1, moving: false, wanderAt: 0 });

test("selecting a known actor pages to it at once and notifies", () => {
  const actors = new Map([["a", actor("a", 700)]]);
  const pageTo = vi.fn();
  const sel = createSelection(actors, pageTo);
  const seen: (string | null)[] = [];
  sel.onSelect(id => seen.push(id));
  sel.select("a");
  expect(sel.selected()).toBe("a");
  expect(pageTo).toHaveBeenCalledWith(actors.get("a"));
  expect(seen).toEqual(["a"]);
});

test("selecting an actor not yet synced stays pending, then pages once the actor appears", () => {
  const actors = new Map<string, Actor>();
  const pageTo = vi.fn();
  const sel = createSelection(actors, pageTo);
  const seen: (string | null)[] = [];
  sel.onSelect(id => seen.push(id));
  sel.select("new");
  expect(pageTo).not.toHaveBeenCalled();
  actors.set("new", actor("new", 900));      // the next sync creates it
  sel.afterSync();
  expect(sel.selected()).toBe("new");
  expect(pageTo).toHaveBeenCalledWith(actors.get("new"));
  expect(seen).toEqual(["new"]);             // never cancelled
  sel.afterSync();
  expect(pageTo).toHaveBeenCalledTimes(1);   // paged once, not every frame
});

test("a selection is dropped only when the actor is absent after a sync", () => {
  const actors = new Map([["a", actor("a", 0)]]);
  const sel = createSelection(actors, () => {});
  const seen: (string | null)[] = [];
  sel.onSelect(id => seen.push(id));
  sel.select("ghost");
  sel.afterSync();
  expect(sel.selected()).toBeNull();
  expect(seen).toEqual(["ghost", null]);
  sel.select("a");
  actors.delete("a");                        // retired
  sel.afterSync();
  expect(sel.selected()).toBeNull();
  expect(seen).toEqual(["ghost", null, "a", null]);
});
