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
  // The spell on the stack is drawn over the board: a tap on it lands on it, never on a card's button underneath.
  const shield = await page.locator(".tap-shield").first().boundingBox();
  if (shield === null) throw new Error("no card on the stack");
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x as number, y as number)?.className,
    [shield.x + shield.width / 2, shield.y + shield.height / 2],
  );
  expect(hit).toBe("tap-shield");
  // And it covers no target: each one's centre is its own button.
  const covered = await page.evaluate(() =>
    [...document.querySelectorAll(".tap-region")]
      .filter((e) => /: Target /.test(e.getAttribute("aria-label") ?? ""))
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) !== e;
      })
      .map((e) => e.getAttribute("aria-label")),
  );
  expect(covered).toEqual([]);
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
  await expect(page.getByRole("button", { name: /^2 Attackers.*1 must attack/ })).toBeDisabled();
  await expect(page.getByText("Berserkers of Blood Ridge must attack")).toBeVisible();
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
    // Not while an action is on its way (aria-disabled): the screen is about to change.
    const main = page.locator(".main-button:not([disabled]):not([aria-disabled=true])");
    // A card that does something when tapped (not just lifted, put down, or tapped for mana).
    const cards = page.locator(
      ".tap-region:not([aria-label$=': lift']):not([aria-label$=': put down']):not([aria-label$=' mana'])",
    );
    // The screen can change between finding a control and pressing it (the opponent acted, a decision ended): a press
    // that finds its control gone is simply tried again next time round.
    const press = (control: typeof main) => control.click({ timeout: 2_000 }).catch(() => undefined);
    if (await prompt.count()) await press(prompt.first());
    else if (await cards.count()) await press(cards.first());
    else if (await main.count()) await press(main);
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

test("concedes from the settings menu, after asking once more", async ({ page }) => {
  await page.goto("/?fixture=mid-game");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Concede" }).click();
  await page.getByRole("button", { name: "Concede? Tap again" }).click();
  await expect(page.getByRole("status")).toHaveText("You lose");
});

test("full control from the settings menu: the main button turns blue-violet, and back", async ({ page }) => {
  await page.goto("/?fixture=mid-game");
  await page.getByRole("button", { name: "Settings" }).click();
  const toggle = page.getByRole("switch", { name: /Full control/ });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".main-button")).toHaveClass(/full-control/);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".main-button")).not.toHaveClass(/full-control/);
});

test("prompts say what they're for: dividing damage, X as a row of numbers, naming a card with a filter", async ({
  page,
}) => {
  await page.goto("/?fixture=prompts");
  const cast = async (name: string) => {
    await page.getByRole("button", { name: "Open your hand" }).click();
    await page.getByRole("button", { name: new RegExp(`^${name}: lift`) }).click();
    await page.getByRole("button", { name: new RegExp(`^${name}: Cast`) }).click();
  };
  // Ignite Disorder: how many targets, the targets, then how much of the 3 damage goes to the first (CR 601.2d).
  await cast("Ignite Disorder");
  await expect(page.getByText("How many targets for Ignite Disorder?")).toBeVisible();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await page.getByRole("button", { name: /^Elite Vanguard: Target/ }).click();
  await page.getByRole("button", { name: /^Veteran Armorsmith: Target/ }).click();
  await expect(page.getByText("How much of 3 to Elite Vanguard?")).toBeVisible();
  await page.getByRole("button", { name: "2", exact: true }).click();
  // Two to the 2/2, one to the 2/3: the Vanguard dies.
  await expect.poll(async () => (await board(page))?.cards.some((c) => c.name === "Elite Vanguard")).toBe(false);

  // Fireball: X is a row of numbers; Escape backs out of the cast.
  await cast("Fireball");
  await expect(page.getByText("Choose X for Fireball")).toBeVisible();
  await expect(page.locator(".prompt-choices.numbers button")).not.toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByText("Choose X for Fireball")).toBeHidden();

  // Pithing Needle: as it enters, name a card, every name in the database, found by typing.
  await cast("Pithing Needle");
  // It usually resolves by itself (the host passes for the caster, the opponent lets it resolve); if a stop asks
  // first, pass it. A pass button can be gone by the time it's pressed: then the loop looks again.
  for (let i = 0; i < 8 && !(await page.getByText("Name a card").count()); i++) {
    const pass = page.getByRole("button", { name: /^(Resolve|Pass|Next)/ });
    if (await pass.count()) await pass.click({ timeout: 2_000 }).catch(() => undefined);
    await page.waitForTimeout(400);
  }
  await expect(page.getByText("Name a card")).toBeVisible();
  await page.getByRole("searchbox", { name: "Filter the choices" }).fill("shivan");
  await page.getByRole("button", { name: "Shivan Dragon", exact: true }).click();
  await expect(page.getByText("Name a card")).toBeHidden();
  await expect.poll(async () => (await board(page))?.cards.some((c) => c.name === "Pithing Needle")).toBe(true);
});
