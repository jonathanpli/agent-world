export type Upgrade = { id: string; theme: "office" | "space" | "underwater"; name: string; description: string; cost: number };
export type ShopState = { coins: number; owned: string[] };

/** Why a purchase was refused: no such upgrade, already bought, or not enough coins. */
export class ShopError extends Error {
  constructor(readonly code: "unknown" | "owned" | "poor", message: string) {
    super(message);
    this.name = "ShopError";
  }
}

const COSTS = [100, 250, 500, 1000, 2500, 5000] as const;
const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Each item is [name, description], or [name, description, id slug] when a renamed item keeps the id purchases are saved under. */
function theme(t: Upgrade["theme"], items: readonly (readonly [string, string, string?])[]): Upgrade[] {
  return items.map(([name, description, id], i) => ({ id: `${t}.${id ?? slug(name)}`, theme: t, name, description, cost: COSTS[i]! }));
}

export const UPGRADES: readonly Upgrade[] = [
  ...theme("office", [
    ["Office plants", "Planters along the walls.", "desk-plants"],
    ["Coffee machine", "A place to chat over a fresh cup."],
    ["Wall art", "Framed pictures brighten the walls."],
    ["Arcade cabinet", "A retro game for coffee breaks."],
    ["Fish tank", "Fish drift lazily past the desks."],
    ["Rooftop skylight", "Daylight pours in from above."],
  ]),
  ...theme("space", [
    ["Hydroponic planter", "Fresh greens grow on the station."],
    ["Drink dispenser", "A place to chat over a cold drink."],
    ["Star chart display", "A glowing map of the stars."],
    ["Observation dome", "A glass dome for watching space."],
    ["Docked shuttle", "A small shuttle parked at the dock."],
    ["Ringed planet in the window", "A ringed planet fills the window."],
  ]),
  ...theme("underwater", [
    ["Sea anemones", "Swaying anemones line the seabed."],
    ["Treasure chest", "A chest of gold to gather around."],
    ["Sunken statue", "An old statue rests on the sand."],
    ["Glowing jellyfish swarm", "Jellyfish light up the water."],
    ["Shipwreck", "A wreck to explore on the seabed."],
    ["Friendly whale that passes by", "A whale glides past now and then."],
  ]),
];
