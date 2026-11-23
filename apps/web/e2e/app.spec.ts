// The web app end to end (M3-03's acceptance): it loads, the match worker plays a real round trip, and it still works
// after an offline reload. Runs against the production build (playwright.config.ts).

import { expect, type Page, test } from "@playwright/test";

type Board = { cards: { name: string; zone: string }[]; opponentHandSize: number };

const board = (page: Page) => page.evaluate(() => (window as unknown as { __board?: Board }).__board ?? null);

test("loads a match and plays the person's first decision through the worker", async ({ page }) => {
  await page.goto("/?seed=7");
  await expect(page.getByRole("button", { name: "Keep hand" })).toBeVisible();
  await expect.poll(async () => (await board(page))?.cards.filter((c) => c.zone === "hand").length).toBe(7);
  await page.getByRole("button", { name: "Keep hand" }).click();
  // The worker applied the keep and played on until the person's next decision: the mulligan is gone, the game is
  // into its first turn, and the person has something to do.
  await expect(page.getByRole("button", { name: "Keep hand" })).toHaveCount(0);
  await expect(page.getByText(/Turn [1-9]/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^(Pass|Play .*)$/ }).first()).toBeVisible();
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
