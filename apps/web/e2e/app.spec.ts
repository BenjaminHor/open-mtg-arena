// The web app end to end: it loads, the match worker plays a real round trip, a fixture board draws, and it still
// works after an offline reload. Runs against the production build (playwright.config.ts). Card art comes from
// Scryfall at runtime (D-007); the tests block it, so they never need the network and see the art-less frames.

import { expect, type Page, test } from "@playwright/test";

type Board = { cards: { name: string; zone: string; mine: boolean }[]; backs: unknown[] };

const board = (page: Page) => page.evaluate(() => (window as unknown as { __board?: Board }).__board ?? null);

test.beforeEach(async ({ page }) => {
  await page.route("https://cards.scryfall.io/**", (route) => route.abort());
});

test("loads a match and plays the person's first decision through the worker", async ({ page }) => {
  await page.goto("/?seed=7");
  // The mulligan isn't priority, so the actions drawer opens by itself with its choices.
  await expect(page.getByRole("button", { name: "Keep hand" })).toBeVisible();
  await expect.poll(async () => (await board(page))?.cards.filter((c) => c.zone === "hand").length).toBe(7);
  await page.getByRole("button", { name: "Keep hand" }).click();
  // The worker applied the keep and played on until the person's next decision: the mulligan is gone, the game is
  // into its first turn (the phase ladder shows), and the main button has something to say.
  await expect(page.getByRole("button", { name: "Keep hand" })).toHaveCount(0);
  await expect(page.getByRole("list", { name: /turn$/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Next|Pass|Resolve)/ })).toBeVisible();
});

test("draws a fixture board: permanents, the hand, the opponent's hand as backs, life totals", async ({ page }) => {
  await page.goto("/?fixture=mid-game");
  await expect(page.getByRole("img", { name: "Your life 17" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Opponent's life 14" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Next/ })).toBeVisible();
  await expect(page.getByRole("list", { name: "Your turn" })).toBeVisible();
  const drawn = await board(page);
  expect(drawn?.cards.filter((c) => c.zone === "hand").map((c) => c.name)).toContain("Shivan Dragon");
  expect(drawn?.cards.some((c) => c.name === "Elite Vanguard" && !c.mine)).toBe(true);
  expect(drawn?.backs).toHaveLength(4);
});

test("shows a refusal rather than hanging: an unknown deck in the address", async ({ page }) => {
  await page.goto("/?deck=no-such-deck");
  await expect(page.getByRole("alert")).toContainText("no prebuilt deck");
});

test("works offline once it has loaded (the service worker)", async ({ page, context }) => {
  await page.goto("/?seed=7");
  await expect(page.getByRole("button", { name: "Keep hand" })).toBeVisible();
  // Wait until the service worker controls the page, so everything it precached is in its cache.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller === null) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve));
    }
  });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "Keep hand" })).toBeVisible();
  await expect.poll(async () => (await board(page))?.cards.length ?? 0).toBeGreaterThan(0);
});
