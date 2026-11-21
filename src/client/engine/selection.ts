import type { Actor } from "./actors";

export type Selection = {
  selected(): string | null;
  select(id: string | null): void;
  /** Call after each actor sync: pages to a pending selection whose actor now exists, or drops one whose actor is gone. */
  afterSync(): void;
  onSelect(cb: (id: string | null) => void): void;
};

/**
 * The engine's selected actor. Selecting an id the engine has not synced yet (a character created by a delta in the
 * same tick) keeps it pending rather than cancelling it; the next sync pages to it, or drops it if it is truly absent.
 */
export function createSelection(actors: Map<string, Actor>, pageTo: (a: Actor) => void): Selection {
  let selected: string | null = null;
  let pending = false;
  const listeners: ((id: string | null) => void)[] = [];
  const notify = (id: string | null): void => { for (const cb of listeners) cb(id); };

  return {
    selected: () => selected,
    select(id) {
      selected = id;
      const a = id === null ? undefined : actors.get(id);
      pending = id !== null && a === undefined;
      if (a !== undefined) pageTo(a);
      notify(id);
    },
    afterSync() {
      if (selected === null) return;
      const a = actors.get(selected);
      if (a === undefined) {
        selected = null;
        pending = false;
        notify(null);
      } else if (pending) {
        pending = false;
        pageTo(a);
      }
    },
    onSelect(cb) { listeners.push(cb); },
  };
}
