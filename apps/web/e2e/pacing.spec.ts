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

test("a quick second tap after Skip isn't taken for the decision it uncovers", async ({ page }) => {
  await page.goto("/?seed=7&pace=normal");
  await page.getByRole("button", { name: /^Keep \d/ }).click();
  const skip = page.getByRole("button", { name: "Skip to your decision" });
  await expect(skip).toBeVisible({ timeout: 5_000 });
  // Two taps in the same spot, in quick succession: the first skips, the second lands within the settle moment.
  await page.locator(".main-button").dblclick();
  const next = page.getByRole("button", { name: /^Next/ });
  await expect(next).toBeVisible();
  await expect(next).toContainText("To Combat");
});
