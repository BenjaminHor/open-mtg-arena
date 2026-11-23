// What the host did, shown at a pace (D-172; the owner: "Things just progress instantly and I get confused"): at
// normal pace the opponent's turn plays frame by frame, each saying what happened, with Skip on the main button; the
// e2e build's other tests play at instant pace.

import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://cards.scryfall.io/**", (route) => route.abort());
});

test("shows the opponent's turn a step at a time, saying what happened, and Skip jumps to the person's decision", async ({
  page,
}) => {
  // Seed 7: the opponent goes first and casts Elite Vanguard on turn 1.
  await page.goto("/?seed=7&pace=normal");
  await page.getByRole("button", { name: /^Keep \d/ }).click();
  const line = page.locator(".event-line");
  await expect(line).toHaveText("Your opponent cast Elite Vanguard", { timeout: 5_000 });
  // While it plays, the main button skips, and nothing else is pressed.
  const skip = page.getByRole("button", { name: "Skip to your decision" });
  await expect(skip).toBeVisible();
  await skip.click();
  await expect(line).toHaveCount(0);
  // The person's own decision, at once: their turn's main button, not a second skip.
  await expect(page.getByRole("button", { name: /^Next/ })).toBeVisible();
});

test("shows each new turn's banner, the later ones too", async ({ page }) => {
  await page.goto("/?seed=7&pace=normal");
  await page.getByRole("button", { name: /^Keep \d/ }).click();
  await expect(page.locator(".turn-banner")).toHaveText("Turn 1 · Opponent's turn", { timeout: 5_000 });
  await expect(page.locator(".turn-banner")).toHaveText("Turn 2 · Your turn", { timeout: 15_000 });
  // On to the opponent's next turn: its banner shows too (it once stayed hidden after the first). It shows until the
  // turn's first line takes its place, so it's caught as it shows, not waited for.
  const banner = page.locator(".turn-banner");
  const next = page.getByRole("button", { name: /^Next/ });
  let sawTurn3 = false;
  for (let i = 0; i < 60 && !sawTurn3; i++) {
    sawTurn3 = (await banner.allInnerTexts()).some((t) => t === "Turn 3 · Opponent's turn");
    if (sawTurn3) break;
    if (await next.isVisible()) await next.click({ timeout: 1_000 }).catch(() => undefined);
    // Passing with a full hand: the cleanup discard (CR 514.1) asks for a card first.
    const discard = page.getByRole("button", { name: /: Discard/ }).first();
    if (await discard.isVisible().catch(() => false)) await discard.click({ timeout: 1_000 }).catch(() => undefined);
    await page.waitForTimeout(100);
  }
  expect(sawTurn3).toBe(true);
  // And it goes after its moment, as each one does (once, one stayed for good, faded out, and the next never showed).
  await expect(banner).toHaveCount(0, { timeout: 4_000 });
});

test("takes no game action from a tap while what happened plays", async ({ page }) => {
  await page.goto("/?seed=7&pace=normal");
  await page.getByRole("button", { name: /^Keep \d/ }).click();
  await expect(page.getByRole("button", { name: "Skip to your decision" })).toBeVisible({ timeout: 5_000 });
  // A tap on the opponent's info and on the board while frames play: looking only, nothing sent.
  await page.locator(".board").click({ position: { x: 400, y: 180 } });
  await expect(page.getByRole("button", { name: /^Next/ })).toContainText("To Combat", { timeout: 15_000 });
});

test("a quick second tap after Skip isn't taken for the decision it uncovers", async ({ page }) => {
  await page.goto("/?seed=7&pace=normal");
  await page.getByRole("button", { name: /^Keep \d/ }).click();
  const skip = page.getByRole("button", { name: "Skip to your decision" });
  await expect(skip).toBeVisible({ timeout: 5_000 });
  // Two taps in the same spot, in quick succession: the first skips, the second lands within the settle moment.
  await page.locator(".main-button").dblclick();
  const next = page.getByRole("button", { name: /^Next/ });
  await expect(next).toBeVisible();
  // Long enough for the worker's reply, had the second tap been sent: still the first main phase.
  await page.waitForTimeout(800);
  await expect(next).toContainText("To Combat");
});
