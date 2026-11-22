import { UPGRADES, type ShopState, type Upgrade } from "../../shared/shop";
import { THEMES } from "../engine/theme";
import { api } from "../net";
import type { ClientState } from "../state";
import { attempt, el } from "./dom";

export type ShopItemView = { upgrade: Upgrade; status: "owned" | "buyable" | "poor"; reason: string | null };

/** 950 → "950", 12400 → "12,400". */
export const formatCoins = (n: number): string => Math.trunc(n).toLocaleString("en-US");

/** The upgrades of one world, cheapest first, each with what the player can do about it. */
export function shopItems(theme: string, shop: ShopState): ShopItemView[] {
  return UPGRADES.filter(u => u.theme === theme).sort((a, b) => a.cost - b.cost).map(upgrade => {
    if (shop.owned.includes(upgrade.id)) return { upgrade, status: "owned", reason: null };
    const short = upgrade.cost - shop.coins;
    if (short > 0) return { upgrade, status: "poor", reason: `Need ${formatCoins(short)} more ${short === 1 ? "coin" : "coins"}` };
    return { upgrade, status: "buyable", reason: null };
  });
}

/** What a click on an item's Buy button does: ask this question, then buy this id; null when nothing can be bought. */
export function buyDecision(item: ShopItemView): { id: string; prompt: string } | null {
  if (item.status !== "buyable") return null;
  return { id: item.upgrade.id, prompt: `Buy ${item.upgrade.name} for ${formatCoins(item.upgrade.cost)} coins?` };
}

/** The coin counter text for the top bar. */
export const coinLabel = (shop: ShopState): string => `◎ ${formatCoins(shop.coins)}`;

/** The shop dialog: one tab per world, opening on the current one. `render()` re-draws it when the shop changes. */
export function mount(root: HTMLDialogElement, deps: { state: ClientState }): { open(): void; render(): void } {
  const { state } = deps;
  let tab = state.settings.theme;
  const tabs = el("div", { class: "shop-tabs" });
  tabs.setAttribute("role", "tablist");
  const balance = el("span", { class: "shop-balance" });
  const list = el("ul", { class: "shop-list" });
  const error = el("p", { class: "error" });
  error.setAttribute("role", "alert");
  const closeBtn = el("button", { type: "button", class: "primary" }, "Close");
  closeBtn.addEventListener("click", () => root.close());
  root.replaceChildren(el("div", { class: "shop-card" },
    el("div", { class: "shop-head" }, el("h2", {}, "Shop"), balance),
    tabs, list, error,
    el("div", { class: "actions" }, closeBtn)));

  function buy(item: ShopItemView): void {
    const d = buyDecision(item);
    if (d === null || !confirm(d.prompt)) return;
    void attempt(api.buy(d.id).then(s => { state.shop = s; render(); }), msg => { error.textContent = msg; });
  }

  function render(): void {
    balance.textContent = coinLabel(state.shop);
    tabs.replaceChildren(...THEMES.map(t => {
      const b = el("button", { type: "button", class: t.id === tab ? "shop-tab active" : "shop-tab" }, t.name);
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(t.id === tab));
      b.addEventListener("click", () => { tab = t.id; error.textContent = ""; render(); });
      return b;
    }));
    list.replaceChildren(...shopItems(tab, state.shop).map(item => {
      const { upgrade } = item;
      let action: HTMLElement;
      if (item.status === "owned") action = el("span", { class: "shop-owned" }, "✓ Owned");
      else {
        const b = el("button", { type: "button", class: "shop-buy" }, "Buy");
        b.disabled = item.status === "poor";
        if (item.reason !== null) b.title = item.reason;
        b.addEventListener("click", () => buy(item));
        action = b;
      }
      return el("li", { class: `shop-item ${item.status}` },
        el("div", { class: "shop-info" }, el("strong", {}, upgrade.name), el("span", { class: "dim" }, upgrade.description),
          item.reason !== null ? el("small", { class: "shop-reason" }, item.reason) : null),
        el("span", { class: "shop-cost" }, `◎ ${formatCoins(upgrade.cost)}`),
        action);
    }));
  }

  return {
    open() {
      tab = THEMES.some(t => t.id === state.settings.theme) ? state.settings.theme : THEMES[0]!.id;
      error.textContent = "";
      render();
      if (!root.open) root.showModal();
    },
    render() { if (root.open) render(); },
  };
}
