# MTG Arena match interface: behaviour and layout research

For a fan project's touch-first match UI. Behaviour and layout only, described in my own words. Nothing here describes or copies Arena's art, frames, icons or sounds.

First pass 2026-11-22; second pass 2026-11-22 (same day, wider network).

## What changed in the second pass

- **Many more sources opened.** The official help centre (mtgarena-support.wizards.com) blocks browsers behind a bot check, but its public article API worked.
  - All 160 help-centre articles were downloaded and keyword-searched, including about 100 sets of patch notes from 2024 to November 2026.
  - About 130 older official patch notes and news posts (2018 to 2021) were downloaded through the devtrackers.gg mirror and keyword-searched.
  - Only the matching passages were read closely; the rest was not read line by line. Draftsim, the ASAP guide (whose text is the same as MTG Arena Zone's "Playing a Match"), Hipsters of the Coast, StarCityGames, mtgaassistant, TechRadar, Wargamer, PC Gamer, Steam threads and Playbite were opened too.
- **About 40 screenshots examined** (desktop 2020 to 2024, mobile 2021, browsers, combat, the stack, the settings screen). There is a new section, "Layout from screenshots".
- **The tag legend has changed.** [R] now means "page or image opened and read", with the kind of source named inline. Most [S] bullets were upgraded, and some were corrected.
- **Corrections:**
  - The PC Gamer "slight tilt" article is from 2017, not 2018. Current screenshots still show a slight tilt.
  - Timeouts sit under each player's name in the left corners, not above the pass button. The rope also runs across the middle of the battlefield.
  - The extra Powered Cube timeout comes from a 2026 patch note, not the Cube article.
  - The best-of-three clock is 30 minutes per player, counting only while that player has priority.
  - "Auto Assign Combat Damage" is missing from one 2024–25 screenshot of the gameplay settings, though Draftsim's Oct 2025 text still lists it. It may have been removed with the Foundations change.
  - Draftsim's "bottom left" placement for the phase ladder is contradicted by its own screenshots, which show bottom right.
- **Gaps filled:**
  - main button labels, with dates
  - "Attack with All" / "ALL ATTACK" / "NO ATTACK"
  - where the stack, mana pool, library and graveyard, near-hand castables, timeouts and settings sit, on desktop and on 2021 mobile
  - targeting arrows ("intention lines")
  - the modal "Choose One" browser
  - the surveil browser, the order-triggers browser (first trigger on the right, last on the left) and the "Choose a Card Name" browser
  - manual ordering of replacement effects
  - how the phase ladder is drawn and how stops are set
  - the in-client shortcut table
  - timer and match-clock details
  - opponent pacing
  - the game-log situation
  - some sound and animation evidence
- **Still open:** the X picker, choosing a player, the scry and library-search browsers, the mulligan screen layout, the current mobile layout, and an official list of default stops.

## How to read this report

**Network and access (second pass).**

Opened successfully:

- magic.wizards.com
- devtrackers.gg (it mirrors Wizards' official patch notes and forum posts)
- draftsim.com, sites.google.com (the ASAP guide), hipstersofthecoast.com, articles.starcitygames.com, mtgaassistant.net, techradar.com, wargamer.com, pcgamer.com, steamcommunity.com, playbite.com, mtgarena.pro
- i.imgur.com and i.ytimg.com (images only)
- mtgarena-support.wizards.com, through its public `/api/v2/help_center/` endpoint only; the HTML pages return a bot challenge

Could not be read:

- mtgazone.com: HTTP 429 (rate limited) on every page after the first. "Playing a Match" was read, and it has the same text as the ASAP guide.
- reddit.com: the search API returns 403.
- feedback.wizards.com: now a private forum that needs sign-in.
- aetherhub.com: 403.
- destructoid.com: 403.
- newsweek.com: 406.
- tcgplayer.com: the page is built by JavaScript, so the HTML holds no text.
- github.com: 403.
- mtg.fandom.com: skipped, as instructed.

**Every bullet carries an evidence tag:**

- **[R] Read.** I opened the cited page or image and it says this. The kind of source is named inline:
  - *official* means Wizards: an article, a help-centre page, or patch notes, including the devtrackers mirror of patch notes;
  - *community* means a guide, forum post or review;
  - *screenshot* means I looked at the image myself; its date and source are given.
- **[S] Search summary only.** The page could not be opened (see the list above). Probable; verify it before relying on it for a spec.
- **[U] Unverified.** No Arena source was found. The claim comes from general familiarity with the client. A link on a [U] bullet only ever points to a non-Arena source, given for context.

**Watch for single sources.** MTG Arena Zone's "Playing a Match" and the [ASAP guide's "Playing a match"](https://sites.google.com/view/asap-bg-to-mtga/playing-a-match) are the same text by the same author (2020–21). This report cites them together as "MTG Arena Zone/ASAP". The three Draftsim articles all come from one site. Treat each group as one source, not as corroboration.

**Dates matter.** The sources run from the 2017–18 closed beta to November 2026, and Arena changes often. Each source is dated inline. Older labels are kept, with their dates.

**Wizards' own words for the interface pieces** (all [R], official):

- **Examine (the "Examined" view):** the enlarged pop-up you get by hovering, right-clicking or long-pressing a card.
- **Browser:** a modal overlay that shows a set of cards to choose from or arrange (scry, search and so on).
- **Hanger:** an extra panel attached beside a card, such as the back face of a double-faced card or the list of dungeons.
- **Badge:** a small counter or status marker drawn on a card.
- **Phase ladder:** the phase indicator.
- **Planeswalker zone:** the area of the battlefield that holds planeswalkers and battles.
- **Near-hand castables:** cards you can cast from somewhere other than your hand, shown next to the hand.
- **Intention line:** the line or arrow drawn from a card toward the cursor or a target. The name appears in 2020 patch notes: [Jun 5 2020](https://devtrackers.gg/magic-arena/p/da3984ab-jun-5-1-08-01-00-patch-notes) and [Oct 22 2020](https://devtrackers.gg/magic-arena/p/142b7b01-oct-22-1-13-00-00-patch-notes).
- **Smart stops / smart priority:** the hand-written exceptions where the client gives you priority anyway (see §3).

Using the same names in our own code and docs would help.

---

## 1. Board layout

### Overall split
- [R] The screen is split horizontally. Your side is the bottom half and the opponent's is the top. Your hand runs along the bottom edge, and the shared battlefield fills the centre. The opponent's life total, hand, library, graveyard, exile and timeouts are at the top. *(community, 2018: [Hipsters of the Coast](https://www.hipstersofthecoast.com/2018/03/how-to-play-mtg-arena-the-in-match-screen/). Confirmed by every 2020–2024 screenshot; see "Layout from screenshots".)*
- [R] Lands sit in a row nearest your hand and library, and creatures sit closer to the centre line. *(community, 2018: Hipsters. Screenshots 2020–2024.)*
  - In current screenshots your lands are a row at the **left** of your half.
  - Your other non-creature permanents (artifacts, enchantments, tokens such as Food or Treasure) form a separate group at the **right** of your half, at the same height as the lands.
  - The opponent's side mirrors this: their lands at top left, their other non-creature permanents at top right.
- [R] Planeswalkers sit at the far right of the battlefield. In 2018 Hipsters put them "above the pass priority and end turn buttons". *(community, Hipsters 2018.)* The mtgaassistant peculiarities guide, the page cited for this in the first pass, doesn't say it; Hipsters does.
- [R] Arena has a dedicated planeswalker zone. When battles were added it was rebuilt so that a battle on the protector's side wouldn't push that player's planeswalkers off-screen. *(official: [We Put Battles on MTG Arena](https://magic.wizards.com/en/news/mtg-arena/we-put-battles-on-mtg-arena-what-was-that-like))*
  - [R] The official 2023 battle screenshot shows the battle at the right edge of the upper half. *(screenshot, same article)*
- [R] Battles sit on the **protector's** side of the battlefield, not the caster's. *(official: same article)*
  - Playtests found entering on the caster's side felt better for enter-the-battlefield effects, but combat felt right only when the battle sat on the protector's side, and combat won.
  - Moving the battle from one side to the other during the game was rejected as confusing.
  - **Lesson for us:** a permanent's controller and the side it is drawn on can differ.
- [R] Battles are drawn landscape on the battlefield and portrait on the stack and in hand. In the Examined pop-up their orientation depends on context: landscape when examined from hand or the battlefield, portrait inside a browser such as scry. *(official: same article)*
- [R] Artifact tokens (including Incubator tokens) go in the same part of the battlefield as other artifact tokens; non-creature permanents are grouped by type. *(official: [MOM release notes](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-release-notes-march-of-the-machine))*
- [R] On mobile, the opponent's cosmetic pet was moved to the right so it no longer hides the opponent's lands. *(official: [SotG Strixhaven, Apr 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-strixhaven-school-mages-2021-04-07))*
  - [R] In 2024–2026 Wizards fixed avatar portraits and battlefield effects that covered cards in the opponent's hand, and added a "Hybrid Battlefields" toggle to turn off an animated battlefield effect. *(official: [Patch Notes 2026.55.0](https://mtgarena-support.wizards.com/hc/en-us/articles/45254706663956-Patch-Notes-2026-55-0) and later help-centre patch notes)*
  - **Decoration must never cover game state.**
- [R] On some unsupported mobile aspect ratios the phase ladder covered the artifact/enchantment area while targeting, so it was moved further right. *(official: [Patch Notes 2025.47.00](https://mtgarena-support.wizards.com/hc/en-us/articles/36424033319060-Patch-Notes-2025-47-00))*

### Avatar, life total, phase ladder
- [R] Each player's portrait sits on the centre line of their half: yours just above your hand, the opponent's at the top edge. The life total is a number in a disc just below each portrait. *(community, Hipsters 2018; screenshots 2020–2024)*
- [R] **The phase ladder.** Short ladders of phase icons flank each portrait. A second, larger copy for the current turn sits at the bottom right, just above the main button.
  - The current step lights up.
  - The ladder is orange on your turn and blue on the opponent's.
  - *(screenshots: Draftsim 2020–2025, official 2021 and 2023; community: MTG Arena Zone/ASAP "Playing a Match")*
  - [R] The compact ladder has five icons:
    - a small diamond for the beginning phase (upkeep and draw together; the stop tooltip reads "Stop at Upkeep and Draw")
    - a card shape for the first main phase
    - crossed swords for combat
    - a card shape for the second main phase
    - a diamond for the end step
  - [R] During combat it expands to show the combat steps: a sword for declare attackers, a shield for declare blockers, a burst for combat damage, and a diamond for end of combat. *(screenshots, Draftsim 2025)*
  - **Conflict:** Draftsim's tips text says the current-turn ladder is at the bottom **left**. Its screenshots, its settings article, MTG Arena Zone/ASAP and an official 2023 screenshot all show bottom **right**. Trust bottom right.
- [R] A "Show Phases" gameplay setting and the `L` key toggle whether the phase icons are shown. *(screenshot of the in-client gameplay settings and its shortcut table, via [Draftsim settings](https://draftsim.com/mtg-arena-settings/), 2024–25; community, [Draftsim shortcuts](https://draftsim.com/mtg-arena-keyboard-shortcuts/))*
- [R] On mobile, the avatars' size and position were changed to suit the narrower, wider-aspect screen. *(official: [SotG Jan 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21); community: [Wargamer, Jan 2021](https://www.wargamer.com/magic-the-gathering-arena/android-release))*
  - In the official 2021 mobile screenshots the portraits are small, in the top-left and bottom-left corners. The life totals stay at the top centre and bottom centre. This rests on two frames from 2021 only.
- [R] Player names sit in the corners: the opponent's at top left, yours at bottom left. The timeout count (an hourglass with "xN") is just under or above each name. *(screenshots 2020–2024)*

### Library, graveyard, exile, sideboard
- [R] Your library and graveyard sit together in the **bottom-left corner**, left of the hand. The library is a face-down pile, and the graveyard shows its top card face up beside it. The opponent's library and graveyard are mirrored in the **top-right corner**. *(screenshots 2020–2024; community, Hipsters 2018: "to the left of your hand you have your library, and space for your graveyard and exile zone")*
  - Exile: Hipsters (2018) puts it with the graveyard. I did not see a separate exile pile in any screenshot.
- [R] Hovering a library shows how many cards are left, and clicking a graveyard or exile opens a view of every card in it. This works for the opponent's zones too. *(community, Hipsters 2018)*
  - On mobile, tapping a zone opens a browser showing its known cards and its count. *(official, SotG Jan 2021)*
  - One small 2021 frame appears to show a count panel when hovering the library; that reading is my inference from a thumbnail-sized view. *(screenshot, official SotG Jan 2021)*
  - [R] A 2024 fix allowed opening the graveyard and exile browsers even without priority. *(official: [Patch Notes 2024.39.2](https://mtgarena-support.wizards.com/hc/en-us/articles/29340673846676-Patch-Notes-2024-39-2))*
- [R] Right-click zooms a card "everywhere": the stack, the graveyard and the battlefield. *(community: [beginner's guide, hotkeys](https://sites.google.com/view/beginners-guide-to-mtga/hotkeys-and-using-the-interface); first-pass source [Aetherhub](https://aetherhub.com/Article/MTG-Arena-Shortcuts-and-hidden-hotkeys) answered 403)*
- [R] Clicking your library also gives you a button to switch to viewing your sideboard mid-match. This was added for Learn/Lessons. *(official: SotG Strixhaven; 2021 patch notes mention "the sideboard browser … when viewing it mid-game (by clicking on your library)", [Apr 19 2021](https://devtrackers.gg/magic-arena/p/4c77569c-apr-19-2021-04-patch-notes))*
- [R] **Near-hand castables.** Cards you can play from the graveyard or exile sit next to your hand with a gap between groups, and they can be played by dragging or by double-clicking. *(community: [MTG Arena Zone/ASAP "Playing a Match"](https://mtgazone.com/playing-a-match/))*
  - Hipsters (2018) and mtgaassistant (2023) both say they appear to the **right** of the hand, and the official 2021 foretell screenshot shows that.
  - mtgaassistant adds that the glow colour tells you which zone the card comes from. *([mtgaassistant](https://mtgaassistant.net/Article/MTG-Arena-Match-Playing-Peculiarities-Guide))*
- [R] Foretold cards show up as near-hand castables. Examining one shows hangers for its modified cost, that it entered exile this turn, and that it is private information. The opponent sees a card back. *(official + screenshot, SotG Jan 2021)*
- [R] Newer examples of the same pattern:
  - a prepared spell "will appear next to the player's hand" *(official: [Patch Notes 2026.58.0](https://mtgarena-support.wizards.com/hc/en-us/articles/48215493589396-Patch-Notes-2026-58-0))*
  - a card exiled with Thief of Sanity shows up for the opponent as a card back in your near-hand castables *(official: [Apr 25 2019](https://devtrackers.gg/magic-arena/p/657c7027-apr-25-0-14-00-00-patch-notes))*
- [R] After you cast a Wish, a single option appears next to your hand; dragging it out opens a browser of your sideboard. *(official: [AFR digital release notes](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-digital-release-notes-adventures-forgotten-realms-2021-07))*
- **The general pattern:** anything you can currently use from outside your hand appears as an extra card or "option" lined up beside the hand. You use it the same way you use a hand card.

### How permanents are drawn
- [R] On the battlefield a card is shrunk to a compact landscape-ish frame. It shows a name bar, an art crop, a power/toughness box at the bottom right, and keyword icons at the bottom left.
  - When there are several keywords, or a keyword has no icon, an ellipsis icon shows and you open the card to read them. *(community: MTG Arena Zone/ASAP; [Steam thread](https://steamcommunity.com/app/2141910/discussions/0/4842022494091506330); screenshots)*
- [R] Some keywords get whole-card effects as well as icons:
  - flying cards float above the board
  - hexproof shows a large hex pattern
  - ward has its own overlay
  - indestructible gives a glowing toughness
  - reach has a glow
  - summoning sickness has an overlay
  - "can't be countered" spells get a flowing red border on the stack
  - copies are tinted differently
  - red auras usually mean prevention or "can't" effects
  - *(official: [Strixhaven notes](https://magic.wizards.com/en/news/mtg-arena/strixhaven-mtg-arena-digital-release-notes-2021-04-07), Apr 25 2019 patch notes; community: mtgaassistant, Steam thread, MTG Arena Zone/ASAP)*
  - [R] On mobile, hexproof and protection effects now also show over a player's avatar when the player has them. *(official: [Patch Notes 2024.36](https://mtgarena-support.wizards.com/hc/en-us/articles/25736956145556-Patch-Notes-2024-36))*
  - [R] Players affected by damage prevention get a glow around their life total; planeswalkers get it around their loyalty. *(official, Apr 25 2019)*
- [R] **Tapped permanents: confirmed, and still true.**
  - The 2017 closed-beta PC Gamer piece complained that tapped cards are only tilted slightly, greyed out, and carry a large tap symbol. *([PC Gamer, Sep 2017](https://www.pcgamer.com/its-a-good-sign-that-our-biggest-magic-the-gathering-arena-concerns-are-cosmetic/))*
  - Screenshots from 2020 to 2024 still show exactly that: a tilt of roughly 10–15°, darkened art, and a large curved-arrow tap mark over the card.
  - [mtgarena.pro](https://mtgarena.pro/guides/hearthstone-players-guide-for-magic-the-gathering-arena/), cited in the first pass, was opened and doesn't describe the tilt.
  - A 2018 pro player wished attacking cards "would become fully tapped". *(community: [StarCityGames, Nov 2018](https://articles.starcitygames.com/articles/a-pro-players-perspective-on-magic-arena/))*
- [R] **Marked damage is shown as lowered toughness.** The toughness drops and is highlighted, which misleads people about the rules. Relatedly, if a creature assigns combat damage equal to its toughness, its power shows in blue and equal to its toughness during combat. *(community: MTG Arena Zone/ASAP "Playing a Match")*
  - [R] Changed power/toughness values are drawn in blue. *(screenshots)*
- [R] **Badges.** A number or status shown on the card itself, updated live. Examples:
  - toxic N on creatures with toxic
  - a corrupted badge that tracks the opponent's poison count and changes look at 3
  - storm count on storm cards in hand and on the storm trigger
  - expected counters for Fractal-making spells
  - "life gained this turn"
  - a Ring-bearer badge
  - counts for cards that care about numbers of objects; for example, a dies-trigger badge shows the creature's last power
  - a converge badge that fills by colours spent
  - a spellbook marker on a creature with a prepared spell
  - *(official: [ONE](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-release-notes-phyrexia-all-will-be-one), Strixhaven, [LTR](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-release-notes-the-lord-of-the-rings-tales-of-middle-earth) release notes; Apr 25 2019 patch notes; Patch Notes 2026.58.0)*
- [R] When a creature becomes the Ring-bearer, its rules text updates automatically to include the abilities the Ring grants. **Displayed text is derived, not printed.** That fits our layer-system invariant. *(official, LTR notes)*
  - [R] Altered mana costs are shown on the card with a sparkle. *(community, MTG Arena Zone/ASAP)*
  - [R] Examining a copy shows the original beside it. *(official, Apr 25 2019)*
- [R] Prototype cards on the battlefield keep a prototype-specific look; in other zones they look normal. *(official: [SotG BRO](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-the-brothers-war))*
- [R] Double-faced cards and battles carry a hanger showing the back face ("Transforms Into"). *(official + screenshot, battles article 2023)*
  - [R] Cards under "can't be activated" or "can't be cast" effects get a hanger naming the effect and its source. *(official, Apr 25 2019)*
- [R] **Identical permanents are grouped into one pile with an "xN" count.** This was upgraded from [U].
  - Wizards' patch notes talk about tokens "stacking" and "unstacking": identical tokens with different ability durations must not stack; a creature affected by Suncleanser unstacks from unaffected ones; stacked Mercenaries unstack on mobile when you activate the top one. *(official: [Patch Notes 2024.36](https://mtgarena-support.wizards.com/hc/en-us/articles/25736956145556-Patch-Notes-2024-36), [2024.38.40](https://mtgarena-support.wizards.com/hc/en-us/articles/28319351389076-Patch-Notes-2024-38-40), [2024.36.10](https://mtgarena-support.wizards.com/hc/en-us/articles/25947277047572-Patch-Notes-2024-36-10))*
  - Screenshots show piles of lands and tokens with an "x4" or "x8" badge at the top left.
  - [R] You can click a pile's number to send the whole pile to attack or block. *(community, Draftsim tips; MTG Arena Zone/ASAP)*
  - The first pass's only source was a fan project ([tolaria PR](https://github.com/fil-donadoni/tolaria/pull/9096)); the official notes above replace it.
  - [U] The exact rule for what counts as identical (tapped state, damage, counters) is not documented. The 2024 notes show that any visible difference, including duration, splits a pile.
- [U] Auras and Equipment are drawn tucked behind the permanent they're attached to, slightly offset.
- [R] Counters appear as a small round numbered badge at the top right of the card (blue in screenshots). The power/toughness readout turns blue when modified. *(screenshots 2023–2024)*
- [R] A planeswalker's loyalty box greys out once it has used its activation for the turn. A planeswalker that becomes a creature keeps showing its loyalty in the normal counter spot. *(official, Apr 25 2019)*
  - [U] Damage dealt to a planeswalker visibly counts its loyalty down.

**Design note.** Arena's layout puts:

- creatures facing each other across the centre
- lands at the back left of each half
- other non-creature permanents at the back right
- planeswalkers and battles at the right edge

Libraries and graveyards are in the outer corners, point-symmetric. Information that would otherwise need reading (counts, poison, conditional state) is pushed into badges, glows and hangers.

---

## 2. The hand

- [R] Your hand is a row of cards along the bottom edge with their bottom halves off-screen. Hovering a card brings it fully onscreen. Right-clicking any card anywhere shows a large zoomed view. *(community: Hipsters 2018, beginner's guide; screenshots)*
- [R] An "Evergreen Keyword Reminders" setting adds floating reminder panels for keywords when you hover a card.
  - Current Examined views also show keyword panels beside the card, ending with a "right-click for more information" hint.
  - *(screenshots of the in-client settings and examine view, Draftsim 2024–25; official screenshots, AFR 2021)*
- [R] **Playing a card.** Drag it from the hand up onto the battlefield and release, and auto-tap pays for it. Cards castable from the graveyard or exile can also be double-clicked. *(community: StarCityGames 2018, MTG Arena Zone/ASAP; official, mobile FAQ. The first-pass source, [Hipsters closed beta](https://www.hipstersofthecoast.com/2018/03/how-to-play-the-mtg-arena-closed-beta-client-overview/), was opened and covers deck building, not casting.)*
- [R] **Previewing the payment.** If you drag a spell over the battlefield and hold it without releasing (or sometimes just hover it), the lands auto-tap would use are highlighted. *(community: MTG Arena Zone/ASAP; beginner's guide)*
- [R] Playable cards get a highlight. The normal playable highlight is bright blue.
  - A land that would enter tapped because its condition isn't met gets a softer or yellow "warning" highlight instead. Its Examined view also shows an "Enters Tapped" note.
  - **The highlight carries information beyond "you can play this".**
  - *(official: Strixhaven notes, AFR notes and AFR screenshot; community: Hipsters 2018, mtgaassistant)*
- [R] Optional additional costs such as kicker, bargain and foretell use a shared casting interface. You cast the spell normally, then you're asked whether to pay the extra cost. *(official: [WOE release notes](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-release-notes-wilds-of-eldraine); SotG Jan 2021)*
  - [R] For foretell, the choice is a "Choose One" browser (see §7). *(screenshot, SotG Jan 2021)*
- [R] Right-clicking a card that ventures into the dungeon shows the dungeon in its hanger; further clicks cycle. On mobile, a long-press shows all three dungeons. *(official: AFR notes; [SotG AFR](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-adventures-forgotten-realms-2021-07-02); community: MTG Arena Zone/ASAP)*
- [R] **Hover is visible to the opponent.** When you hover a card in your hand, or a card in a graveyard or on the battlefield, the opponent sees that card light up with a white frame. Players read this as a tell and bluff with it. *(community: [Steam thread](https://steamcommunity.com/app/2141910/discussions/0/734750159229956628/?ctp=2), [Draftsim tips](https://draftsim.com/mtg-arena-tips-and-tricks/))*
  - **Decide deliberately** whether our UI broadcasts hovers. For an LLM or AI opponent this doesn't matter, but for future human-vs-human play it does.
- [R] The opponent's hand is shown as card backs along the top edge, partly off-screen, behind their portrait. *(screenshots 2020–2024)*
  - [U] A card the opponent picks up lifts out of the row, and revealed cards are shown face up. Some 2023 frames show small eye markers on your own hand cards, probably meaning "known to the opponent"; that reading is my inference.
- [R] A toast-style notice appears at the bottom right above the ladder, for example "You will need to discard down to 7 at the end of your turn". *(screenshots: mtgaassistant 2023; official video thumbnail 2024)*

---

## 3. Turn flow and priority

### Default auto-passing ("smart" priority)
- [R] By default Arena does **not** give you priority in your own upkeep, in your own end step, or in response to your own triggered abilities. "Smart priority" is a set of hand-written exceptions where the client stops for you anyway. *(official: [Announcements Oct 27 2025](https://magic.wizards.com/en/news/mtg-arena/announcements-october-27-2025))*
  - Examples: a Saga's chapter III trigger, an evoke sacrifice trigger, a blinked permanent returning at your end step, floating mana in your end step, an opponent's Sheoldred in your upkeep, an opponent's Goblin Rabblemaster during their first main phase, and a permanent flashed in during your end step.
  - For anything else unusual, Wizards' advice is to set a stop or use full control.
  - [R] Patch notes keep adding "smart stops". Examples:
    - a stop at the beginning of your end step when you got new cards in hand
    - a stop to bounce a Saga while its last chapter is on the stack
    - stops with the sacrifice ability of Scam on the stack
    - a stop in upkeep before drawing from an empty library if you can put something into it
    - a 2025 change so you can always respond in the main phase to cards with beginning-of-combat or end-step triggers
    - a fix where stops were shown during extra turns but not honoured
    - *(official: help-centre patch notes [2024.41.00](https://mtgarena-support.wizards.com/hc/en-us/articles/30874525628436-Path-Notes-2024-41-00), [2025.45.00](https://mtgarena-support.wizards.com/hc/en-us/articles/35189384915476-Patch-Notes-2025-45-00), [2025.52.00](https://mtgarena-support.wizards.com/hc/en-us/articles/41292678660244-Patch-Notes-2025-52-00) and others)*
    - **Smart stops are an ever-growing list of special cases.**
- [R] More generally, the game skips priority passes where neither player can take a legal action, taking the cards in hand into account. When you hold an instant you can cast, you are stopped at every window where you could cast it, which tells the opponent something. *(community: StarCityGames 2018; Draftsim; MTG Arena Zone/ASAP)*
- [R] Even with auto-pass, the client still stops when the opponent casts a spell or activates an ability and you could respond. Obligatory decisions are never auto-passed. *(community: [Steam thread](https://steamcommunity.com/app/2141910/discussions/0/4629232489537311442/))*
- [R] Arena auto-resolves forced choices with no alternative. For example, with one card left and a discard effect, it discards that card without asking. *(community, StarCityGames 2018)*

### The main button and pass modes
- [R] **Position and shape.** One large pill-shaped primary button sits at the **bottom right**.
  - Under it is a small sub-label naming where pressing it will take you: "To Combat", "To Main", "To End".
  - Below and right of it is a small round fast-forward button (two chevrons) for pass turn.
  - Pressing the main button (or `Space`) passes priority.
  - *(screenshots 2020–2024, desktop and 2021 mobile; official 2021 and 2023 screenshots)*
  - On 2021 mobile the round button sits to the **left** of the main button.
- [R] **Labels seen, with dates:**

  | Label (sub-label) | When | Source |
  | --- | --- | --- |
  | **Next** (To Combat) | your first main phase | screenshots 2020–2024 (Draftsim, mtgaassistant, official SotG Jan 2021) |
  | **End Turn** (To End) | your second main phase | official screenshots 2021 (SotG) and 2023 (battles article) |
  | **Resolve** | a spell is on the stack and you have priority | official 2021 mobile screenshot |
  | **Pass** (To Combat / To Main) | in full control; the button turns blue-violet | Draftsim screenshots 2024–25 |
  | **Opponent's Turn** | greyed button during the opponent's turn, with an "Auto-Passing" label beside the lit fast-forward button | Draftsim screenshots 2020–2024 |
  | greyed hourglass, no text | waiting on the opponent mid-combat | official video thumbnail 2024 |
  | **Done** / **Cancel** / **Yes** / **No** / **Submit** / **Decline** | browsers and prompts | §7 |
  | **COMBAT**, **END** | your main phases | 2018 closed beta ([StarCityGames](https://articles.starcitygames.com/articles/a-pro-players-perspective-on-magic-arena/)) |
  | **ALL ATTACK**, **NO ATTACK** | declare attackers | 2018 closed beta (StarCityGames) |
  | "1 ATTACKER" | replaced ALL ATTACK when only one creature could or had to attack | 2018 closed beta (StarCityGames) |

  - The colour pattern (orange normally, blue-violet in full control, grey while waiting) is read from a handful of frames, so treat it as an inference.
  - [U] The current wording for declare attackers and declare blockers was not seen in any screenshot.
  - The first-pass source for the button, [TCGplayer](https://www.tcgplayer.com/content/article/How-to-Play-Magic-The-Gathering-Arena/6ad595a2-2207-40b3-8c1e-0fc18032fb2a/), returns only a JavaScript shell, so it stays unread.
- [R] Contextual key hints appear just above the ladder while relevant, each a label with a key-cap: "Undo [Z]", "Full Control [Ctrl]", "Hold Full Control [Ctrl]", "Show Phases [L]". *(screenshots, Draftsim 2024)*
- [R] **The in-client shortcut table** (Options → Gameplay, desktop; screenshot via Draftsim, 2024–25). Wording is paraphrased only where needed.

  | Key | Action |
  | --- | --- |
  | `Space` | Pass Priority |
  | `Enter` | Pass Until Response |
  | `Shift+Enter` | Pass Turn |
  | `Ctrl` | Full Control |
  | `Shift+Ctrl` | Hold Full Control |
  | `Z` | Undo |
  | `Q` twice | Float All |
  | hold `Q` | Quick Tap |
  | `L` | Show Phases |
  | `Tab` | Cycle Chat |
  | hold `Alt` | Show Collection Overlay (draft only) |

  - `Esc` opens the Options menu, which includes Concede. *(community, beginner's guide)*
  - The keys can't be rebound, and only the left Shift works in combinations. *(community, ASAP "Using Arena", beginner's guide)*
- [R] **Pass until response** (`Enter`) keeps passing until the opponent does something. Used before combat, it can skip your own combat. *(community, Draftsim shortcuts)*
- [R] **Pass turn** (`Shift+Enter`, Shift-clicking the main button, or the round fast-forward button) passes through the rest of the turn even if you could respond. You can still be asked to block. The button then un-latches. *(community: [Steam "Resolve All" thread](https://steamcommunity.com/app/2141910/discussions/0/597404077749453144/), StarCityGames 2018, Draftsim)*
- [R] **"Resolve All"** resolves only what is already on the stack; anything added afterwards needs another press. *(community, Steam thread)*
  - Official 2020 notes mention unchecking "Resolve All" while the stack resolves, so it is a toggle. *(official: [Jan 16 2020](https://devtrackers.gg/magic-arena/p/a807d203-jan-16-1-04-00-patch-notes))*
  - [U] Where the toggle sits on screen.
- [R] Stops still apply while pass turn is active. *(community, MTG Arena Zone/ASAP)*
- [R] **Cancel Attacks** clears every attacker you've chosen so far. **Cancel Blocks** (2021) does the same for blocks. *(official: SotG AFR, Jul 2021)*

### Phase stops
- [R] **Setting a stop.** A removed [Steam guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2980093457) (low quality) says to click the phase icons at the bottom right. More generally: click a phase icon on the ladder beside a portrait: your own ladder for your turn, the opponent's for theirs. For the current turn you can also use the ladder at the bottom right. Setting a stop is like full control for that one step. *(community: MTG Arena Zone/ASAP; Draftsim; [Playbite](https://www.playbite.com/q/how-do-you-setup-your-stops-on-mtg-arena); official, Jan 16 2020: "set a stop in the current phase by selecting it on the phase ladder")*
  - A set stop is marked by a light outline around the icon. *(screenshot: hexagonal outline on the "Upkeep and Draw" diamond, Draftsim 2025; beginner's guide: "light circle")*
  - The ladder's click targets were enlarged in 2019. *(official: [May 2 2019](https://devtrackers.gg/magic-arena/p/33af015d-may-2-0-14-01-00-patch-notes))*
- [R] Set stops well ahead of time: "the server is sometimes ahead of the animations in the client". *(community, MTG Arena Zone/ASAP)*
- **How long a stop lasts: partly resolved.**
  - [R] Draftsim, both articles (one source), says a ladder stop lasts only until that step is reached and the toggle disappears as you move out of it, so you must set it again each turn. *(community, Draftsim shortcuts and tips)*
  - No source describes persistent per-game stops, and the settings screen has no stop configuration. Treat ladder stops as single-use.
- [R] **Default stops: partly resolved; no official list.**
  - The beginning phase runs straight through to main phase 1 unless you set an upkeep stop. *(community: [Steam thread](https://steamcommunity.com/app/2141910/discussions/0/574929940135414276/))*
  - In 2018 a pro described "three total stops" on his own turn: first main, combat, second main. *(community, StarCityGames 2018)*
  - Draftsim (2025) says the game passes your turn after you play a land if you have nothing else to do. So even main-phase stops depend on having a play, which matches the smart-priority rules above.
  - The "Arena-style default stops" list in a GitHub PR belongs to a **fan project** ([link](https://github.com/tony-hagerty/mtg-arena-edh/pull/39)).

### Full control
- [R] Full control turns off auto-passing, so you get every priority window. Since 2020 it also turns off auto-tap while it's on. *(official: Jan 16 2020; community: Draftsim settings)*
  - [R] It also turns off automatic trigger ordering. *(community, Draftsim settings)*
  - [R] It is needed to spend mana from the pool in a particular way. *(community, MTG Arena Zone/ASAP)*
- [R] How to toggle full control:
  - On mobile, press and hold your avatar; since mid-2021, press-and-holding the phase ladder works too. *(official: [Mobile FAQ](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-mobile-faqs-2021-01-28), SotG Jan 2021, SotG AFR)*
  - It can be toggled while a browser is open. *(official: [Apr 15 2021](https://devtrackers.gg/magic-arena/p/611d8ec9-apr-15-2021-04-patch-notes))*
- [R] On desktop, `Ctrl` is "Full Control" and `Shift+Ctrl` is "Hold Full Control". *(screenshot of the in-client table; community: [Flipside](https://flipsidegaming.com/blogs/magic-blog/mtg-arena-hot-keys-and-using-the-interface) and the beginner's guide, both saying Ctrl is temporary and Ctrl+Shift permanent)*
  - The lasting mode is Shift+Ctrl, as most sources said, and the first-pass conflict about which is which is resolved.
  - **Still a conflict:** how long plain `Ctrl` lasts. One priority pass (ASAP "Using Arena"), or "until you pass it" ([mtgaassistant shortcuts](https://mtgaassistant.net/Article/All-MTG-Arena-Keyboard-Shortcuts))? The current step (first-pass summaries)? The turn (Draftsim tips)?
  - A Steam user reports that leaving plain `Ctrl` on while away made the game burn through timeouts phase by phase, which suggests it lasts at least the turn. *(community, Steam thread)*
- [R] Holding full control is visible to the opponent and slows play, which is itself a signal. Draftsim recommends using stops instead, so as not to stand out. *(community, Draftsim tips; MTG Arena Zone/ASAP)*
- [S] Players report bugs where full control switches itself off. *([feedback.wizards.com](https://feedback.wizards.com/forums/918667-mtg-arena-bugs-product-suggestions/suggestions/40011379-full-control-mode-deactivates-itself); the forum is now private, so stays [S].)*
  - [R] The current known-issues list has full-control oddities, for example selecting several cards for a "choose one" effect. *(official: [Known Issues List](https://mtgarena-support.wizards.com/hc/en-us/articles/360000091646-Known-Issues-List))*

### Timers and timeouts
- [R] **Turn timer and rope.** Each decision has limited time, and every action you take extends it. When time is nearly out, a burning rope appears.
  - If it burns out you spend one timeout; with none left, the client passes priority for you.
  - You start with none, and earn one for every three turns finished without the rope appearing.
  - *(community: MTG Arena Zone/ASAP; Hipsters 2018; [devtrackers 2019 thread](https://devtrackers.gg/magic-arena/p/cefe625b-did-they-changed-the-rope-timeout-system); mtgaassistant)*
  - The first-pass conflict ("runs faster the more actions you take") was not supported anywhere.
  - [R] The game grants extra time after you pick targets for triggered abilities and copied spells. *(official, [0.09 beta patch notes, 2018](https://devtrackers.gg/magic-arena/p/b545ab55-0-09-00-patch-notes))*
- **Rope length: conflict.**
  - Hipsters (2018) says just over a minute before the rope appears, then about 45 seconds.
  - mtgaassistant (2023) says the rope lasts 30 seconds.
  - The 2019 devtrackers thread says each timeout adds 30 seconds.
- **Where the rope is drawn: conflict, and it may have changed.**
  - Hipsters (2018) and Draftsim's roping article say a fuse around your avatar.
  - StarCityGames (2018) describes a fuse burning across the middle of the battlefield from right to left.
  - Screenshots from 2023–2024 show a glowing line across the full width of the board's centre line, with an hourglass at its left end. When a timeout is spent, a large "TIMEOUT USED" banner appears across it. *(screenshot, mtgaassistant 2023; Draftsim 2024)*
- [R] **Where timeouts are shown.** An hourglass with "xN" sits under each player's name: the opponent's at top left, yours at bottom left above your name. *(screenshots 2020–2024)*
  - In 2018 it was above the pass and end-turn buttons, with three progress dots. *(Hipsters 2018)*
  - In 2020 the opponent's timeout display was moved to stop it hiding under other elements. *(official: [Jul 16 2020](https://devtrackers.gg/magic-arena/p/b198b75f-jul-16-1-11-00-patch-notes))*
  - Modes without timeouts don't show them. *(official: [May 27 2021](https://devtrackers.gg/magic-arena/p/d1983990-may-27-2021-05-00-patch-notes))*
- **Inactivity: conflict.**
  - [R] One 2019 reply says about two minutes of complete inactivity concedes the game at the end of your turn. *(community, devtrackers 2019 thread)*
  - mtgaassistant says two automatic passes in a row lose the game.
  - A 2024 Steam post says the game runs the timer out three times before the player loses.
- [R] On mobile you see your own timeouts by tapping your avatar, and the opponent's by tapping theirs. *(official, SotG Jan 2021)*
- [R] **Match clock (best-of-three), corrected.** Since May 2019 each player has a 30-minute match clock that counts down only while they have priority.
  - Hover your timer (lower left, above your name) to see it.
  - It becomes visible automatically when time runs low: under 10 minutes in game 1, 8 in game 2, 6 in game 3.
  - Running out loses the match, and the clock doesn't run while sideboarding.
  - *(official: [May 23 2019](https://devtrackers.gg/magic-arena/p/3e5941f1-may-23-0-15-00-00-patch-notes))*
  - Qualifier events use the same per-player 30-minute clock, even in best-of-one. *(official: [Qualifier info](https://magic.wizards.com/en/news/mtg-arena/qualifier-play-ins-and-qualifier-weekend-information))*
- [R] Powered Cube players start with one extra timeout. *(official: [Patch Notes 2026.56.10](https://mtgarena-support.wizards.com/hc/en-us/articles/46389734064532-Patch-Notes-2026-56-10). The [Cube article](https://magic.wizards.com/en/news/mtg-arena/arena-powered-cube-draft) cited in the first pass was opened and doesn't mention timeouts.)*
- [S] Player complaints: the timer doesn't pause during long opponent animations, clicking through mid-resolution decisions doesn't reset it, and roping is common. *([feedback.wizards.com](https://feedback.wizards.com/forums/918667-mtg-arena-bugs-product-suggestions/suggestions/46355857-timer-issue), private now)*
  - [R] Draftsim and its commenters describe roping and long animations as stalling tactics. *([Draftsim on roping](https://draftsim.com/mtg-arena-roping/))*
- [R] Since August 2026 there is in-game reporting with an "Inactivity" category. *(official: [Player reporting](https://magic.wizards.com/en/news/mtg-arena/player-reporting))*
  - "Report Player" sits next to "Report a Bug" in the in-match options menu. *(official: [Patch Notes 2026.62.20](https://mtgarena-support.wizards.com/hc/en-us/articles/52654279128084-Patch-Notes-2026-62-20))*

**Design note.** For a single-player game against an AI or LLM, the rope and timeouts mostly don't apply. The parts worth copying are:

- the smart priority model: skip windows where you have nothing to do, with explicit exceptions
- per-step stops that can be set separately for your turn and the opponent's
- a one-gesture full control toggle
- one primary button whose sub-label always says where pressing it will take you

---

## 4. Casting

- [R] **Auto-tap is a setting, and full control overrides it.**
  - The "Auto Tap" checkbox can only be changed while a match is on.
  - With it off, or in full control, you tap sources yourself.
  - *(community: Draftsim settings; official: Jan 16 2020)*
  - [R] The payment step has an **"Auto Pay"** button that hands the rest of the payment to auto-tap. *(official, Strixhaven notes)*
  - [R] Since 2019 an AutoTap button appears whenever a payment isn't handled automatically. Hovering it highlights what it would use, including creatures to tap and Treasures to sacrifice; clicking it pays. *(official: Apr 25 2019, May 23 2019)*
  - [R] On mobile, the gameplay settings are behind a cog at the top right of the battlefield. Desktop has the same cog at the top right. *(official: Mobile FAQ; screenshots)*
- [R] When the kind of mana spent matters, auto-tap always pauses to show its plan and waits for confirmation. *(official: SotG BRO)*
- [R] **Paying.** While you pay, a banner near the top centre reads "Pay" followed by the cost. The button area at the bottom right shows **Cancel** plus any alternative, such as "Pay With Treasure". *(official screenshot, AFR notes 2021)*
  - [R] After you cast Channel, its effect appears as a clickable item at the left of the screen. *(official: Strixhaven notes)*
  - [R] Emblems also sit at the left, and the emblem and stack panels each have an arrow above them to move them aside. *(community, beginner's guide)*
- [R] For Phyrexian mana you choose how to pay each symbol. *(official, Strixhaven notes)*
- [R] Ward doesn't change the cost. Targeting a ward creature shows a confirmation pop-up about paying the ward cost. *(official, SotG Strixhaven)*
  - [R] Separately, the "Enable Gameplay Warnings" setting shows an **"Are You Sure?"** dialog, with the question and Yes/No buttons, before a likely mistake such as targeting your own creature with removal. *(screenshot + community, Draftsim settings)*
- [R] Proliferate pre-selects targets by a sensible rule and asks you to confirm. **Arena's pattern is to pre-fill a smart default and ask for confirmation.** *(official, ONE notes)*
- [R] A spell's chosen X is shown on the spell while it's on the stack. *(official, Strixhaven notes)*
  - [U] **How X is chosen is still unconfirmed.** I believe it's a numeric picker with up and down arrows, capped at what you can afford.
    - A 2020 fix stopped a connected game controller from making "X values change rapidly", which hints at an increment control. *(official: [Dec 10 2020](https://devtrackers.gg/magic-arena/p/5c3dc78a-dec-10-1-15-00-00-patch-notes))*
    - Auto-tap used to suggest X=0 even when the card forbids it. *(official, help-centre patch notes)*
    - Neither settles the layout.
- [R] **Mana shortcuts on desktop:**
  - double-tap `Q` (Float All) taps every non-creature mana source
  - hold `Q` and click a source (Quick Tap) taps all sources with the same name, mana creatures included
  - `Z` undoes a tap or a target choice until the spell is finally cast; it can't undo mid-resolution
  - you can click mana symbols in the floating mana pool to choose which mana to spend
  - *(screenshot of the in-client table; community: Draftsim shortcuts, MTG Arena Zone/ASAP)*
- [R] **The mana pool** floats beside your portrait, just above the hand, as small mana symbols with counts. Restricted or special mana (snow, for example) carries an extra mark. The opponent's floats below their portrait. *(community, MTG Arena Zone/ASAP; screenshots 2021–2024, which show it on either side of the portrait)*
- [R] On mobile, an undo arrow appears at the top right when an action can be undone. *(official, SotG Jan 2021)*
  - A 2026 known issue notes the desktop "Undo" button can clip under the card stack when auto-tap is off. *(official, Known Issues List)*
- [S] Auto-tap complaints: it saves utility lands too eagerly, spends painlands on generic costs, and handles restricted mana awkwardly. *(feedback.wizards.com, [restricted mana](https://feedback.wizards.com/forums/918667-mtg-arena-bugs-product-suggestions/suggestions/47573615-using-use-this-mana-only-for-x-mana-on-mtga-is-v) and [Inga and Esika](https://feedback.wizards.com/forums/918667-mtg-arena-bugs-product-suggestions/suggestions/48151598-inga-and-esika-requires-me-to-tap-3-creatures-rath); the forum is private now)*
  - [R] Community guides confirm the same list. *(mtgaassistant; MTG Arena Zone/ASAP)*
  - [R] Wizards' own patch notes keep fixing auto-tap cases, once adding "Autotap does not know how to play Magic". *(official: [Patch Notes 2026.59.0](https://mtgarena-support.wizards.com/hc/en-us/articles/49377952595860-Patch-Notes-2026-59-0))*
- [R] **Targeting.** Upgraded from [U] in part.
  - Arena draws an "intention line", a curved glowing arrow, from the source toward the cursor and then to the target. *(official: 2020 patch notes on intention lines; 2026 note on drawing an extra "targeting arrow"; screenshots: a blue arc from an aura on the stack to its target, SotG Jan 2021; arcs from a d20 ability, AFR 2021)*
  - Hovering an item on the stack shows its targets. *(community, MTG Arena Zone/ASAP)*
  - When something needs targets under the stack panel, the stack collapses automatically. *(official, Apr 25 2019)*
  - Targeting a card in a graveyard shows a highlight and a tooltip. *(community, beginner's guide)*
  - A fanned blocker pile spreads out on hover so you can target one card in it. *(official, Apr 25 2019)*
  - [U] Whether non-legal objects are dimmed, and how a player is targeted (clicking the portrait is likely). The first pass's only description was a fan project ([tolaria issue](https://github.com/fil-donadoni/tolaria/issues/9163)).
- [R] **Modal and alternative choices** use a "Choose One" browser (see §7). *(screenshot, official SotG Jan 2021)*
  - [R] Alternative costs use a "cost selection browser". *(official, Jan 16 2020)*
  - [R] "May cast" effects use a "Select Card to Cast" browser whose button reads "Decline" until you pick a card. *(official, 0.09 beta 2018)*
  - [U] That charms and other "choose one or more" spells use the same browser.
- [R] **Cancelling.** While you pay, a Cancel button is offered. *(official screenshot, AFR 2021; community: TechRadar on mobile, "thanks to the cancel button")*
  - Rules-wise this reverses the casting process (CR 601.2e; CR 734, "Handling Illegal Actions").
  - [U] Dragging the card back to the hand also cancels.
- [R] **Activated abilities.** Click the permanent and pay; for example, boast is activated by clicking the card. *(official, SotG Jan 2021)*
  - Cards with more than one ability open an "ability selection browser". *(official, help-centre patch notes)*
  - Mana abilities are used by clicking the land.

---

## 5. The stack

- [R] **Position.** The stack sits on the **right**, mid-height, as a large readable card for the top item, overlapping the planeswalker area. *(community, MTG Arena Zone/ASAP: "The stack appears on the right"; screenshots 2020–2024, desktop and mobile)*
  - A small arrow tab above or beside it collapses it. On mobile that arrow is at the top of the screen. *(community, MTG Arena Zone/ASAP; beginner's guide; official, Apr 25 2019)*
  - A very large stack expands to a full view in the middle of the screen. *(community, MTG Arena Zone/ASAP)*
  - [R] When you have something you could add to it, or are in full control, the item stays there until you respond. *(community, MTG Arena Zone/ASAP)*
  - [R] Arena zooms stack items automatically. *(community, Draftsim tips)*
- [R] **Opponent pacing.** An opponent's spell or ability is shown on the stack for at least a minimum time, cut in the 2018 beta from 1 second to 0.4 seconds. The scry interaction shown to the opponent was also sped up. *(official, 0.09 beta patch notes)*
- [R] Abilities on the stack (and in browsers) are drawn as card-shaped panels with the source's art, an "Ability" type line, the ability text, and a rounded shield-like bottom. *(screenshots: trigger-ordering browser 2023; surveil browser 2021; AFR 2021)*
- [R] Battles are drawn upright on the stack, and a compleated planeswalker on the stack shows its reduced loyalty. *(official: battles article; ONE notes)*
- [R] Triggers can carry count badges. A storm trigger, for example, shows its copy count, and Blast Zone shows its counter count on the stack. *(official: Strixhaven notes; Apr 25 2019)*
- [R] A trigger lists every ability chosen for it. *(official: [SotG Nov 2020](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-november-2020-11-10))*
- [R] **Ordering triggers.** The "Auto Order Triggered Abilities" setting is on by default. With it off (or in full control) you get an **"Order Triggers"** browser.
  - The title and the line "Drag triggers to choose resolution order" sit at the top.
  - The triggers are in a horizontal row, with **"Last" at the left and "First" at the right**.
  - A **Done** button sits at the bottom centre.
  - You only order your own triggers.
  - *(screenshot + community, Draftsim settings 2023; community, ASAP "Using Arena")*
  - [R] With manual ordering, identical triggers no longer stack together. *(official, Jan 16 2020)*
- [R] **Responding.** If the opponent casts something and you could respond, you get priority with **Resolve** on the main button. To respond to *your own* spell or trigger you generally need full control or a stop, unless a smart priority exception applies. *(official 2021 screenshot; community: Steam thread, Draftsim)*
- [R] **"May" abilities** are phrased as questions, for example "Discard a card?". *(official, Apr 25 2019)*
  - [U] They are answered with Yes/No buttons. Yes/No buttons are confirmed for the gameplay warning dialog.
  - [R] A "may" ability that targets makes you choose the target first and then decline. *(community, MTG Arena Zone/ASAP)*
- [R] Cards that let you choose something as they resolve bring up a browser. The dungeon "Venture" browser says "Select the next room to move into", highlights the rooms you can choose, shows the source ability on the right, and offers "View Battlefield". *(official + screenshots, AFR notes)*

---

## 6. Combat

- [R] **Declaring attackers.** Click each creature, or tap it on mobile. *(official: Mobile FAQ; TechRadar)*
  - [R] Clicking a creature into combat played a sword-being-drawn sound (2018). *(community, StarCityGames)*
- [R] **Attack all / no attacks.** The 2018 beta offered "ALL ATTACK" or "NO ATTACK" and then let you adjust by hand; forced attacks changed the label to "1 ATTACKER". *(community, StarCityGames, Nov 2018)*
  - The official 2018 beta patch notes also name an "All Attack" button, and say it used to default to "1 Attacker" when a creature had to attack; that was changed so it stays "All Attack". *(official, [0.09 beta patch notes](https://devtrackers.gg/magic-arena/p/b545ab55-0-09-00-patch-notes))*
  - Since April 2019, "Attack with All" with an opposing planeswalker present asks you to pick a target for the attackers instead of sending them all at the player. *(official, Apr 25 2019)*
  - [U] The current label wording.
- [R] **Cancel Attacks** clears every attacker you've picked so far. *(official, SotG AFR)*
- **Attacking planeswalkers and battles.**
  - [R] When the opponent has a planeswalker you could attack, you choose for each attacker whether it attacks the player or the planeswalker. You can select several attackers and then click their target, declaring them in a batch. *(official, Apr 25 2019; community: MTG Arena Zone/ASAP, Draftsim, [Playbite](https://www.playbite.com/q/how-do-you-attack-a-planeswalker-in-mtg-arena))*
  - [R] Battles needed this attack-target UI to handle restrictions such as "can attack a player or planeswalker, but not a battle". *(official, battles article)*
- [R] **Declaring blockers.** On mobile, tap your creature and then the attacker, or drag from blocker to attacker. **Cancel Blocks** resets every block. *(official: SotG Jan 2021, Mobile FAQ, SotG AFR)*
  - [R] Several blockers can be assigned in one go by selecting them and then clicking the attacker. A pile can block by dragging its number. *(community, Draftsim tips; MTG Arena Zone/ASAP)*
  - [R] Hovering the defending player shows which attackers are still unblocked. *(community, MTG Arena Zone/ASAP)*
  - [R] A 2024 official video frame shows blockers connected to the attacker by glowing lines across the centre, and the expanded combat ladder with the blockers icon lit. *(screenshot: thumbnail of Wizards' "Removal of Damage Assignment Order" video)*
  - [R] Declaring blockers played a sound of metal on shields (2018). *(community, StarCityGames)*
- **Damage assignment.**
  - [R] Foundations (November 2024) removed damage assignment order. On Arena you now split a blocked attacker's damage among its blockers however you like. Wizards' example: a 4/4 blocked by a 2/3 and a buffed 8/6 puts 3 damage on the 2/3 and 1 on the 8/6. *(official: [Announcements Nov 11 2024](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-announcements-november-11-2024); [Foundations release notes](https://magic.wizards.com/en/news/feature/foundations-release-notes))*
  - The video is on YouTube (`s3QVRWPm57E`, "Removal of Damage Assignment Order"). Only its thumbnail could be viewed.
  - **Don't build a "damage assignment order" step.** CR 510.1c lets the attacker divide damage among its blockers as they choose, with no ordering. Trample is CR 702.19.
  - [R] Arena prompts for manual assignment whenever there's more than one legal way to assign damage. *(official, ONE notes)*
  - [R] One narrow exception: where a replacement effect would force manual damage assignment, a trampler assigning 31 or more damage is exempt. *(official: [Patch Notes 2025.49.50](https://mtgarena-support.wizards.com/hc/en-us/articles/39138904836116-Patch-Notes-2025-49-50))*
  - The "Auto Assign Combat Damage" setting described in 2021–2023 guides is not in the 2024–25 settings screenshot. It was probably removed with the Foundations change; that is my inference.
  - [U] The prompt's layout.
- [R] First strike and double strike are shown as keyword icons; when a card has many keywords they are abbreviated. *(community, Steam thread)*
- [U] With first strike involved, the client runs and animates two combat damage steps. The ladder's damage icon suggests one icon for both.

---

## 7. Decisions and prompts

- [R] **Mulligan.** You tap or click Keep or Mulligan. After a mulligan, once you keep, you select cards and drag them to your library. *(official, SotG Jan 2021)*
  - Rules: the London mulligan; you always draw 7 and bottom one card per mulligan when you keep (CR 103.5).
  - [R] The mulligan screen shows the opponent's decision (kept, mulliganed to 6, and so on). *(official, 0.09 beta)*
  - [R] It has a "View Battlefield" option. *(official: [May 21 2020](https://devtrackers.gg/magic-arena/p/5a2c2651-may-21-1-08-00-00-patch-notes))*
  - [R] It briefly shows the back faces of modal double-faced cards in your opening hand. *(official: [Sep 17 2020](https://devtrackers.gg/magic-arena/p/338fb64e-sep-17-1-12-00-patch-notes))*
  - [S] In best-of-one, an opening-hand "smoothing" algorithm deals more than one candidate hand and gives you the most balanced. A removed Steam guide claims three hands are compared, which is low quality.
  - [U] The screen layout.
- [R] **Browsers: the common frame.** Seen in the surveil, order-triggers, "Choose One", venture and "Choose a Dungeon" browsers. *(screenshots: Draftsim 2021/2023, official SotG Jan 2021, AFR 2021)*
  - The board is dimmed behind the browser.
  - A large title (the action name) sits at the top centre, with a one-line instruction under it.
  - The cards to act on sit in the middle, in labelled areas where relevant.
  - The source card or ability is shown at the right edge.
  - A **"View Battlefield"** button sits at the top right; this replaces my first-pass guess of a "hide" toggle.
  - The confirm button (**Done**, or **Cancel** when nothing is chosen) is centred at the bottom, overlapping the top of the hand.
  - Cards in a browser are always drawn upright. *(official, battles article)*
- [R] **Surveil browser.** Two labelled drop areas, "Graveyard" (left) and "Library" (centre, wider). All the cards start in Library, and you drag each to the pile you want, then press Done. *(screenshots + community, [Draftsim on surveil](https://draftsim.com/mtg-surveil/), 2021)*
  - [U] Scry works the same way with Top and Bottom areas. A 2021 patch note mentions "Mill and Scry hangers", but not the browser.
- [R] **Submit buttons.** When an effect allows "0 or more" selections, **Submit** is blue until you reach the maximum and then turns orange. *(official, Apr 25 2019)*
  - Prompt buttons can carry consequences. Sylvan Library's button, for example, tells you how much life you'll lose. *(official: [Patch Notes 2026.58.0](https://mtgarena-support.wizards.com/hc/en-us/articles/48215493589396-Patch-Notes-2026-58-0))*
- [R] Other named browsers in official notes:
  - a counter-removal browser: click counters to move them aside, click again to undo *(Apr 25 2019)*
  - a two-piles browser *(Jan 16 2020)*
  - a browser for choosing a combination of mana colours *(Aug 13 2020)*
  - a graveyard selection browser that stays open across multiple picks *(0.09 beta)*
  - the sideboard browser *(Apr 2021)*
  - a "View Mutations" browser *(Jul 16 2020)*
  - [U] Library search. Presumably the same frame with a scrollable row.
- [R] **"Choose One" browser** (modal and alternative choices).
  - The title is "Choose One", with "Click an option below to select it." under it.
  - Two or more options are shown side by side as cards, each with a label above (for example "Foretell").
  - Cancel sits at the bottom; View Battlefield at the top right.
  - Options you can't use right now are greyed out.
  - *(screenshot + official, SotG Jan 2021)*
  - "Choose a Dungeon" uses the same frame with the subtitle "Choose Options" and a Done button. *(screenshot, AFR 2021)*
- [U] **Choosing a player.** No source found. Most likely you click or tap the player's portrait.
  - [R] Hexproof and protection effects are shown on portraits, so portraits are targetable surfaces. *(official, Patch Notes 2024.36)*
- [R] **Naming a card.** A "Choose a Card Name" browser (used for Tamiyo, Collector of Tales and Diviner's Lockbox) has a text search; a 2020 fix let it find names with hyphens. *(official: [Jul 10 2019](https://devtrackers.gg/magic-arena/p/95de7fd2-jul-10-patch-notes); [Apr 16 2020](https://devtrackers.gg/magic-arena/p/c7070d00-apr-16-1-07-00-00-patch-notes))*
  - [U] Whether it shows autocomplete suggestions as you type.
- [R] **Ordering replacement effects.**
  - The "Auto Choose Replacement Effects" setting picks an order for you. *(screenshot of the in-client settings; community, ASAP "Using Arena")*
  - With it off you order them by hand; 2020 and 2025 notes fix display bugs "when manually ordering replacement effects". *(official: Jul 16 2020; [Patch Notes 2025.47.10](https://mtgarena-support.wizards.com/hc/en-us/articles/36424160989204-Patch-Notes-2025-47-10))*
  - The automatic order uses weights. Zone-changing replacements come first by default (2020), and Rebound goes before Omen (2026). *(official: Oct 22 2020; help-centre patch notes)*
  - [U] The manual browser's layout; presumably like Order Triggers.
- [R] **Pre-filled choices.** Proliferate and auto-tap pre-select and ask you to confirm; ward shows a confirmation pop-up. *(sources in §4)*
- [R] **Optional costs** (kicker, bargain, foretell) are a yes/no or Choose One choice made during casting. *(sources in §2)*

---

## 8. Feedback and feel

- [R] **The Examined view** (hover or right-click on desktop, long-press on mobile) is the main way to read a card in detail.
  - It is a large card near the left or centre, with hangers beside it: keyword explanations, "Creates Token" with the token, "Transforms Into" with the back face, and status notes such as "Entered the battlefield this turn", "Protector: Opponent", "Cost Modified", "Private Information" and "Enters Tapped".
  - It also shows flavour text, and the original printing when altered.
  - *(screenshots: Draftsim 2020, official 2021 and 2023; community: Draftsim tips, beginner's guide)*
  - Battle orientation changes by context, because a card suddenly appearing sideways in a browser was distracting. **Card zoom should be chosen to suit the context.** *(official, battles article)*
- [R] **Emotes.** Click your own avatar to open them (tap on mobile). They are a fixed set of short phrases. Context-sensitive replies pop up for a few seconds after the opponent emotes. You mute the opponent from their avatar. *(official: [SotG Mar 2020](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-march-2020-03-05), Mobile FAQ, [SotG 2024](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-of-the-game-2024), [Announcements Apr 14 2025](https://magic.wizards.com/en/news/mtg-arena/announcements-april-14-2025))*
  - [R] Emotes can be switched off with "Disable Emotes" in gameplay settings. *(screenshot of the in-client settings; community, Draftsim settings)*
  - [U] The base set includes a "Thinking…" phrase.
- **Opponent "thinking" indicator.**
  - [R] There is no explicit indicator. Players read the opponent's hover highlights (a white frame on cards they look at, including in graveyards) and the rope instead. *(community: Draftsim tips, Steam thread)*
  - [R] During the opponent's turn your main button greys out and reads "Opponent's Turn". Mid-combat it shows a greyed hourglass. *(screenshots)*
  - [R] How long an opponent's stack item stays visible is a tuned minimum (0.4 seconds since 2018). *(official, 0.09 beta)*
- **Game log / history.**
  - [R] Arena has **no in-client game log or replay**.
    - Players ask for match replays and an in-game action log. *(community: [Steam "Request: Match Replays"](https://steamcommunity.com/app/2141910/discussions/0/595134572710082320/))*
    - Third-party trackers fill the gap by reading the client's text log file. One tracker ([MTG Arena Tool](https://github.com/CodySchrank/MTG-Arena-Tool); GitHub answered 403) gives text-based replays, and 17lands gives Limited replays. *(community, [ASAP "Using Arena"](https://sites.google.com/view/asap-bg-to-mtga/using-arena), 2021)*
    - Draftsim (2025) says the client shares "next to zero statistics".
  - The "game log file" and "Detailed Logs" option in official support articles are diagnostic logs for bug reports, not a player-facing history.
  - [R] The only in-client look back is "View Battlefield" after a game ends. *(official, May 21 2020 patch notes)*
  - **This is the clearest place where we can beat Arena.** Our engine already emits events, so a readable log is cheap.
- [S] Reviewers praise the animations and say you can hold a button to stop and take in every interaction. *([Destructoid](https://www.destructoid.com/reviews/review-magic-the-gathering-arena/): 403, stays [S].)*
- [R] **Animations that are documented**, mostly from patch notes that tuned or fixed them:
  - exile (including paying exile costs) and mana production, updated or sped up *(official: 0.09 beta; [Feb 18 2021](https://devtrackers.gg/magic-arena/p/44fc2e4e-feb-18-2021-01-30-patch-notes))*
  - sacrificing several Treasures or Scions, batched into one quicker animation *(official: [Patch Notes 2026.63.0](https://mtgarena-support.wizards.com/hc/en-us/articles/53820137910932-Patch-Notes-2026-63-0) and earlier)*
  - coin flips, and a large d20 roll in the centre of the board *(official notes; AFR screenshot)*
  - special visual effects for mythic cards and new mechanics, such as amass and proliferate *(official, Apr 25 2019)*
  - "descend" animations *(official notes)*
  - in-game cinematics, which can be skipped by pressing and holding a skip button (2026) *(official, [Patch Notes 2026.54.40](https://mtgarena-support.wizards.com/hc/en-us/articles/45008515874324-Patch-Notes-2026-54-40))*
  - a "click impact" effect on the battlefield where you click *(official, Oct 22 2020)*
  - a "TIMEOUT USED" banner across the board *(screenshot)*
  - the playable glow, hover lift and flying float *(§1–2)*
  - Some effects were disabled on older phones for performance. *(official notes)*
  - [R] A 2018 pro player disliked that combat deaths "explode" with no record of who blocked whom. *(community, StarCityGames)*
    - **For us:** pair every animation with a lasting log line.
- [U] Animation beats not documented, worth matching in our own style:
  - casting: the card lifts from the hand, moves to the stack and settles
  - resolving: a permanent flies to its place; an instant or sorcery shows its effect, then goes to the graveyard
  - damage: a projectile or impact with a floating number
  - life change: the number ticks, with a pulse
  - card draw: the card slides from the library into the hand
  - a turn banner or highlight when the turn passes
- [R] **Sound.** Audio settings have separate volume sliders, including music and sound effects (SFX). There is also a "Play Audio While Minimized" option. *(community, Draftsim settings; official, 2020 patch notes and help-centre known issues)*
  - Events with documented sounds:
    - declaring an attacker (a sword being drawn) and declaring blockers (metal on shields) *(community, StarCityGames 2018)*
    - surveil, which has its own sound *(official, Aug 13 2020)*
    - some cards' own effects *(official notes)*
    - abilities on the stack *(official, Jan 16 2020)*
  - [U] Other cues from play experience: drawing, playing a land, casting by colour, creatures entering and dying, life loss and gain, start of turn, priority passing to you, the timer warning, and win and loss stings.
  - Our sounds must be original.

---

## 9. Mobile Arena (phone and tablet)

All [R], official, from the [SotG Jan 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21) and the [Mobile FAQ](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-mobile-faqs-2021-01-28) unless marked otherwise.

- **Same game, compact layout.** Clicks become taps and scrolls become swipes. Wizards committed to not simplifying gameplay on mobile. *(also SotG Strixhaven; Wargamer 2021)*
- **Hand "tucking".** The hand is usually tucked, half off-screen at the bottom.
  - Tapping it fans the cards out so they can be read and picked, covering most of the board; tapping the battlefield tucks it again.
  - The client also tucks the hand automatically when you can't play anything.
  - *(community, [Wargamer, Jan 2021](https://www.wargamer.com/magic-the-gathering-arena/android-release); [TechRadar, Mar 2021](https://www.techradar.com/news/mtg-arena-mobile-hands-on-with-phone-sized-fantasy-card-battles))*
- **Long-press = examine.** Long-press a card in play, or the top of either graveyard, to see it in detail. Board cards are small, so players long-press a lot. *(community, TechRadar)*
- **Zones:** tapping a zone (graveyard, library, exile) opens a browser of its known cards with a count.
- **Casting:** tap and hold to pick up the card, drag it over the battlefield, and release.
- **Mana:** tap lands yourself, or rely on auto-tap.
- **Combat:** tap creatures to attack. To block, tap your creature and then the attacker, or drag from blocker to attacker. *(also TechRadar)*
- **Full control:** press and hold your avatar, or (since mid-2021) the phase ladder. *(SotG AFR)*
- **Avatars as menus:** tap your own for emotes and timeouts, the opponent's to mute them or see their timeouts.
- **Undo:** an undo arrow appears at the top right.
- **Settings:** a cog at the top right of the battlefield.
- **Mulligan:** tap Keep or Mulligan, then tap to select cards and drag them to the library.
- **Layout tuning:**
  - Avatars were resized and moved for the wider aspect ratio.
  - The opponent's pet was moved right so it doesn't hide lands. *(SotG Strixhaven)*
  - Cards in hand were enlarged slightly on tablet. *(SotG AFR)*
  - On unusual aspect ratios the phase ladder was moved further right so it doesn't cover the artifact area. *(Patch Notes 2025.47.00)*
- **Dungeons:** long-press a venture card to see all three dungeons. *(SotG AFR)*
- **Context menus:** long-press is the general secondary-action gesture, for example on a friend (Report, Unfriend, Block). *(Player reporting)*
- [R] Reviewers on phones *(community, TechRadar, Mar 2021)*:
  - The touch controls are intuitive, with only one or two wrong taps, and the Cancel button stopped them from costing games.
  - A 6.8″ phone was easier than the 6.1″ iPhone, but the developers "keep the sides of the playing field clear" around notches.
  - Battlefield art becomes tiny, while creature stats stay readable.
  - **For us:** respect safe-area insets, keep stats legible at small sizes, and keep every mis-tap recoverable with cancel or undo.

---

## 10. What players praise and complain about

### Praise (copy)
- An easy, intuitive first game: drag to cast and auto-tap get new players going. *([Newsweek](https://www.newsweek.com/mtg-arena-beta-hands-impressions-1100546): 406, stays [S]. [R] community: StarCityGames 2018 praises the pace, the single button and auto-tap.)*
- Smooth, readable animations, and the option to slow down. *(Destructoid [S]; TechRadar [R] on mobile readability)*
- Automation handles the boring parts, and badges keep the important numbers in view. *([R] badge sources in §1; [R] a Steam thread where a player says the UI is the reason they can play at all)*
- Mobile is the full game with touch-friendly gestures. *([R] SotG Jan 2021; TechRadar)*

### Complaints (avoid)
- **Auto-pass surprises.** Pass modes skip steps you wanted, such as combat; behaviour feels inconsistent; you need full control to respond to your own things. *([R] community: Draftsim, Steam threads; [feedback.wizards.com](https://feedback.wizards.com/forums/918667-mtg-arena-bugs-product-suggestions/suggestions/39776722-game-just-skipped-through-my-turn) is private, [S])*
  - **Our response:** make the next stop visible ("will stop at: your end step") and make passes reversible within a moment where the rules allow it. Arena's sub-label ("To Combat") is a partial version of this.
- **Auto-tap mistakes** (see §4). Auto-tap should always be previewable and overridable, and it should pause whenever the choice of mana matters. Arena itself moved this way. *([R] BRO; the 2019 AutoTap button with hover preview)*
- **No game log or replay** (§8).
- **The timer feels unfair** and roping is common. *(§3)*
- **Readability:**
  - slightly tilted, dimmed tapped cards (still true)
  - damage shown as lowered toughness, which misleads people about the rules
  - keyword icons collapsing into an ellipsis
  - combat deaths with no record of who blocked whom
  - *([R] PC Gamer 2017, MTG Arena Zone/ASAP, Steam thread, StarCityGames 2018)*
- **Information leaks:** hover highlights and holding full control are visible to the opponent; so is how long you take on "automatic" actions. *([R] §2, §3; StarCityGames 2018)*
- **Trigger auto-ordering** "won't always succeed". *([R] ASAP "Using Arena")*

---

## Layout from screenshots

Images examined (all saved in the scratchpad, `arena-shots/`, not in the repo):

- Desktop matches, 2020–2024, from [Draftsim](https://draftsim.com/mtg-arena-keyboard-shortcuts/) (shortcuts, tips and settings articles) and [mtgaassistant](https://mtgaassistant.net/Article/MTG-Arena-Match-Playing-Peculiarities-Guide) (imgur, 2023)
- Official desktop shots from the [battles article](https://magic.wizards.com/en/news/mtg-arena/we-put-battles-on-mtg-arena-what-was-that-like) (2023), [AFR notes](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-digital-release-notes-adventures-forgotten-realms-2021-07) (2021), [SotG Jan 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21) (desktop Kaldheim shots and two mobile shots), and the thumbnail of Wizards' 2024 damage-assignment video
- Browsers: surveil (Draftsim 2021), Order Triggers (Draftsim 2023), Choose One / Choose a Dungeon / Venture (official 2021), "Are You Sure?" (Draftsim 2023)
- The in-client Options and Gameplay settings with the shortcut table (Draftsim, 2024–25)

Proportions are estimates from 16:9 desktop frames, as a share of screen width (W) and height (H).

### Desktop match screen (16:9), current client (2023–2024 frames)

```
+----------------------------------------------------------------------------------+
| opp name     [opp hand: card backs, partly off top edge]   opp library+gy  [cog] |
| hourglass xN               (opp portrait)                                         |
|                                [life]                                             |
|  [opp lands row ............]  ladder at portrait   [opp other permanents] [stack>|
|                                                                     (PW zone)    |
|                [opp creatures row, centred]                         [ stack  ]   |
|  pet ~~~~~~~~~~~~~~~ centre line / rope line ~~~~~~~~~~~~~~~~~~~~~~~ [ card   ]   |
|                [your creatures row, centred]                        [        ]   |
|                                                                     pet          |
|  [your lands row ...........]  (mana pool) (your portrait) [your other perms]    |
|  hourglass xN                     ladder [life] ladder        key hints / toast   |
|  [library][gy]  your name      [ hand: card tops along bottom edge ]  ladder     |
|  (bottom-left corner)                                     [ NEXT ] (To Combat)   |
|                                                                       (>>)       |
+----------------------------------------------------------------------------------+
```

- **Corners.**
  - Top left: opponent's name, with their timeout hourglass under it.
  - Top right: opponent's library (face-down pile) and graveyard (top card face up), then the settings cog in the very corner.
  - Bottom left: your library and graveyard, roughly the bottom-left 15% W × 15% H, with your name and timeouts beside them.
  - Bottom right: the main button and the ladder.
- **Portraits** are centred horizontally.
  - The opponent's sits at the top edge (its top is cropped). Its life disc is about 12–15% H from the top.
  - Yours sits about 75–85% H down, so its life disc overlaps the top of your hand.
  - Each portrait is about 8–10% W wide, with the small ladder icons in a line on both sides of it.
  - Cosmetic pets sit at the far left and right, at mid-height, outside the play area.
- **Hand.** Cards are drawn large, about 9–10% W each, across the bottom centre, with only the top 15–25% showing: name, mana cost and top of the art. Hovered cards rise. Playable cards glow blue. Near-hand castables extend the row to the right after a gap.
- **Opponent's hand.** Card backs along the top edge, centred behind their portrait, mostly off-screen.
- **Battlefield rows.** Four bands between the portraits:
  1. opponent's lands and other permanents, about 15–25% H
  2. opponent's creatures, about 25–40% H
  3. your creatures, about 45–62% H
  4. your lands and other permanents, about 62–78% H
  - Lands hug the left half of their band and other non-creature permanents the right.
  - Creatures are centred and grow outward from the middle.
  - Battlefield cards are small (about 9–10% W, 10–12% H), with gaps between them.
  - The centre line between the creature rows is where the rope and the timeout banner are drawn.
- **Stack / planeswalker zone.** The right edge at mid-height, about 80–97% W and 25–70% H.
  - The top stack item is shown as a large readable card, about 15% W.
  - A small round arrow tab above it collapses it.
  - Planeswalkers and battles sit at the top right of their owner's half (battles on the protector's side).
- **Main button cluster** (bottom right, about 85–98% W, 80–97% H), stacked from top to bottom:
  1. contextual key hints and toasts (for example "Undo [Z]" or "You will need to discard down to 7…")
  2. the current-turn ladder (5 icons, expanding to 8 in combat)
  3. the main pill button with its sub-label under it
  4. the small round fast-forward (pass turn) button below and right, with "Auto-Passing" text beside it when on
- **Mana pool:** small mana symbols with counts floating just beside your portrait at hand height.

### Desktop browsers (2021–2023 frames)
- The board is dimmed (and blurred in newer frames).
- Title at the top centre (about 5–10% H), with an instruction line under it.
- A large framed content area in the middle (about 10–90% W, 20–75% H):
  - Surveil: two labelled boxes side by side, the graveyard box narrower.
  - Order Triggers: one row with "Last" and "First" labels under its ends.
  - Choose One: option cards side by side with captions above them.
- The source card or ability sits at the right edge, mid-height.
- "View Battlefield" is a pill button at the top right.
- The confirm or cancel button is an orange pill at the bottom centre (about 82% H), overlapping the top of the hand. The hand stays visible underneath.
- The "Are You Sure?" warning is a centred title, a question line, and two blue pill buttons (Yes, No) side by side, over the dimmed board.

### Mobile match screen (two official landscape frames from Jan 2021 only)
- The same top-and-bottom split as desktop, but squeezed to a wider aspect.
- Portraits are small squares in the **top-left** (opponent) and **bottom-left** (you) corners, each with an emblem icon beside it. The library stacks sit next to them; the bottom-left one shows two piles.
- Life totals are numbers at the top centre and bottom centre, where the portraits sit on desktop.
- The opponent's hand backs run along the top edge; their library and graveyard are at the top right.
- Your hand fans along the bottom centre, overlapping your life number, and is mostly hidden until tapped.
- Lands are a row at the left, about 60% H; creatures are centred.
- Bottom right: the main button ("Next" / "Resolve") is a large pill with the round fast-forward button to its **left**, and the five-icon ladder above it.
- The stack card is large at the right edge, mid-height, with a round ">" tab on its left to collapse it.
- A targeting arc is drawn as a glowing curve from the stack item to its target.
- Not seen in these frames: the cog and undo arrow (the text puts them top right), emotes, and timeouts.
- **The current mobile layout (2024–2026) was not seen.** Patch notes show it kept changing, for example the ladder moving right.

### What to take for our layout
- Keep Arena's point-symmetric scheme: each player's library and graveyard in their outer corner, the shared action cluster (button, ladder, stack) on the right edge, and portraits plus life on the vertical centre axis.
- Put every "what happens if I press" cue next to the one button: the sub-label, the key hint and the ladder.
- Browsers are full-screen modals with one title, one instruction line, one confirm button at the bottom centre, and a way to peek at the board. That is easy to copy and works on touch.

---

## Conflicts and gaps: status after the second pass

1. **Phase marker position: resolved.** Small ladders sit beside each portrait, plus a current-turn ladder at the bottom right above the main button. Draftsim's "bottom left" text is wrong by its own screenshots.
2. **Full control keys: resolved.** `Ctrl` is Full Control and `Shift+Ctrl` is Hold Full Control (the in-client table). **Open:** how long plain `Ctrl` lasts (one pass, a step or a turn); sources disagree.
3. **How long a stop lasts: partly resolved.** Ladder stops are single-use (Draftsim, one source; no source for persistent stops). **Default stops: partly resolved**, from community descriptions plus the official smart-priority rules; there is still no official list.
4. **Primary button: resolved** for position (bottom right) and many labels: Next / End Turn / Resolve / Pass / Opponent's Turn, with destination sub-labels, plus older COMBAT / END / ALL ATTACK / NO ATTACK. **Partly resolved** for "All Attack": official notes name an "All Attack" button (2018) and "Attack with All" (2019), and StarCityGames saw "ALL ATTACK" / "NO ATTACK" in 2018; the current wording and the blockers-step labels are still open.
5. **Positions of library, graveyard, exile and the stack: resolved** for the library and graveyard (outer corners), near-hand castables (right of the hand), the stack (right edge), the mana pool (beside the portrait) and timeouts (under the names). **Open:** where exile is drawn.
6. **Tapped rotation: resolved.** It is still a slight tilt, dimmed, with a tap mark (screenshots up to 2024).
7. **How these look:**
   - **Resolved:** targeting arrows (intention lines), modal and alternative choices (Choose One), surveil, Order Triggers, naming a card (a "Choose a Card Name" browser with search).
   - **Partly resolved:** ordering replacement effects (manual ordering exists; layout unseen).
   - **Open:** the X picker, choosing a player, the scry and library-search browsers, the damage-assignment prompt, the mulligan layout.
8. **Sounds and animations: partly resolved.** There are some documented sound events (attack, block, surveil) and a list of animations from patch notes. Most cues are still unsourced; describe our own.
9. **Timer and timeouts: partly resolved.**
   - Actions extend the timer.
   - You earn one timeout per three rope-free turns, and each timeout adds about 30 seconds.
   - Timeouts are shown under the names.
   - The best-of-three clock is 30 minutes per player.
   - **Conflicts remain:** rope length (30 vs 45 seconds), where the rope is drawn (around the avatar vs across the centre; recent frames show the centre), and the inactivity loss rule.
10. **New open item:** the current (2024–26) mobile layout. Only 2021 mobile frames were found.

## Hosts that still need allowing for a third pass

- **mtgazone.com:** rate-limited (429). These pages are unread:
  - [Inner Workings of Arena](https://mtgazone.com/inner-workings-of-arena/), the source of the first pass's "damage as lowered toughness" and "hand smoothing" summaries. The damage claim is now confirmed by the ASAP text.
  - [Using Arena: Interface and Add-ons](https://mtgazone.com/using-arena-interface-and-add-ons/)
  - the [hotkeys guide](https://mtgazone.com/arena-hot-keys-and-interface-guide-simplify-your-game-with-these-easy-tricks/)
- **www.reddit.com** (403 to scripts); **feedback.wizards.com** (now private); **aetherhub.com**, **destructoid.com**, **newsweek.com** (blocked); **tcgplayer.com** (needs JavaScript).
- **www.youtube.com:** a way to fetch videos or frames would settle the X picker, attack and block labels, damage assignment, the mulligan screen and the current mobile layout. Wizards' damage-assignment video id is `s3QVRWPm57E`.
