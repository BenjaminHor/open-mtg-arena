// The full layout and live switching (M3-05, D-176): folding or unfolding mid-game re-lays out the board with nothing
// lost (ui.md, "Folding or unfolding mid-game must just work"). A resize in the middle of a choice keeps it, and the
// choice can be finished at the new size. Art is refused, so each card shows its drawn face.

import { expect, type Page, test } from "@playwright/test";

type Board = { layout: string; cards: { name: string; zone: string }[] };
const board = (page: Page) => page.evaluate(() => (window as unknown as { __board?: Board }).__board ?? null);
const layoutOf = async (page: Page) => (await board(page))?.layout;
const stackNames = async (page: Page) =>
  ((await board(page))?.cards ?? []).filter((c) => c.zone === "stack").map((c) => c.name);

const FOLDED = { width: 812, height: 375 };
const UNFOLDED = { width: 1000, height: 860 };

test.beforeEach(async ({ page }) => {
  await page.route("https://cards.scryfall.io/**", (route) => route.abort());
});

for (const [from, to, way] of [
  [FOLDED, UNFOLDED, "unfolding"],
  [UNFOLDED, FOLDED, "folding"],
] as const) {
  test(`keeps a target being chosen through ${way}, and the spell can still be cast`, async ({ page }) => {
    await page.setViewportSize(from);
    await page.goto("/?fixture=stack");
    await expect.poll(() => layoutOf(page)).toBe(from === FOLDED ? "compact" : "full");
    await page.getByRole("button", { name: "Open your hand" }).click();
    await page.getByRole("button", { name: /^Lightning Bolt: lift/ }).click();
    await page.getByRole("button", { name: /^Lightning Bolt: Cast/ }).click();
    await expect(page.getByRole("button", { name: /^Elite Vanguard: Target/ })).toBeVisible();

    await page.setViewportSize(to);
    await expect.poll(() => layoutOf(page)).toBe(to === FOLDED ? "compact" : "full");
    // Still choosing, the spell on the stack (CR 601.2a), and the choice is finished at the new size.
    await expect.poll(() => stackNames(page)).toEqual(["Lightning Bolt"]);
    await page.getByRole("button", { name: /^Elite Vanguard: Target/ }).click();
    // It resolves (the host passes for the person after their own spell, D-157): 3 damage, and Elite Vanguard (2/1)
    // dies (CR 704.5g).
    await expect.poll(() => stackNames(page)).toEqual([]);
    await expect
      .poll(async () => ((await board(page))?.cards ?? []).some((c) => c.name === "Elite Vanguard"))
      .toBe(false);
  });

  test(`keeps a lifted card and the open hand through ${way}`, async ({ page }) => {
    await page.setViewportSize(from);
    await page.goto("/?fixture=stack");
    await page.getByRole("button", { name: "Open your hand" }).click();
    await page.getByRole("button", { name: /^Giant Growth: lift/ }).click();
    await expect(page.getByRole("button", { name: /^Giant Growth: Cast/ })).toBeVisible();

    await page.setViewportSize(to);
    await expect.poll(() => layoutOf(page)).toBe(to === FOLDED ? "compact" : "full");
    // The lifted card is still lifted, ready to cast, with the hand still open behind it (its other cards lift).
    await expect(page.getByRole("button", { name: /^Cancel: lift/ })).toBeVisible();
    await page.getByRole("button", { name: /^Giant Growth: Cast/ }).click();
    await expect(
      page.getByRole("button", { name: /^Grizzly Bears: Target|^Elite Vanguard: Target/ }).first(),
    ).toBeVisible();
  });
}
