// Playing by touch, mouse and keyboard (M3-04b): every action through the cards and the HUD's controls, never a list of
// actions. Runs at desktop size and at the folded phone in landscape with touch (playwright.config.ts).

import { expect, type Page, test } from "@playwright/test";

type Board = {
  cards: {
    id: string;
    name: string;
    zone: string;
    mine: boolean;
    attacking: boolean;
    blocking: string[];
    x: number;
    y: number;
    width: number;
  }[];
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

/**
 * Plays a seeded game to its end through the screen's controls alone, pressing one each time round: a prompt choice,
 * else a card that does something, else the main button. `how` is how a control is pressed: a touch tap, a mouse
 * click, or the keyboard (focus it, then Enter).
 */
async function playWholeGame(page: Page, how: "tap" | "click" | "keyboard") {
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
    const press = async (control: typeof main) => {
      const options = { timeout: 2_000 };
      if (how === "tap") await control.tap(options);
      else if (how === "click") await control.click(options);
      else {
        await control.focus(options);
        await page.keyboard.press("Enter");
      }
    };
    const tryPress = (control: typeof main) => press(control).catch(() => undefined);
    if (await prompt.count()) await tryPress(prompt.first());
    else if (await cards.count()) await tryPress(cards.first());
    else if (await main.count()) await tryPress(main);
    else await page.waitForTimeout(100);
    await page.waitForTimeout(40);
  }
  await expect(page.getByRole("status")).toBeVisible();
}

test("plays a whole game through the board and HUD alone: touch taps on the phone, mouse clicks on the desktop", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await playWholeGame(page, testInfo.project.name === "phone" ? "tap" : "click");
});

test("plays a whole game by the keyboard alone: every control reached by focus and pressed with Enter", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "phone", "the keyboard is the desktop's");
  test.setTimeout(120_000);
  await playWholeGame(page, "keyboard");
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

test("All Attack picks every creature that can attack, a double tap included; the main button then finishes", async ({
  page,
}) => {
  await page.goto("/?fixture=attack");
  for (let i = 0; i < 5; i++) {
    if (await page.getByRole("button", { name: "All Attack" }).count()) break;
    await page
      .getByRole("button", { name: /^Next/ })
      .click({ timeout: 2_000 })
      .catch(() => undefined);
    await page.waitForTimeout(300);
  }
  // A double tap: the second lands where Undo appears once a creature is attacking. It mustn't take one back.
  await page.getByRole("button", { name: "All Attack" }).dblclick();
  await expect(page.getByRole("button", { name: /^4 Attackers/ })).toBeEnabled();
  await page.waitForTimeout(400);
  await expect(page.getByRole("button", { name: /^4 Attackers/ })).toBeEnabled();
  // One creature stays home: a tap on an attacker takes it out (the app takes back and re-picks, D-158).
  await page.getByRole("button", { name: /^Llanowar Elves: don't attack/ }).click();
  await expect(page.getByRole("button", { name: /^3 Attackers/ })).toBeEnabled();
  // Clear Attacks, in All Attack's place, empties the declaration; All Attack is back to fill it again. (A press right
  // after the app's last step is ignored as a double tap would be: a person's next press comes later.)
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Clear Attacks" }).click();
  await expect(page.getByRole("button", { name: /^No Attacks/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "All Attack" })).toBeVisible();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "All Attack" }).click();
  await expect(page.getByRole("button", { name: /^4 Attackers/ })).toBeEnabled();
  await page.getByRole("button", { name: /^4 Attackers/ }).click();
  await expect.poll(async () => (await board(page))?.cards.filter((c) => c.mine && c.attacking).length).toBe(4);
});

test("drag to play: a land dragged up onto the table is played, a spell is cast, a short drag puts it down", async ({
  page,
}) => {
  await page.goto("/?fixture=mid-game");
  await expect(page.getByRole("button", { name: /^Next/ })).toBeVisible();
  const handCard = async (name: string) => {
    const cards = (await board(page))?.cards ?? [];
    const card = cards.find((c) => c.name === name && c.zone === "hand") as unknown as
      | { x: number; y: number; width: number }
      | undefined;
    if (card === undefined) throw new Error(`no ${name} in hand`);
    return { x: card.x + card.width / 2, y: card.y + 20 };
  };
  // Up by `up` pixels, or, with `up` left out, all the way onto the table: above the open hand (D-158).
  const drag = async (name: string, up?: number) => {
    const at = await handCard(name);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x, up === undefined ? 60 : at.y - up, { steps: 8 });
    await page.mouse.up();
  };
  const onField = async (name: string) =>
    (await board(page))?.cards.filter((c) => c.name === name && c.zone === "battlefield").length ?? 0;
  const mountains = await onField("Mountain");
  await drag("Mountain");
  await expect.poll(() => onField("Mountain")).toBe(mountains + 1);
  // Not far enough: back into the hand, nothing played.
  await drag("Lightning Bolt", 30);
  await expect(page.getByText("Choose a target for Lightning Bolt")).toHaveCount(0);
  await drag("Lightning Bolt");
  await expect(page.getByText("Choose a target for Lightning Bolt")).toBeVisible();
});

