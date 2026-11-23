// Playing by touch, mouse and keyboard (M3-04b): every action through the cards and the HUD's controls, never a list of
// actions. Runs at desktop size and at the folded phone in landscape with touch (playwright.config.ts).

import { expect, type Page, test } from "@playwright/test";

type Board = {
  cards: { id: string; name: string; zone: string; mine: boolean; attacking: boolean; blocking: string[] }[];
};
const board = (page: Page) => page.evaluate(() => (window as unknown as { __board?: Board }).__board ?? null);

test.beforeEach(async ({ page }) => {
  await page.route("https://cards.scryfall.io/**", (route) => route.abort());
});

test("casts a spell by taps: open the hand, lift the card, tap it again, pick a target", async ({ page }) => {
  await page.goto("/?fixture=mid-game");
  await page.getByRole("button", { name: "Open your hand" }).click();
  await page.getByRole("button", { name: /^Lightning Bolt: lift/ }).click();
  await page.getByRole("button", { name: /^Lightning Bolt: Cast/ }).click();
  await expect(page.getByText("Choose a target")).toBeVisible();
  await page.getByRole("button", { name: /^Elite Vanguard: Target/ }).click();
  // Three damage to a 3/3: it's gone.
  await expect.poll(async () => (await board(page))?.cards.some((c) => c.name === "Elite Vanguard")).toBe(false);
});

test("attacks by tapping creatures, and finishes with the main button", async ({ page }) => {
  await page.goto("/?fixture=attack");
  // Pass on to the declaration: past main 1 and the beginning of combat.
  for (let i = 0; i < 4; i++) {
    if (await page.getByRole("button", { name: /^Stampeding Rhino: Attack/ }).count()) break;
    await page.getByRole("button", { name: /^Next/ }).click();
    await page.waitForTimeout(200);
  }
  await page.getByRole("button", { name: /^Stampeding Rhino: Attack/ }).click();
  await expect(page.getByRole("button", { name: /^1 Attacker/ })).toBeVisible();
  await page.getByRole("button", { name: /^Shivan Dragon: Attack/ }).click();
  // Berserkers of Blood Ridge attacks each combat if able (CR 508.1d): until it does, the button says why it can't finish.
  await expect(page.getByRole("button", { name: /^2 Attackers.*must attack/ })).toBeDisabled();
  await page.getByRole("button", { name: /^Berserkers of Blood Ridge: Attack/ }).click();
  await page.getByRole("button", { name: /^3 Attackers/ }).click();
  const attacking = async () =>
    (await board(page))?.cards
      .filter((c) => c.mine && c.attacking)
      .map((c) => c.name)
      .sort();
  await expect.poll(attacking).toEqual(["Berserkers of Blood Ridge", "Shivan Dragon", "Stampeding Rhino"]);
});

test("blocks with two taps: the blocker, then the attacker", async ({ page }) => {
  await page.goto("/?fixture=block");
  for (let i = 0; i < 6; i++) {
    if (await page.getByText("Choose blockers").count()) break;
    const pass = page.getByRole("button", { name: /^(Pass|Next|Resolve)/ });
    if (await pass.count()) await pass.click();
    await page.waitForTimeout(250);
  }
  await expect(page.getByText("Choose blockers")).toBeVisible();
  await page.getByRole("button", { name: /^Deadly Recluse: pick to block/ }).click();
  await page.getByRole("button", { name: /^Serra Angel: blocked by Deadly Recluse/ }).click();
  await expect(page.getByRole("button", { name: /^1 Blocker/ })).toBeVisible();
  await page.getByRole("button", { name: /^1 Blocker/ }).click();
  await expect
    .poll(async () => (await board(page))?.cards.find((c) => c.name === "Deadly Recluse")?.blocking.length ?? 0)
    .toBe(1);
});

test("plays a whole game through the board and HUD alone: something to press at every step", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/?seed=7");
  for (let i = 0; i < 400; i++) {
    if (await page.getByRole("status").count()) break;
    // The game is waiting on the person whenever a control is enabled: a prompt choice, the main button, a card.
    const prompt = page.locator(".prompt-choices button:not([disabled])");
    const main = page.locator(".main-button:not([disabled])");
    // A card that does something when tapped (not just lifted, put down, or tapped for mana).
    const cards = page.locator(
      ".tap-region:not([aria-label$=': lift']):not([aria-label$=': put down']):not([aria-label$='Tap for mana'])",
    );
    if (await prompt.count()) await prompt.first().click();
    else if (await cards.count()) await cards.first().click();
    else if (await main.count()) await main.click();
    else await page.waitForTimeout(100);
    await page.waitForTimeout(40);
  }
  await expect(page.getByRole("status")).toBeVisible();
});

test("the keyboard alone: Tab to a card, Enter to use it, Space for the main button, Escape to back out", async ({
  page,
}) => {
  await page.goto("/?fixture=mid-game");
  await expect(page.getByRole("button", { name: /^Next/ })).toBeVisible();
  // Focus the open-hand control and open it with Enter.
  await page.getByRole("button", { name: "Open your hand" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /^Lightning Bolt: lift/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Lightning Bolt: Cast/ })).toBeVisible();
  // Escape puts it down again.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Lightning Bolt: lift/ })).toBeVisible();
  // Space, with nothing focused, presses the main button: on to combat.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Space");
  await expect(page.getByRole("list", { name: "Your turn" }).locator("[aria-current=step]")).not.toHaveAttribute(
    "aria-label",
    "Main 1",
  );
});
