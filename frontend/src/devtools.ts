/**
 * Development-only QA helpers (never included in production builds).
 *
 *   __qa.run(["#/app", "#/app/cases"])  clicks every non-destructive button on each
 *                                       route and records errors, error toasts and
 *                                       broken dialogs; results survive reloads.
 *   __qa.results()                      the report so far.
 */
const KEY = "lexintel.qa";
const SKIP = /write a draft|write again|load now|delete|remove|sign out|log out|reset password|disable|enter ruling|enter the ruling|step down|close session|submit|save|upload|schedule$|create|open case|confirm|run check|record video|start recording|print|copy/i;

const errors: string[] = [];
const origError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  errors.push("console: " + args.map((a) => (a as Error)?.message ?? String(a)).join(" ").slice(0, 200));
  origError(...args);
};
window.addEventListener("error", (e) => errors.push("error: " + e.message));
window.addEventListener("unhandledrejection", (e) => errors.push("rejection: " + ((e.reason as Error)?.message ?? e.reason)));
new MutationObserver((ms) => {
  for (const m of ms) for (const n of m.addedNodes) {
    if (!(n instanceof HTMLElement)) continue;
    const toast = n.matches("[data-sonner-toast][data-type=error]") ? n : n.querySelector("[data-sonner-toast][data-type=error]");
    if (toast) errors.push("toast: " + (toast as HTMLElement).innerText.slice(0, 160));
  }
}).observe(document.documentElement, { childList: true, subtree: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nameOf = (b: Element) => ((b as HTMLElement).innerText.trim() || b.getAttribute("aria-label") || (b as HTMLElement).title || "").replace(/\s+/g, " ").slice(0, 40);
const clickable = () => [...document.querySelectorAll("main button, main [role=tab]")].filter((b) => (b as HTMLElement).offsetParent && !(b as HTMLButtonElement).disabled) as HTMLElement[];

function store(line: string) {
  const all = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as string[];
  all.push(line);
  sessionStorage.setItem(KEY, JSON.stringify(all));
}

async function sweep(route: string): Promise<string> {
  location.hash = route;
  // Wait for the page to render (lazy chunks and data), up to 15 s.
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    const main = document.querySelector("main");
    if (main && !main.querySelector(".animate-pulse, .animate-spin") && clickable().length) break;
  }
  const names = [...new Set(clickable().map(nameOf))].filter((n) => n && !SKIP.test(n));
  const problems: string[] = [];
  for (const name of names) {
    if (location.hash !== route) { location.hash = route; await sleep(900); }
    const b = clickable().find((x) => nameOf(x) === name);
    if (!b) continue;
    const before = errors.length;
    try { b.click(); } catch (e) { problems.push(`${name} threw ${(e as Error).message}`); }
    await sleep(500);
    if (errors.length > before) problems.push(`${name} -> ${errors.slice(before).join(" | ")}`);
    if (document.querySelector("[role=dialog], [role=menu], [role=listbox]")) {
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await sleep(250);
    }
  }
  return `${route}: ${names.length} buttons; problems: ${problems.length ? problems.join(" || ") : "none"}`;
}

(window as any).__qa = {
  errors,
  results: () => JSON.parse(sessionStorage.getItem(KEY) ?? "[]"),
  clear: () => sessionStorage.removeItem(KEY),
  run: async (routes: string[]) => {
    for (const r of routes) {
      try { store(await sweep(r)); } catch (e) { store(`${r}: crashed ${(e as Error).message}`); }
    }
    store("DONE");
  },
};

export {};