test("the card view: a right-click or a long-press shows a card large with its hangers; Escape or a tap closes it; a resting mouse previews", async ({
  page,
  isMobile,
}) => {
  await page.goto("/?fixture=mid-game");
  await expect(page.getByRole("button", { name: /^Next/ })).toBeVisible();
  const onBoard = async (name: string, zone = "battlefield") => {
    const card = (await board(page))?.cards.find((c) => c.name === name && c.zone === zone) as unknown as
      | { x: number; y: number; width: number; height: number; tapped: boolean }
      | undefined;
    if (card === undefined) throw new Error(`no ${name} in ${zone}`);
    return { x: card.x + card.width / 2, y: card.y + Math.min(card.height / 2, 30), tapped: card.tapped };
  };
  const view = (name: string) => page.getByRole("dialog", { name });
  if (isMobile) {
    // A long-press: touch events through the browser's own input, as a finger would (Playwright's touchscreen only taps).
    const cdp = await page.context().newCDPSession(page);
    const longPress = async (at: { x: number; y: number }) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at.x, y: at.y }] });
      await page.waitForTimeout(600);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(400);
    };
    await longPress(await onBoard("Deadly Recluse"));
    // Letting go doesn't close it.
    await expect(view("Deadly Recluse")).toBeVisible();
    await expect(view("Deadly Recluse").getByText("Summoning sick")).toBeVisible();
    await expect(view("Deadly Recluse").getByText("Deathtouch", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).tap();
    await expect(view("Deadly Recluse")).toHaveCount(0);
    // On a card a tap acts on (Llanowar Elves taps for mana): the release is looking, never also a tap.
    await longPress(await onBoard("Llanowar Elves"));
    await expect(view("Llanowar Elves")).toBeVisible();
    expect((await onBoard("Llanowar Elves")).tapped).toBe(false);
    await page.getByRole("button", { name: "Close" }).tap();
    // A hand card, with the hand open: looking neither lifts it nor, once closed by a tap on the backdrop, the hand.
    await page.getByRole("button", { name: "Open your hand" }).tap();
    await longPress(await onBoard("Giant Growth", "hand"));
    await expect(view("Giant Growth")).toBeVisible();
    await page.touchscreen.tap(20, 200);
    await expect(view("Giant Growth")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open your hand" })).toHaveCount(0);
    await expect(page.getByText(/^Tap again/)).toHaveCount(0);
    return;
  }
  const recluse = await onBoard("Deadly Recluse");
  await page.mouse.click(recluse.x, recluse.y, { button: "right" });
  await expect(view("Deadly Recluse")).toBeVisible();
  await expect(view("Deadly Recluse").getByText("Summoning sick")).toBeVisible();
  await expect(view("Deadly Recluse").getByText("Reach", { exact: true })).toBeVisible();
  // Focus is on Close, so a key press can't reach a card behind the view.
  await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(view("Deadly Recluse")).toHaveCount(0);
  // Nothing was picked or opened by the right-click: the card's own menu didn't come up.
  await expect(page.getByRole("menu")).toHaveCount(0);
  // The keyboard: "i" on a focused card, even one no tap acts on (the opponent's), and focus comes back after.
  const vanguard = page.getByRole("img", { name: "Elite Vanguard" });
  await vanguard.focus();
  await page.keyboard.press("i");
  await expect(view("Elite Vanguard")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(view("Elite Vanguard")).toHaveCount(0);
  await expect(vanguard).toBeFocused();
  // A mouse resting on a card shows the same as a preview, gone when the mouse leaves.
  const elves = await onBoard("Llanowar Elves");
  await page.mouse.move(elves.x, elves.y);
  await expect(page.locator(".card-view.preview")).toBeVisible();
  await expect(page.locator('.card-view.preview img[alt="Llanowar Elves"]')).toHaveCount(1);
  await page.mouse.move(400, 5);
  await expect(page.locator(".card-view.preview")).toHaveCount(0);
  // Escape with a preview up does what it would without one: here, close the open hand.
  await page.getByRole("button", { name: "Open your hand" }).click();
  const bolt = await onBoard("Lightning Bolt", "hand");
  await page.mouse.move(bolt.x, bolt.y);
  await expect(page.locator(".card-view.preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".card-view.preview")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open your hand" })).toBeVisible();
});
