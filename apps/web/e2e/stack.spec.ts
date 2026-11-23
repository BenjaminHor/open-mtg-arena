// The whole stack at the right (M3-04c slice 6): with full control on, three objects wait on it, the top large and
// the rest peeking out above it; an ability is a panel with its own text, and each object's card view names what
// it targets. Art is refused, so each card shows its drawn face.

import { expect, type Page, test } from "@playwright/test";

type Board = { cards: { id: string; name: string; zone: string; y: number; ability?: boolean; typeLine: string }[] };
const board = (page: Page) => page.evaluate(() => (window as unknown as { __board?: Board }).__board ?? null);
const stackOf = async (page: Page) => ((await board(page))?.cards ?? []).filter((c) => c.zone === "stack");

test.beforeEach(async ({ page }) => {
  await page.route("https://cards.scryfall.io/**", (route) => route.abort());
});

test("draws every object on the stack, an ability as its own panel, and each one's targets in its view", async ({
  page,
}) => {
  await page.goto("/?fixture=stack");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("switch", { name: /Full control/ }).click();
  await page.keyboard.press("Escape");
  const cast = async (name: string) => {
    await page.getByRole("button", { name: "Open your hand" }).click();
    await page.getByRole("button", { name: new RegExp(`^${name}: lift`) }).click();
    await page.getByRole("button", { name: new RegExp(`^${name}: Cast`) }).click();
  };
  await cast("Lightning Bolt");
  await page.getByRole("button", { name: /^Elite Vanguard: Target/ }).click();
  await cast("Giant Growth");
  await page.getByRole("button", { name: /^Elite Vanguard: Target/ }).click();
  await page.getByRole("button", { name: /^Prodigal Pyromancer: / }).click();
  await page.getByRole("button", { name: /^Opponent: Target/ }).click();

  await expect
    .poll(async () => (await stackOf(page)).map((c) => c.name))
    .toEqual(["Lightning Bolt", "Giant Growth", "Prodigal Pyromancer"]);
  const [bolt, growth, top] = await stackOf(page);
  expect(top?.ability).toBe(true);
  expect(top?.typeLine).toBe("Activated ability");
  // Each one under the top peeks out above it, a name strip higher.
  expect((growth?.y ?? 0) < (top?.y ?? 0) && (bolt?.y ?? 0) < (growth?.y ?? 0)).toBe(true);
  // "Stack 3" lists them all, the next to resolve first.
  await page.getByRole("button", { name: /^The stack, 3 objects/ }).click();
  const sheet = page.getByRole("dialog", { name: "The stack" });
  await expect(sheet.getByRole("listitem")).toHaveCount(3);
  await expect(sheet.getByRole("listitem").first()).toContainText("Resolves next");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  // Every object takes "i" for its card view: the ability's own text, and what each targets.
  await page.getByRole("img", { name: "Prodigal Pyromancer ability" }).focus();
  await page.keyboard.press("i");
  const view = page.getByRole("dialog", { name: "Prodigal Pyromancer" });
  await expect(view).toContainText("Activated ability");
  // Its own line, not the whole card ({T} is drawn as a symbol).
  await expect(view).toContainText("This creature deals 1 damage to any target.");
  await expect(view).toContainText("Your opponent");
  await page.keyboard.press("Escape");
  await page.getByRole("img", { name: "Giant Growth" }).focus();
  await page.keyboard.press("i");
  await expect(page.getByRole("dialog", { name: "Giant Growth" })).toContainText("Elite Vanguard");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
