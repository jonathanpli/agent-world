import { CONFIG } from "../../shared/config";
import type { Settings } from "../../shared/types";
import { THEMES } from "../engine/theme";
import { api } from "../net";
import type { ClientState } from "../state";
import { attempt, el } from "./dom";

type Permission = NotificationPermission | "unsupported";
const PERMISSION_TEXT: Record<Permission, string> = {
  granted: "Notifications are on.",
  denied: "Notifications are blocked in the browser's site settings.",
  default: "Notifications are off.",
  unsupported: "This browser has no notifications.",
};

function permission(): Permission {
  const N = (globalThis as { Notification?: typeof Notification }).Notification;
  return typeof N === "function" ? N.permission : "unsupported";
}

/** The settings dialog. Every change goes through api.putSettings; controls show the state's settings on render. */
export function mount(root: HTMLDialogElement, deps: { state: ClientState }): { render(): void } {
  const theme = el("select", {});
  for (const t of THEMES) theme.add(new Option(t.name, t.id));
  const check = (): HTMLInputElement => el("input", { type: "checkbox" });
  const needsInput = check(), done = check(), sound = check(), ctxNotify = check();
  const cap = el("input", { type: "number" });
  cap.min = "1";
  cap.max = String(CONFIG.rosterCapMax);
  cap.step = "1";
  const warn = el("input", { type: "number" });
  warn.min = String(CONFIG.context.warnMin);
  warn.max = String(CONFIG.context.warnMax);
  warn.step = "1";
  const limit = el("input", { type: "number" });
  limit.min = String(CONFIG.context.overrideMin);
  limit.step = "1";
  limit.placeholder = "estimate";
  const useEstimate = el("button", { type: "button" }, "Use estimate");
  const enable = el("button", { type: "button" }, "Enable notifications");
  const permText = el("span", { class: "perm" });
  const error = el("p", { class: "error" });
  error.setAttribute("role", "alert");
  const closeBtn = el("button", { type: "button", class: "primary" }, "Close");

  const field = (label: string, control: HTMLElement, hint?: string): HTMLElement =>
    el("label", { class: "field" }, el("span", {}, label), control, hint === undefined ? null : el("small", { class: "dim" }, hint));
  root.replaceChildren(el("form", { class: "settings-form" },
    el("h2", {}, "Settings"),
    field("Theme", theme),
    field("Notify when an agent needs you", needsInput),
    field("Notify when an agent finishes", done),
    field("Chime", sound),
    field("Context running low", ctxNotify),
    field("Warn at context %", warn, `${CONFIG.context.warnMin} to ${CONFIG.context.warnMax}.`),
    field("Context limit override", el("span", { class: "inline" }, limit, useEstimate), `Tokens, at least ${CONFIG.context.overrideMin.toLocaleString("en-US")}. Leave empty to estimate it from each model.`),
    field("Roster cap", cap, `Named characters, 1 to ${CONFIG.rosterCapMax}. Past it, sessions show as temps.`),
    el("div", { class: "notify-row" }, enable, permText),
    error,
    el("div", { class: "actions" }, closeBtn)));
  root.querySelector("form")!.addEventListener("submit", e => e.preventDefault());

  const put = (patch: Partial<Settings>): void => {
    void attempt(api.putSettings(patch), msg => { error.textContent = msg; }).then(ok => { if (!ok) render(); });
  };
  theme.addEventListener("change", () => put({ theme: theme.value }));
  needsInput.addEventListener("change", () => put({ notifyNeedsInput: needsInput.checked }));
  done.addEventListener("change", () => put({ notifyDone: done.checked }));
  sound.addEventListener("change", () => put({ sound: sound.checked }));
  ctxNotify.addEventListener("change", () => put({ notifyContext: ctxNotify.checked }));
  warn.addEventListener("change", () => put({ contextWarnPct: Number(warn.value) }));
  limit.addEventListener("change", () => put({ contextLimitOverride: limit.value.trim() === "" ? null : Number(limit.value) }));
  useEstimate.addEventListener("click", () => { limit.value = ""; put({ contextLimitOverride: null }); });
  cap.addEventListener("change", () => put({ rosterCap: Number(cap.value) }));
  closeBtn.addEventListener("click", () => root.close());
  enable.addEventListener("click", () => {
    const N = (globalThis as { Notification?: typeof Notification }).Notification;
    if (typeof N !== "function") return;
    N.requestPermission().then(render, e => { error.textContent = String(e); });
  });

  function render(): void {
    const s = deps.state.settings;
    theme.value = THEMES.some(t => t.id === s.theme) ? s.theme : THEMES[0]!.id;
    needsInput.checked = s.notifyNeedsInput;
    done.checked = s.notifyDone;
    sound.checked = s.sound;
    ctxNotify.checked = s.notifyContext;
    if (document.activeElement !== warn) warn.value = String(s.contextWarnPct);
    if (document.activeElement !== limit) limit.value = s.contextLimitOverride === null ? "" : String(s.contextLimitOverride);
    useEstimate.disabled = s.contextLimitOverride === null;
    if (document.activeElement !== cap) cap.value = String(s.rosterCap);
    const p = permission();
    permText.textContent = PERMISSION_TEXT[p];
    enable.disabled = p !== "default";
  }
  return { render };
}
