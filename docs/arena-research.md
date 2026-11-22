# MTG Arena match interface: behaviour and layout research

For a fan project's touch-first match UI. Behaviour and layout only, described in my own words. Nothing here describes or copies Arena's art, frames, icons or sounds.

Researched 2026-11-22.

## How to read this report

**Network limits.** The research session could open full pages from only one public host, `magic.wizards.com` (Wizards' official MTG Arena news, State of the Game posts and release notes). It reached that host with `curl`. These hosts were blocked by the session's network policy, so their pages were never opened:

- mtgazone.com, draftsim.com
- mtg.fandom.com, mtg.wiki, magicarena.fandom.com
- sites.google.com (the "ASAP Beginner's Guide to MTGA")
- mtgarena-support.wizards.com (the official help centre)
- reddit.com, steamcommunity.com, feedback.wizards.com

For those sites I only had web-search result summaries. They are written by a model, they are sometimes wrong, and they sometimes contradict each other. A deeper pass would need those hosts allowed in the environment's network settings.

**Every bullet carries an evidence tag:**

- **[R] Read directly.** I downloaded and read the official Wizards page at the cited URL. This is the strongest evidence.
- **[S] Search summary only.** The claim comes from a search engine's summary of the cited page; the page itself was never opened. Treat it as probable, and verify it before relying on it for a spec.
- **[U] Unverified.** No Arena source was found. The claim comes from general familiarity with the client. A link on a [U] bullet only ever points to a non-Arena source (a fan project), given for context and not as evidence. Check it in the client or in gameplay video before building on it.

**Dates matter.** The sources run from the 2018 closed beta to late 2026, and Arena changes often. Older sources are dated inline.

**Wizards' own words for the interface pieces** (all [R], from Wizards articles):

- **Examine (the "Examined" view):** the enlarged pop-up you get by hovering, right-clicking or long-pressing a card.
- **Browser:** a modal overlay that shows a set of cards to choose from or arrange (scry, search and so on).
- **Hanger:** an extra panel attached beside a card, such as the back face of a double-faced card or the list of dungeons.
- **Badge:** a small counter or status marker drawn on a card.
- **Phase ladder:** the phase indicator.
- **Planeswalker zone:** the area of the battlefield that holds planeswalkers and battles.
- **Near-hand castables:** cards you can cast from somewhere other than your hand, shown next to the hand.

Using the same names in our own code and docs would help.

---

## 1. Board layout

### Overall split
- [S] The screen is split horizontally. Your side is the bottom half and the opponent's is the top. Your hand runs along the bottom edge, and the shared battlefield fills the centre. The opponent's life total, hand, library, graveyard, exile and accrued timeouts are at the top. *(Search summary of [Hipsters of the Coast, 2018](https://www.hipstersofthecoast.com/2018/03/how-to-play-mtg-arena-the-in-match-screen/) and related guides.)*
- [S] Lands sit in a row nearest your hand and library. Creatures sit closer to the centre line, so the two creature rows face each other across the middle. *(Same search summary; also [MTG Arena Zone: Using Arena](https://mtgazone.com/using-arena-interface-and-add-ons/).)*
- [S] Planeswalkers and Sagas are an exception: they are laid out at the far right of the battlefield. *(Search summary of [mtgaassistant: Match Playing Peculiarities](https://mtgaassistant.net/Article/MTG-Arena-Match-Playing-Peculiarities-Guide) and related guides.)*
- [R] Arena has a dedicated planeswalker zone. When battles were added it was rebuilt so that a battle on the protector's side wouldn't push that player's planeswalkers off-screen. *([We Put Battles on MTG Arena](https://magic.wizards.com/en/news/mtg-arena/we-put-battles-on-mtg-arena-what-was-that-like))*
- [R] Battles sit on the **protector's** side of the battlefield, not the caster's.
  - Playtests found entering on the caster's side felt better for enter-the-battlefield effects, but combat felt right only when the battle sat on the protector's side, and combat won.
  - Moving the battle from one side to the other during the game was rejected as confusing. *(same article)*
  - **Lesson for us:** a permanent's controller and the side it is drawn on can differ.
- [R] Battles are drawn landscape on the battlefield and portrait on the stack and in hand. In the Examined pop-up their orientation depends on context: landscape when examined from hand or the battlefield, portrait inside a browser such as scry. *(same article)*
- [R] Artifact tokens (including the Incubator tokens from March of the Machine) go in the same part of the battlefield as other artifact tokens. In other words, non-creature permanents are grouped by type. *([MOM release notes](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-release-notes-march-of-the-machine))*
- [R] On mobile, the opponent's cosmetic pet was moved to the right-hand side so it no longer hides the opponent's lands. Decoration must never cover game state. *([State of the Game, Strixhaven, Apr 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-strixhaven-school-mages-2021-04-07))*

### Avatar, life total, phase ladder
- [S] Each player's avatar portrait sits on the centre line of their half: yours just above your hand, the opponent's just below their hand. In the 2018 beta, your life total was shown just under your avatar. *([Hipsters, 2018](https://www.hipstersofthecoast.com/2018/03/how-to-play-mtg-arena-the-in-match-screen/))*
- [S] The phase/step markers sit next to the avatar. They are small icons on both sides of each player's avatar, and the current one lights up.
  - Markers by your avatar refer to your turn; markers by the opponent's avatar refer to theirs.
  - Arena's colour convention is orange for you and blue for the opponent, and it applies to stops too. *(Search summaries of [Playbite](https://www.playbite.com/q/how-do-you-setup-your-stops-on-mtg-arena), [Steam guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2980093457), [TCGplayer](https://www.tcgplayer.com/content/article/How-to-Play-Magic-The-Gathering-Arena/6ad595a2-2207-40b3-8c1e-0fc18032fb2a/).)*
- [S] A settings option ("Show Phases") and the `L` key toggle whether the phase markers are visible. *(Search summaries of the [ASAP guide](https://sites.google.com/view/asap-bg-to-mtga/playing-a-match) and [hotkeys guide](https://sites.google.com/view/beginners-guide-to-mtga/hotkeys-and-using-the-interface).)*
- [R] On mobile, the avatars' size and position were changed to suit the narrower, wider-aspect screen. *([State of the Game, Jan 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21))*

### Library, graveyard, exile, sideboard
- [S] Your library, graveyard and exile sit beside your hand at the bottom.
  - Hovering the library shows how many cards are left.
  - Clicking the graveyard or exile opens a view of every card in it.
  - Right-clicking a zone also enlarges it.
  - *(Search summaries of [Hipsters](https://www.hipstersofthecoast.com/2018/03/how-to-play-mtg-arena-the-in-match-screen/) and [Aetherhub hotkeys](https://aetherhub.com/Article/MTG-Arena-Shortcuts-and-hidden-hotkeys).)*
  - Which side of the hand they sit on is not confirmed for the current client. One summary says left.
- [R] Clicking your library also gives you a button to switch to viewing your sideboard mid-match. This was added for Learn/Lessons. *([SotG Strixhaven](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-strixhaven-school-mages-2021-04-07))*
- [S] Cards you can play from the graveyard or exile are shown near your hand, separated from it by gaps between the groups. *(Search summary of [MTG Arena Zone: Playing a Match](https://mtgazone.com/playing-a-match/).)*
- [R] Foretold cards show up as near-hand castables. *([SotG Jan 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21))*
- [R] After you cast a Wish, the game places a single option next to your hand. Dragging it out opens a browser of your sideboard. *([AFR digital release notes](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-digital-release-notes-adventures-forgotten-realms-2021-07))*
- **The general pattern:** anything you can currently use from outside your hand appears as an extra card or "option" lined up beside the hand. You use it the same way you use a hand card.

### How permanents are drawn
- [S] On the battlefield a card is shrunk to show only its name, art, power/toughness and keyword icons. Keywords appear as small square icons along the bottom. When there are several keywords the icons are abbreviated, and you open the card to read them. *(Search summaries of [mtgaassistant](https://mtgaassistant.net/Article/MTG-Arena-Match-Playing-Peculiarities-Guide) and a [Steam thread](https://steamcommunity.com/app/2141910/discussions/0/4842022494091506330).)*
- [R] Hexproof, indestructible and ward get prominent protective visual effects on the permanent. *([Strixhaven digital release notes](https://magic.wizards.com/en/news/mtg-arena/strixhaven-mtg-arena-digital-release-notes-2021-04-07); [SotG Strixhaven](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-strixhaven-school-mages-2021-04-07))*
- [S] Tapped permanents: early reports say Arena tilts them only slightly, rather than turning them a full 90°, and also greys them out and shows a large tap symbol. A 2018 PC Gamer piece criticised this as harder to read.
  - *(Search summaries of [PC Gamer](https://www.pcgamer.com/its-a-good-sign-that-our-biggest-magic-the-gathering-arena-concerns-are-cosmetic/) and [mtgarena.pro](https://mtgarena.pro/guides/hearthstone-players-guide-for-magic-the-gathering-arena/).)*
  - I could not find out whether the current client still does this; it needs checking in-client.
- [S] Marked damage is shown as though it lowers the creature's toughness: the toughness value drops and is highlighted. The rules don't work that way, which is a known source of confusion. *(A search summary that blended several beginner guides, among them [MTG Arena Zone: Inner Workings](https://mtgazone.com/inner-workings-of-arena/); which guide made the claim is not certain.)*
- [R] **Badges.** A number or status shown on the card itself, updated live. Examples:
  - toxic N on creatures with toxic
  - a corrupted badge that tracks the opponent's poison count and changes look at 3
  - storm count on storm cards in hand, and on the storm trigger on the stack
  - the expected counter count for Fractal-making spells
  - "life gained this turn" badges on some cards
  - a Ring-bearer badge
  - *([ONE release notes](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-release-notes-phyrexia-all-will-be-one), [Strixhaven notes](https://magic.wizards.com/en/news/mtg-arena/strixhaven-mtg-arena-digital-release-notes-2021-04-07), [LTR release notes](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-release-notes-the-lord-of-the-rings-tales-of-middle-earth))*
- [R] When a creature becomes the Ring-bearer, its rules text updates automatically to include the abilities the Ring grants. **Displayed text is derived, not printed.** That fits our layer-system invariant. *([LTR release notes](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-release-notes-the-lord-of-the-rings-tales-of-middle-earth))*
- [R] Prototype cards on the battlefield keep a prototype-specific look for as long as they stay there. In hand, library and exile they look like the normal card. *([SotG The Brothers' War](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-the-brothers-war))*
- [R] Double-faced cards and battles carry a "hanger" showing the back face beside the card. *([Battles article](https://magic.wizards.com/en/news/mtg-arena/we-put-battles-on-mtg-arena-what-was-that-like))*
- [U] Identical permanents are grouped into one pile: basic lands of the same name, identical tokens, and identical untapped creatures with no counters or attachments. The pile shows a count, and a member leaves the pile as soon as it differs from the others (tapped, damaged, or given a counter).
  - The only source I found is a fan project calling this "Arena-style" stacking, so it is not evidence about Arena itself ([tolaria PR](https://github.com/fil-donadoni/tolaria/pull/9096)).
- [U] Auras and Equipment are drawn tucked behind the permanent they're attached to, slightly offset so the edge of each attachment shows.
- [U] Counters appear as a small numbered badge on the card. For +1/+1 counters the power/toughness readout also changes colour.
- [U] Planeswalker loyalty is a number in a marker at the bottom of the card. Damage dealt to a planeswalker visibly counts its loyalty down.

**Design note.** Arena's layout puts:

- creatures facing each other across the centre
- lands at the back, nearest each player
- other non-creature permanents near the lands, grouped by type
- planeswalkers and battles in their own zone at the right edge

Information that would otherwise need reading (counts, poison, conditional state) is pushed into badges and highlight colours.

---

## 2. The hand

- [S] Your hand is a fan of cards along the bottom edge. Hovering a card raises and enlarges it; right-clicking any card anywhere (hand, stack, graveyard, battlefield) shows a large zoomed view. *(Search summaries of the [Draftsim tips](https://draftsim.com/mtg-arena-tips-and-tricks/) and [Aetherhub](https://aetherhub.com/Article/MTG-Arena-Shortcuts-and-hidden-hotkeys) guides.)*
- [S] A "keyword reminders" setting adds floating reminder text for keywords when you hover a card. *(Search summary of [Draftsim settings](https://draftsim.com/mtg-arena-settings/).)*
- [S] **Playing a card.** Drag it from the hand up onto the battlefield and release, and auto-tap pays for it. Double-clicking is reported to work at least for cards castable from the graveyard or exile. *(Search summaries of [Hipsters closed beta, 2018](https://www.hipstersofthecoast.com/2018/03/how-to-play-the-mtg-arena-closed-beta-client-overview/) and [MTG Arena Zone: Playing a Match](https://mtgazone.com/playing-a-match/).)*
- [S] **Previewing the payment.** If you drag a spell over the battlefield and hold it without releasing (or, in some cases, just hover it), the lands auto-tap would use are highlighted. *(Search summary of the [ASAP guide](https://sites.google.com/view/asap-bg-to-mtga/playing-a-match).)*
- [R] Playable cards get a highlight. The normal playable highlight is bright blue.
  - A land that would enter tapped because its condition isn't met gets a softer or yellow "warning" highlight instead. Examples are a Snarl land with no matching land to reveal, or the Forgotten Realms creature-lands once you control two or more other lands.
  - **The highlight carries information beyond "you can play this".**
  - *([Strixhaven notes](https://magic.wizards.com/en/news/mtg-arena/strixhaven-mtg-arena-digital-release-notes-2021-04-07), [AFR notes](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-digital-release-notes-adventures-forgotten-realms-2021-07))*
- [R] Optional additional costs such as kicker, bargain and foretell use a shared casting interface. You always cast the spell normally, and then you're asked whether to pay the extra cost. *([WOE release notes](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-release-notes-wilds-of-eldraine); [SotG Jan 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21))*
- [R] Right-clicking a card that ventures into the dungeon shows the dungeon cards in its hanger, and each further right-click cycles to the next one. The same trick cycles through the tokens a card can make. On mobile, a long-press shows all three dungeons at once. *([AFR notes](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-digital-release-notes-adventures-forgotten-realms-2021-07); [SotG AFR](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-adventures-forgotten-realms-2021-07-02))*
- [S] **Hover is visible to the opponent.** The opponent can see when you hover or lift a card in your hand. Players read this as a tell, and some bluff with it or complain about it. *(Search summary of [Steam thread](https://steamcommunity.com/app/2141910/discussions/0/734750159229956628/?ctp=2).)*
  - **Decide deliberately** whether our UI broadcasts hovers. For an LLM or AI opponent this doesn't matter, but for future human-vs-human play it does.
- [U] The opponent's hand is shown face-down as a smaller fan at the top edge. A card the opponent picks up lifts out of it. Cards from the opponent's hand that are revealed to you are shown face-up.

---

## 3. Turn flow and priority

### Default auto-passing ("smart" priority)
- [R] By default Arena does **not** give you priority:
  - in your own upkeep
  - in your own end step
  - in response to your own triggered abilities

  "Smart priority" is a set of hand-written exceptions where the client does stop for you anyway. Examples:
  - a Saga's chapter III trigger on the stack, so you can use the Saga first
  - an evoke sacrifice trigger, so you can respond to it
  - a blinked permanent returning at your end step, so you can use its abilities
  - floating mana in your end step
  - an opponent's Sheoldred in your upkeep
  - an opponent's Goblin Rabblemaster during their first main phase
  - a permanent flashed in during your end step, so you can answer it before the opponent untaps

  For anything else unusual, Wizards' advice is to set a stop or use full control. *([MTG Arena Announcements, Oct 27 2025: "A Quick Guide to Smart Priority"](https://magic.wizards.com/en/news/mtg-arena/announcements-october-27-2025))*
- [S] More generally, Arena stops only when you have something you could do. When you have no legal play, priority is passed for you. *(Search summaries of [Draftsim tips](https://draftsim.com/mtg-arena-tips-and-tricks/) and the [ASAP guide](https://sites.google.com/view/asap-bg-to-mtga/playing-a-match).)*
- [S] Even with auto-pass, the client still stops when the opponent casts a spell or activates an ability and you could respond. Obligatory decisions are never auto-passed. *(Search summary of [Steam thread](https://steamcommunity.com/app/2141910/discussions/0/4629232489537311442/).)*

### The main button and pass modes
- [S] There is one large primary button (its position, bottom right, is [U]). Pressing it (or Space) passes priority: it lets the top of the stack resolve, or moves to the next step. It is orange, the "you" colour.
  - Its label changes with context. I could not confirm the exact current wording; see the [U] note below.
  - *(Search summary of [TCGplayer guide](https://www.tcgplayer.com/content/article/How-to-Play-Magic-The-Gathering-Arena/6ad595a2-2207-40b3-8c1e-0fc18032fb2a/).)*
- [S] Besides a single pass, there are two bigger pass modes:
  - **Pass until response** (`Enter`): keeps passing until something happens that you could respond to. Guides warn it can skip your own combat if used before combat, and that it may not stop for triggered abilities.
  - **Pass turn** (`Shift+Enter`, or Shift-clicking the button): passes through the rest of the turn even if you could respond. You can still be asked to block.
  - *(Search summaries of [Draftsim keyboard shortcuts](https://draftsim.com/mtg-arena-keyboard-shortcuts/), [MTG Arena Zone hotkeys](https://mtgazone.com/arena-hot-keys-and-interface-guide-simplify-your-game-with-these-easy-tricks/), [Steam "Resolve All" thread](https://steamcommunity.com/app/2141910/discussions/0/597404077749453144/).)*
- [S] A **"Resolve All"** option resolves only what is already on the stack. Anything added afterwards needs another press, and some players say it still stops at each item. *(Search summary of [Steam thread](https://steamcommunity.com/app/2141910/discussions/0/597404077749453144/).)*
- [S] Stops still apply while "pass turn" is active: the client halts at a stop you set even in that mode. *(Search summary of the [ASAP guide](https://sites.google.com/view/asap-bg-to-mtga/playing-a-match).)*
- [U] Context labels on the primary button, **none confirmed** by a source I could read. They include:
  - **Pass**, **Resolve** (a spell is on the stack)
  - **Next**, **To Combat**, **To End Turn** / **End Turn** (your main phase)
  - **Attack** / **No Attacks** (declare attackers)
  - **Block** / **No Blocks** (declare blockers)
  - **Done** / **Submit** (selection prompts)
  - **Pay** (manual payment)
  - **Opponent's Turn** (shown while waiting)

  Smaller secondary buttons sit next to it for Cancel and Undo, and an "All Attack" shortcut appears during declare attackers. Verify the exact wording in a gameplay video. Our own labels don't have to match.
- [R] Two of the secondary buttons are confirmed:
  - **Cancel Attacks** clears every attacker you've chosen so far.
  - **Cancel Blocks**, added in 2021 to work the same way, clears your chosen blocks during declare blockers.
  - *([SotG AFR, Jul 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-adventures-forgotten-realms-2021-07-02))*

### Phase stops
- [S] You set a stop by clicking (or tapping) a phase marker. Markers next to your avatar set stops for your turn, shown in orange; markers next to the opponent's avatar set stops for their turn, shown in blue. When a stop is reached, the client gives you priority there. *(Search summaries of [Playbite](https://www.playbite.com/q/how-do-you-setup-your-stops-on-mtg-arena), [Steam guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2980093457), [Hipsters 2018](https://www.hipstersofthecoast.com/2018/03/how-to-play-mtg-arena-the-in-match-screen/).)*
- [S] Stops need to be set in advance, while you still hold priority, or the client may skip past the step. *(Search summary of [TCGplayer](https://www.tcgplayer.com/content/article/How-to-Play-Magic-The-Gathering-Arena/6ad595a2-2207-40b3-8c1e-0fc18032fb2a/).)*
- **Conflict: how long a stop lasts.**
  - Some guides (Draftsim, and the 2018 Hipsters article) say a stop clicked on the ladder lasts only until that step is reached, then clears itself.
  - Others imply stops persist for the game.
  - My understanding [U] is that there are two kinds: per-game stops set in the ladder, and the default stops configured in settings. Treat this as unconfirmed.
- [U] I found no official list of the default stops. My understanding is that by default you stop in your own first and second main phases, in declare attackers and blockers when relevant, and on the opponent's turn when you have an instant-speed play.
- [S] The beginning phase normally runs straight through to main phase 1 unless you set an upkeep stop. *(Search summary of a [Steam thread](https://steamcommunity.com/app/2141910/discussions/0/574929940135414276/).)*
  - The "Arena-style default stops" list in a GitHub PR belongs to a **fan project**, not Arena ([link](https://github.com/tony-hagerty/mtg-arena-edh/pull/39)).

### Full control
- [S] Full control turns off auto-passing (and, per one guide, auto-tap), so you get every priority window. *(Search summaries of the [Steam guide](https://steamcommunity.com/sharedfiles/filedetails/?id=2980093457) and the [ASAP guide](https://sites.google.com/view/asap-bg-to-mtga/playing-a-match).)*
- [R] How to toggle full control:
  - On mobile you toggle it by press-and-holding your avatar. Since mid-2021, press-and-holding the phase ladder works too.
  - *([Mobile FAQ, Jan 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-mobile-faqs-2021-01-28); [SotG Jan 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21); [SotG AFR](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-adventures-forgotten-realms-2021-07-02))*
- [S] On desktop: `Ctrl` gives temporary full control, which turns off once you leave the current step. `Ctrl+Shift` gives full control until you toggle it off. *(Search summaries of [Draftsim](https://draftsim.com/mtg-arena-tips-and-tricks/), [mtgaassistant](https://mtgaassistant.net/Article/All-MTG-Arena-Keyboard-Shortcuts), [Flipside](https://flipsidegaming.com/blogs/magic-blog/mtg-arena-hot-keys-and-using-the-interface).)*
  - **Conflict:** one summary gave Shift+Ctrl as the temporary version. Most sources say Ctrl is temporary and Ctrl+Shift is the lasting one.
- [S] Holding full control for a long time is visible to the opponent and slows play, which is itself a bluffing signal. *(Search summary of the [ASAP guide](https://sites.google.com/view/asap-bg-to-mtga/playing-a-match).)*
- [S] Players report bugs where full control or auto-pass switches itself off. *([feedback.wizards.com suggestion](https://feedback.wizards.com/forums/918667-mtg-arena-bugs-product-suggestions/suggestions/40011379-full-control-mode-deactivates-itself); search summary only.)*

### Timers and timeouts
- [S] There is a per-turn or per-decision timer that grows with each action you take (conflict: another summary says it runs faster the more actions you take). When it is about to run out, a burning "rope" appears along the phase strip.
  - If the rope burns out, you spend one timeout (extension).
  - If you have no timeouts left, the client passes priority for you.
  - You start with none and earn one for every three turns played without the rope appearing.
  - Guides put a timeout at about 30 seconds.
  - Timeouts were shown as an hourglass with dots, above the pass and end-turn buttons (2018), or near the top left (a later summary). Where they are now is not confirmed.
  - *(Search summaries of [Draftsim on roping](https://draftsim.com/mtg-arena-roping/), [MTG Arena Zone: Playing a Match](https://mtgazone.com/playing-a-match/), [Hipsters 2018](https://www.hipstersofthecoast.com/2018/03/how-to-play-mtg-arena-the-in-match-screen/).)*
- [S] A 2019 thread reports that roughly two minutes of complete inactivity concedes the game at the end of your turn. *(Search summary of [devtrackers](https://devtrackers.gg/magic-arena/p/cefe625b-did-they-changed-the-rope-timeout-system).)*
- [R] On mobile you see your own timeouts by tapping your avatar, and the opponent's by tapping theirs. *([SotG Jan 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21))*
- [S] Qualifier events use a 30-minute chess clock per player, running only while that player has priority; running out loses the match. Arena Powered Cube starts you with one timeout because its early turns are complex. *([Qualifier info](https://magic.wizards.com/en/news/mtg-arena/qualifier-play-ins-and-qualifier-weekend-information), [Powered Cube](https://magic.wizards.com/en/news/mtg-arena/arena-powered-cube-draft); search summaries.)*
- [S] Player complaints about the timer:
  - It doesn't pause while the opponent's long animations or triggers resolve.
  - Clicking through decisions in the middle of a resolution doesn't reset the rope.
  - "Roping" (deliberately stalling) is a well-known annoyance.
  - *([feedback.wizards.com](https://feedback.wizards.com/forums/918667-mtg-arena-bugs-product-suggestions/suggestions/46355857-timer-issue), [Draftsim](https://draftsim.com/mtg-arena-roping/); search summaries.)*
- [R] Since August 2026 there is in-game reporting with an "Inactivity" category, covering idling or deliberately slow play. *([Player reporting](https://magic.wizards.com/en/news/mtg-arena/player-reporting))*

**Design note.** For a single-player game against an AI or LLM, the rope and timeouts mostly don't apply. The parts worth copying are:

- the smart priority model: skip windows where you have nothing to do, with explicit exceptions
- per-step stops that can be set separately for your turn and the opponent's
- a one-gesture full control toggle
- one primary button whose label always says what pressing it will do

---

## 4. Casting

- [S] **Auto-tap is a setting, and full control overrides it.** You can toggle auto-tap from the gameplay settings during a match.
  - With auto-tap on, the client chooses which mana sources to tap.
  - With it off, or in full control, the client proposes a payment and highlights it. You can tap different sources yourself, the proposal updates to match, and you confirm by pressing the pay button.
  - *(Search summaries of the [ASAP guide](https://sites.google.com/view/asap-bg-to-mtga/playing-a-match) and the [mobile FAQ](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-mobile-faqs-2021-01-28).)*
  - [R] On mobile, the gameplay settings are behind a cog at the top right of the battlefield. *([Mobile FAQ](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-mobile-faqs-2021-01-28))*
- [R] When the kind of mana spent matters (cards that care which types of mana were spent to cast them), auto-tap **always pauses** to show which sources it plans to use and waits for you to confirm. Wizards warns that auto-tap doesn't play strategically. *([SotG BRO](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-the-brothers-war))*
- [R] The payment step has an **"Auto Pay"** button that hands the rest of the payment to auto-tap. After you cast Channel, its effect appears as a clickable item at the left of the screen, and you click it to add mana. [U] Whether other special mana sources appear there too is not confirmed. *([Strixhaven notes](https://magic.wizards.com/en/news/mtg-arena/strixhaven-mtg-arena-digital-release-notes-2021-04-07))*
- [R] For Phyrexian mana you're asked how to pay each symbol and can toggle it to the life-payment option. *([Strixhaven notes](https://magic.wizards.com/en/news/mtg-arena/strixhaven-mtg-arena-digital-release-notes-2021-04-07))*
- [R] Ward doesn't change the cost, so auto-tap ignores it. Instead, choosing a ward creature as a target shows a confirmation pop-up asking whether you accept paying the ward cost. *([SotG Strixhaven](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-strixhaven-school-mages-2021-04-07))*
- [R] Proliferate picks its targets automatically by a sensible rule (the opponent's poison counters, your own useful counters, but never your own poison counters) and then asks you to confirm or change the selection. **Arena's pattern is to pre-fill a smart default and ask for confirmation.** *([ONE notes](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-release-notes-phyrexia-all-will-be-one))*
- [R] A spell's chosen X value is shown on the spell while it's on the stack. *([Strixhaven notes](https://magic.wizards.com/en/news/mtg-arena/strixhaven-mtg-arena-digital-release-notes-2021-04-07))*
  - [U] How X is chosen is unconfirmed. I believe it's a numeric picker with up and down arrows, capped at what you can afford, followed by a confirm.
- [S] **Mana shortcuts on desktop:**
  - `Q` held while tapping a land taps every land of that type.
  - Pressing `Q` twice taps every non-creature mana source.
  - `Z` undoes a tap or a target choice until the spell is finally cast or the ability activated.
  - You can click mana symbols in your mana pool to choose which floating mana to spend.
  - *(Search summaries of the [ASAP guide](https://sites.google.com/view/asap-bg-to-mtga/playing-a-match) and [Draftsim shortcuts](https://draftsim.com/mtg-arena-keyboard-shortcuts/).)*
- [R] On mobile, an "undo" arrow appears at the top right of the screen whenever an action can be undone. *([SotG Jan 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21))*
- [S] Known auto-tap complaints:
  - It saves lands with useful non-mana abilities too eagerly.
  - It spends painlands on generic costs.
  - It sometimes taps creatures when lands would do.
  - It handles "spend this mana only on X" mana awkwardly.
  - *([feedback.wizards.com](https://feedback.wizards.com/forums/918667-mtg-arena-bugs-product-suggestions/suggestions/47573615-using-use-this-mana-only-for-x-mana-on-mtga-is-v), [Inga and Esika report](https://feedback.wizards.com/forums/918667-mtg-arena-bugs-product-suggestions/suggestions/48151598-inga-and-esika-requires-me-to-tap-3-creatures-rath), [ASAP guide](https://sites.google.com/view/asap-bg-to-mtga/playing-a-match); search summaries.)*
- **Targeting.** I found no source describing Arena's own targeting UI; the only description was a fan project ([tolaria issue](https://github.com/fil-donadoni/tolaria/issues/9163)).
  - [U] An arrow runs from the spell or source to the cursor and locks onto a legal target. Legal targets are highlighted and everything else is dimmed. Players are targeted by clicking their avatar. While the spell is on the stack, its arrows to its targets stay visible.
- [U] Modal spells show each mode as a separate selectable option, laid out like small cards, and you pick one (or as many as the card allows).
- [U] Cancelling: while you're choosing targets or paying, a Cancel button, or dragging the card back down to the hand, returns the spell to your hand. Rules-wise this is a reversal of the casting process (CR 601.2e and CR 734, "Handling Illegal Actions").
- [U] Activated abilities: clicking a permanent that has activated abilities either activates the single available one, or opens a small list of its abilities (planeswalker loyalty abilities appear the same way). Mana abilities are used by clicking the land itself.

---

## 5. The stack

- [R] Spells on the stack are drawn as cards: battles are drawn upright there, and a compleated planeswalker on the stack shows its loyalty reduced by the life paid for it. *([Battles article](https://magic.wizards.com/en/news/mtg-arena/we-put-battles-on-mtg-arena-what-was-that-like); [ONE notes](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-release-notes-phyrexia-all-will-be-one))*
- [R] Triggers on the stack can carry count badges: a storm trigger, for example, shows how many copies it will make, so both players can decide whether to respond. *([Strixhaven notes](https://magic.wizards.com/en/news/mtg-arena/strixhaven-mtg-arena-digital-release-notes-2021-04-07))*
- [R] One trigger now lists every ability that was chosen for it (a 2020 bug fix). That implies abilities on the stack display their chosen options. *([SotG Nov 2020](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-november-2020-11-10))*
- [S] **Ordering triggers.** The "Auto Order Triggered Abilities" setting is on by default and lets the client put your simultaneous triggers on the stack in an order it picks. With it off, you're asked to arrange them yourself. You only order your own triggers. Guides advise turning it off for combo decks. *(Search summaries of [Draftsim settings](https://draftsim.com/mtg-arena-settings/), [ASAP: Using Arena](https://sites.google.com/view/asap-bg-to-mtga/using-arena), [TCGplayer](https://www.tcgplayer.com/content/article/How-to-Play-Magic-The-Gathering-Arena/6ad595a2-2207-40b3-8c1e-0fc18032fb2a/).)*
- [S] **Responding.** If the opponent casts something and you could respond, you get priority with the "Resolve" (pass) button showing. To act, play an instant or activate an ability. To respond to *your own* spell or trigger you generally need full control, unless one of the smart priority exceptions applies. *(Search summary of [Steam thread](https://steamcommunity.com/app/2141910/discussions/0/4629232489537311442/); [R] the smart priority article above.)*
- [U] Position: the stack sits roughly mid-right, beside the battlefield. Each new item lands on top, offset slightly from the one below, and the newest is the largest. Abilities on the stack are drawn as smaller cards showing the source's art and the ability text.
- [U] "May" abilities produce a prompt with Yes and No buttons when they resolve, centred near the source or the stack.
- [R] Cards that let you choose something as they resolve (a dungeon room, for example) bring up a choice prompt on screen; for a dungeon, arrows show the paths between rooms. *([AFR notes](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-digital-release-notes-adventures-forgotten-realms-2021-07))*

---

## 6. Combat

- [R] **Declaring attackers.** On mobile, tap each creature you want to attack with. [U] Desktop works the same way with clicks. *([Mobile FAQ](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-mobile-faqs-2021-01-28); [SotG Jan 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21))*
- [R] **Cancel Attacks** clears every attacker you've picked so far. *([SotG AFR](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-adventures-forgotten-realms-2021-07-02))*
- [U] An "All Attack" shortcut selects every creature that can attack, and "No Attacks" skips combat. Selected attackers slide forward toward the opponent.
- **Attacking planeswalkers and battles.**
  - [S] After choosing attackers, you pick what each one attacks (the player or a particular planeswalker) by clicking it. Only a low-quality Q&A summary supports this ([Playbite](https://www.playbite.com/q/how-do-you-attack-a-planeswalker-in-mtg-arena)).
  - [U] My understanding is that when the opponent has a planeswalker or battle you could attack, selecting an attacker draws an arrow from it that you drop on the target. With no such targets, attackers default to the player.
  - [R] Battles needed this attack-target UI to handle restrictions such as "can attack a player or planeswalker, but not a battle". *([Battles article](https://magic.wizards.com/en/news/mtg-arena/we-put-battles-on-mtg-arena-what-was-that-like))*
- [R] **Declaring blockers.** On mobile you can either tap your creature and then the attacker it should block, or press on your creature and drag to the attacker. **Cancel Blocks** resets every block you've made. *([SotG Jan 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21); [Mobile FAQ](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-mobile-faqs-2021-01-28); [SotG AFR](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-adventures-forgotten-realms-2021-07-02))*
  - [U] Several blockers can be assigned to the same attacker by repeating the gesture. Blockers move to stand in front of the attacker they block.
- **Damage assignment.**
  - [R] Foundations (November 2024) removed damage assignment order.
  - On Arena, when your attacker is blocked by more than one creature, you now split its damage among the blockers however you like.
  - Wizards' example is a 4/4 blocked by a 2/3 and a buffed 8/6: you put 3 damage on the 2/3 and 1 on the 8/6.
  - A video in the announcement shows the new damage assignment UI; I couldn't watch it.
  - *([Announcements Nov 11 2024](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-announcements-november-11-2024); rules context in [Foundations release notes](https://magic.wizards.com/en/news/feature/foundations-release-notes), search summary only)*
  - **Don't build a "damage assignment order" step.** CR 510.1c (in this repo's `rules/`) lets the attacker divide a blocked creature's damage among its blockers as they choose, with no ordering. Trample is CR 702.19.
- [R] Whenever there is more than one legal way to assign damage, Arena prompts for manual assignment, and Wizards warns not to assume the default is what you want. Their example was a creature whose damage triggers punish the attacker. *([ONE notes](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-release-notes-phyrexia-all-will-be-one))*
  - [U] The prompt shows the attacker's damage as a pool and lets you move points onto each blocker (and, with trample, onto the player or planeswalker), with lethal damage pre-filled.
- [S] First strike and double strike are shown as keyword icons on the card. Players have asked for a warning before blocking a first striker; others answered that the icon is already there. *(Search summary of [Steam thread](https://steamcommunity.com/app/2141910/discussions/0/4842022494091506330).)*
- [U] With first strike involved, the client runs two separate combat damage steps and animates each. Combat damage is animated as attackers lunging at their target, with damage numbers showing on creatures and on the life total.

---

## 7. Decisions and prompts

- [R] **Mulligan.** You tap or click Keep or Mulligan. After a mulligan, once you keep, you select the cards to put on the bottom and drag them to your library. *([SotG Jan 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21))*
  - Rules: the London mulligan; you always draw 7 and bottom one card per mulligan when you keep (CR 103.5).
  - [S] In Best-of-One, Arena uses an opening-hand "smoothing" algorithm. A search summary described it as dealing more than one candidate opening hand and giving you the more balanced one. *(A search summary that blended several beginner guides, among them [MTG Arena Zone: Inner Workings](https://mtgazone.com/inner-workings-of-arena/); which guide made the claim is not certain. The same summary claimed a cap on the number of mulligans, which I doubt.)* This doesn't apply to our engine's rules, so treat it as a product note only.
  - [U] The opening hand is laid out large in the centre of the screen over the dimmed board, with the two buttons below it, and the screen shows who plays first.
- [R] **Browsers.** Arena's name for the full-screen or overlay panel that lists cards to choose from or arrange: scry, search, a sideboard Wish, and so on. Cards in a browser are always drawn upright. *([Battles article](https://magic.wizards.com/en/news/mtg-arena/we-put-battles-on-mtg-arena-what-was-that-like); [AFR notes](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-digital-release-notes-adventures-forgotten-realms-2021-07))*
- [S] **Surveil browser.** The browser shows two piles, labelled Library and Graveyard. All the cards start in the Library pile; you drag each card to the pile you want (and into order on top of the library), then press Done. *(Search summary of [Draftsim on surveil](https://draftsim.com/mtg-surveil/).)*
  - [U] The scry browser works the same way with Top and Bottom piles.
- [U] **Search, discard, "choose N cards".** These use a browser showing a scrollable row of cards with a counter such as "choose 2", a Done or Submit button that only enables once the selection is valid, and a toggle to hide the browser so you can look at the board.
- [U] **Choosing a player:** click or tap the player's avatar, which is highlighted as a legal choice.
- [U] **Naming a card:** a text field with autocomplete over the card database.
- [U] **Ordering replacement effects:** I found nothing. Presumably a list-choice prompt, but this is unconfirmed.
- [R] **Pre-filled choices.** Proliferate and auto-tap pre-select a choice and ask for confirmation. Ward shows a confirmation pop-up. *(sources in §4)*
- [R] **Optional costs** (kicker, bargain, foretell) are a yes/no choice made during casting. *(sources in §2)*

---

## 8. Feedback and feel

- [R] The Examined view (hover on desktop, long-press on mobile) is the main way to read a card in detail. Arena changed which way battles face in it depending on context, because a card suddenly appearing sideways in a browser was distracting. **Card zoom should be chosen to suit the context.** *([Battles article](https://magic.wizards.com/en/news/mtg-arena/we-put-battles-on-mtg-arena-what-was-that-like))*
- [R] **Emotes.** You open them by clicking your own avatar; on mobile you tap it.
  - They are a fixed set of short phrases, and cosmetic emote packs and stickers are sold or earned on top of the base set.
  - When the opponent emotes, context-sensitive replies pop up for a few seconds: answering "Nice!" offers "Thanks!", answering "Oops" offers "Sorry!".
  - You mute the opponent from their avatar.
  - *([SotG Mar 2020](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-march-2020-03-05); [Mobile FAQ](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-mobile-faqs-2021-01-28); [SotG 2024](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-of-the-game-2024); [Announcements Apr 14 2025](https://magic.wizards.com/en/news/mtg-arena/announcements-april-14-2025))*
  - [S] Emotes can be switched off in settings. *(Search summary of [Draftsim settings](https://draftsim.com/mtg-arena-settings/).)*
  - [U] The base set includes a "Thinking…" phrase, which is the closest thing to an opponent-is-thinking signal.
- **Opponent "thinking" indicator.**
  - [S] There is no explicit indicator. Players read the opponent's hovering or lifting of hand cards and their timer or rope instead. *(Search summary of [Steam thread](https://steamcommunity.com/app/2141910/discussions/0/734750159229956628/?ctp=2).)*
  - [U] During the opponent's decisions, a "waiting for opponent" style state is shown and your main button reflects that it's their action.
- **Game log / history.**
  - [S] Arena has **no in-client game log or replay**. Players often name the lack of a log as one of the biggest gaps ("I couldn't work out how I lost"), and third-party trackers fill it by reading the client's log file. *(Search summaries of [Steam: match replays](https://steamcommunity.com/app/2141910/discussions/0/595134572710082320/), [MTG Arena Tool](https://github.com/CodySchrank/MTG-Arena-Tool).)*
  - **This is the clearest place where we can beat Arena.** Our engine already emits events, so a readable log is cheap.
- [S] Reviewers praise the animations (for example, a creature flying in to carry a card away) and say you can hold a button to stop and take in every interaction. *(Search summary of [Destructoid review](https://www.destructoid.com/reviews/review-magic-the-gathering-arena/).)*
- [U] Animation and feedback beats worth matching in our own style:
  - casting: the card lifts from hand, moves to the stack area and settles
  - resolving: a permanent flies to its place on the battlefield; an instant or sorcery shows its effect and then moves to the graveyard
  - damage: a projectile or impact from the source to the target, with a floating number
  - death: the card breaks apart or fades, then slides to the graveyard
  - life change: the life number ticks to its new value with a short pulse (red for loss, green for gain)
  - card draw: the card slides from the library into the hand fan
  - a turn banner or highlight when the turn passes
- [U] **Sound cues.** I found no source on sounds at all. From play experience, the events with distinct cues include:
  - drawing a card, playing a land, casting by colour
  - creatures entering and dying
  - combat hits, life loss and gain
  - start of your turn and priority passing to you (with a timer warning)
  - emotes, win and loss stings

  Our sounds must be original.

---

## 9. Mobile Arena (phone and tablet)

All [R] unless marked otherwise. Sources are the [SotG Jan 2021](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-january-2021-01-21) and the [Mobile FAQ](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-mobile-faqs-2021-01-28) unless stated.

- **Same game, compact layout.** Clicks become taps and scrolls become swipes. Wizards committed to not simplifying gameplay on mobile; layouts may shift but features stay. *(also [SotG Strixhaven](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-strixhaven-school-mages-2021-04-07))*
- **Hand "tucking".** The hand is often shown tucked, mostly off-screen, to leave room for the board.
  - Tapping your hand (or the opponent's) fans it out so the cards can be read and picked.
  - Tapping the battlefield tucks it away again.
  - The client also tucks and untucks automatically, for example tucking when you can't play anything, but you can always override it.
  - *(The "can't play" detail is from a search summary of [Wargamer](https://www.wargamer.com/magic-the-gathering-arena/android-release).)*
- **Long-press = examine.** Tapping and holding a card shows it in detail, which takes the place of desktop hover. Board cards are small on phones, so players long-press a lot. *([TechRadar hands-on](https://www.techradar.com/news/mtg-arena-mobile-hands-on-with-phone-sized-fantasy-card-battles), search summary)*
- **Casting:** tap and hold to pick up the card, then drag it over the battlefield and release.
- **Mana:** you can tap lands for mana yourself, or rely on auto-tap.
- **Combat:** tap creatures to attack with them. To block, tap your creature and then the attacker, or drag from blocker to attacker.
- **Full control:** press and hold your avatar, or (since mid-2021) the phase ladder. *([SotG AFR](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-adventures-forgotten-realms-2021-07-02))*
- **Avatars as menus:**
  - Tap your own avatar for emotes and to see your timeouts.
  - Tap the opponent's avatar to mute them or see their timeouts.
- **Undo:** an undo arrow appears at the top right when an action can be undone.
- **Settings:** a cog at the top right of the battlefield opens them (auto-tap and so on).
- **Mulligan:** tap Keep or Mulligan, then tap to select cards and drag them to the library.
- **Layout tuning.**
  - Avatars were resized and moved for the wider aspect ratio.
  - The opponent's pet was moved right so it doesn't hide lands. *([SotG Strixhaven](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-strixhaven-school-mages-2021-04-07))*
  - Cards in hand were enlarged slightly on tablet. *([SotG AFR](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-adventures-forgotten-realms-2021-07-02))*
- **Dungeons:** long-press a venture card to see all three dungeons. *([SotG AFR](https://magic.wizards.com/en/news/mtg-arena/mtg-arena-state-game-adventures-forgotten-realms-2021-07-02))*
- **Context menus:** a long-press on a friend opens a menu (Report, Unfriend, Block). Long-press is the general secondary-action gesture. *([Player reporting](https://magic.wizards.com/en/news/mtg-arena/player-reporting))*
- [S] Reviewers on phones:
  - The touch controls are intuitive, with only occasional mis-taps, and a Cancel button stopped those from costing games.
  - The 6.1″ iPhone was noticeably harder to use than a 6.8″ phone, and the notch got in the way.
  - Battlefield art becomes tiny.
  - *(Search summary of [TechRadar](https://www.techradar.com/news/mtg-arena-mobile-hands-on-with-phone-sized-fantasy-card-battles).)*
  - **For us:** respect safe-area insets, and keep every mis-tap recoverable with cancel or undo.

---

## 10. What players praise and complain about

### Praise (copy)
- An easy, intuitive first game: drag to cast and auto-tap get new players going. *([Newsweek](https://www.newsweek.com/mtg-arena-beta-hands-impressions-1100546); search summary [S])*
- Smooth, readable animations, and the option to slow right down and see every interaction. *([Destructoid](https://www.destructoid.com/reviews/review-magic-the-gathering-arena/) [S]; [TechRadar](https://www.techradar.com/news/mtg-arena-mobile-hands-on-with-phone-sized-fantasy-card-battles) [S])*
- Automation handles the boring parts, such as counting and tracking. Badges like storm count, poison and life gained this turn keep the important numbers in view. *([R] badge sources in §1; Steam comment via search summary [S])*
- Mobile is the full game with touch-friendly gestures. *([R] SotG Jan 2021)*

### Complaints (avoid)
- **Auto-pass surprises.** The pass button sits where you hit it by accident. Pass modes skip steps you wanted, such as post-combat main or combat itself, and they behave inconsistently from one step to the next. You need full control to respond to your own things. *([feedback.wizards.com](https://feedback.wizards.com/forums/918667-mtg-arena-bugs-product-suggestions/suggestions/39776722-game-just-skipped-through-my-turn), [Steam](https://steamcommunity.com/app/2141910/discussions/0/4629232489537311442/); search summaries)*
  - **Our response:** make the next stop visible ("will stop at: your end step") and make passes reversible within a moment where the rules allow it.
- **Auto-tap mistakes** (see §4). Auto-tap should always be previewable and overridable, and it should pause whenever the choice of mana matters (Arena itself moved toward this, [R] BRO).
- **No game log or replay** (§8).
- **Timer feels unfair:** it keeps running during the opponent's animations, and roping is common. *(§3)*
- **Readability:** visual clutter; slightly tilted, dimmed tapped cards that are hard to read (2018); damage shown as lowered toughness, which misleads people about the rules; keyword icons that hide what they mean until you open the card. *([PC Gamer](https://www.pcgamer.com/its-a-good-sign-that-our-biggest-magic-the-gathering-arena-concerns-are-cosmetic/), [mtgaassistant](https://mtgaassistant.net/Article/MTG-Arena-Match-Playing-Peculiarities-Guide), [Steam](https://steamcommunity.com/app/2141910/discussions/0/4842022494091506330); search summaries)*
- **Information leaks:** hovering cards in hand shows the opponent what you're considering, and holding full control is visible. *(§2, §3)*
- **Trigger auto-ordering** "won't always get it right" for combo players. *([ASAP: Using Arena](https://sites.google.com/view/asap-bg-to-mtga/using-arena), search summary)*

---

## Conflicts and gaps to verify (from gameplay video or the client)

1. **Phase marker position:** beside each avatar (most summaries), against "bottom right" (one Steam guide summary).
2. **Full control keys:** Ctrl is temporary and Ctrl+Shift is lasting (most sources), against one summary that gave the reverse.
3. **How long a stop lasts:** a single use versus persistent; also the default stop set. No official list found.
4. **Primary button position (bottom right is unconfirmed) and labels, and the "All Attack" / "No Attacks" / "No Blocks" wording:** not sourced.
5. **Exact positions** of library, graveyard and exile (left or right of the hand) and of the stack.
6. **Tapped-permanent rotation** in the current client (a slight tilt in 2018).
7. **How these look:** targeting arrows, the X picker, the modal-spell picker, the scry and search browsers, naming a card, choosing a player, ordering replacement effects, ordering triggers manually.
8. **Sounds and animations:** no sources; describe our own.
9. **Timer and timeout mechanics:** whether actions extend the timer or speed it up, where the timeout icon sits, and the count, length and earn rate of timeouts. All of these come only from community summaries and may be out of date.

## Hosts that need allowing for a deeper pass

- mtgarena-support.wizards.com (the official help centre: auto-tap, full control, timers)
- mtgazone.com, draftsim.com, sites.google.com (the ASAP guide)
- magicarena.fandom.com, mtg.fandom.com, mtg.wiki
- steamcommunity.com, feedback.wizards.com, reddit.com
- www.youtube.com, for gameplay video descriptions
