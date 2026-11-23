// The zone browser (M3-04c slice 5): a player's graveyard, exile and revealed cards, opened from their info block, at
// both sizes (the phone project taps, the desktop one clicks). Art is refused, so each card shows its name.

import { expect, type Page, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("https://cards.scryfall.io/**", (route) => route.abort());
});

const sheet = (page: Page) => page.getByRole("dialog", { name: "Opponent's zones" });

test("browses the opponent's graveyard, exile and revealed hand; a card's view closes back to it", async ({ page }) => {
  await page.goto("/?fixture=zones");
  await expect(page.getByRole("button", { name: /^Next/ })).toContainText("To Combat");
  // What's revealed shows without a tap: the opponent's library top (Vampire Nocturnus) and both hands (Telepathy).
  await expect(page.getByRole("button", { name: "Opponent's library top: Shock" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hand revealed" })).toBeVisible();
  await expect(page.getByText("Hand revealed")).toHaveCount(2);

  const block = page.getByRole("button", { name: /^Opponent: graveyard and exile/ });
  await block.click();
  await expect(sheet(page)).toBeVisible();
  await expect(page.getByRole("tab")).toHaveText(["Graveyard 31", "Exile 2", "Hand 3", "Library top"]);
  const row = page.getByRole("list", { name: "Opponent's Graveyard 31" });
  await expect(row.getByRole("listitem")).toHaveCount(31);
  // The top of the graveyard first (CR 404.2).
  await expect(row.getByRole("button").first()).toHaveAccessibleName("Serra Angel");
  // The row scrolls to its last card.
  const last = row.getByRole("button").last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();

  // No key reaches the board behind it: Space doesn't press Next.
  await page.getByRole("tab", { name: "Exile 2" }).click();
  await page.keyboard.press("Space");
  await expect(page.getByRole("list", { name: "Opponent's Exile 2" }).getByRole("button")).toHaveText([
    "Lightning Bolt",
    "Veteran Armorsmith",
  ]);

  // A card's view opens over the browser, and Escape closes it first, then the browser.
  await page.getByRole("button", { name: "Lightning Bolt" }).click();
  await expect(page.getByRole("dialog", { name: "Lightning Bolt" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Lightning Bolt" })).toHaveCount(0);
  await expect(sheet(page)).toBeVisible();

  // The revealed hand, by identity only.
  await page.getByRole("tab", { name: "Hand 3" }).click();
  await expect(page.getByRole("list", { name: "Opponent's Hand 3" }).getByRole("listitem")).toHaveCount(3);
  await page.getByRole("button", { name: "Pacifism" }).click();
  await expect(page.getByRole("dialog", { name: "Pacifism" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  await expect(block).toBeFocused();
  // Nothing happened to the game meanwhile.
  await expect(page.getByRole("button", { name: /^Next/ })).toContainText("To Combat");
});

test("opens the browser from a player who is a target, without picking them", async ({ page }) => {
  await page.goto("/?fixture=zones");
  await page.getByRole("button", { name: "Open your hand" }).click();
  await page.getByRole("button", { name: /^Lightning Bolt: lift/ }).click();
  await page.getByRole("button", { name: /^Lightning Bolt: Cast/ }).click();
  await expect(page.getByText("Choose a target")).toBeVisible();
  const target = page.getByRole("button", { name: /^Opponent: Target/ });
  // "i" looks (as a long-press or right-click does): the browser opens and the tap's target isn't picked.
  await target.focus();
  await page.keyboard.press("i");
  await expect(sheet(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  // The cast is still waiting for its target: the Escape closed the browser, not the cast.
  await expect(page.getByText("Choose a target")).toBeVisible();
  await expect(target).toBeVisible();
});

test("a right-click on a player looks, even while they're a target", async ({ page, isMobile }) => {
  test.skip(isMobile, "a mouse's right-click");
  await page.goto("/?fixture=zones");
  await page.getByRole("button", { name: "Open your hand" }).click();
  await page.getByRole("button", { name: /^Lightning Bolt: lift/ }).click();
  await page.getByRole("button", { name: /^Lightning Bolt: Cast/ }).click();
  await page.getByRole("button", { name: /^Opponent: Target/ }).click({ button: "right" });
  await expect(sheet(page)).toBeVisible();
});

test("a long-press on a player who is a target looks, and its release doesn't pick them", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "a finger's long-press");
  await page.goto("/?fixture=zones");
  await page.getByRole("button", { name: "Open your hand" }).click();
  await page.getByRole("button", { name: /^Lightning Bolt: lift/ }).click();
  await page.getByRole("button", { name: /^Lightning Bolt: Cast/ }).click();
  const target = page.getByRole("button", { name: /^Opponent: Target/ });
  const box = await target.boundingBox();
  if (box === null) throw new Error("no player block");
  const at = [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }];
  const touch = await page.context().newCDPSession(page);
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at });
  await page.waitForTimeout(600);
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(sheet(page)).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  // Still choosing: the release's tap didn't pick the opponent as Lightning Bolt's target.
  await expect(page.getByText("Choose a target")).toBeVisible();
});
