# The LLM opponent

An optional AI opponent played by a language model the player picks, through their own OpenRouter API key (M3-02b,
D-136). It's a harness built to play Magic through this engine, the way a coding agent's harness gives a model the
tools for programming: the model looks at the game, works things out with tools, and acts.

**Goal (D-137):** the player can't tell they're playing against an AI. The model knows exactly what a human player in
its seat knows, no less and no more, gets the same chances to act, and plays at a person's pace.

This spec is a draft agreed with the owner on 2026-11-22. Decisions: D-136, D-137, D-138.

## Shape

- **Package:** `packages/llm-agent`. It depends on `engine` for the per-player data every seat reads (`playerView` and
  `seenObjects`, D-135); it renders its own prompt text from them, as `brief` does in the CLI. It has no UI.
- **Two transports, one harness:** in the app, it runs in the match host's Web Worker and calls OpenRouter's API from
  the browser with the player's key (check early that OpenRouter accepts browser calls). In the CLI, the same harness
  plays games for testing and evaluation (`pnpm cli ai --agent llm`, and an evaluation command).
- **The key** is stored only on the device and sent only to OpenRouter. The settings screen takes the key and the
  model. The built-in heuristic AI stays the default, and the only opponent offline or without a key.

## The loop

Each time the LLM's player must decide, the match host hands the decision to the harness and waits, as it waits for a
human:

1. The harness sends a short situation message: the turn and step, what the decision is, and what happened since the
   model last acted (as `brief`'s "since you last acted"). The first time a card appears to this player in the game, its
   Oracle text and rulings come with the message (D-147), so the model rarely needs `get_card` and never falls back on
   what it remembers (D-146); the card texts sit early in the conversation and don't change, which helps prompt caching.
2. The model calls tools: to look, to work things out, to write a note.
3. The model calls an action tool. The harness checks it against the legal actions and applies it. A move that isn't
   legal is refused with the reason, and the model tries again.

The system prompt carries what doesn't change during a game: how the harness works, a short primer on reading the
tools' output, the deck's game plan, and (later) a persona. One conversation lasts the whole game, so the model keeps its
own reasoning from earlier decisions, trimmed as needed to fit the model's context.

## Tools

Every tool reads only the player's view (D-044, D-135). The leak test that guards `brief` (two worlds differing only in
hidden cards give the same output) runs on every tool's output, so the harness as a whole can't cheat.

**Looking**
- `get_state()`: the whole board as `brief` builds it: each player's life, counts and resources, each permanent in
  detail, the stack, the hand, the decision and the legal actions with their costs and targets.
- `get_card(name)`: what a card is and does: its Oracle text, types, cost, power and toughness, and its rulings (the
  pool's rulings files). **The model learns cards only from this tool, never from its training data** (owner,
  2026-11-22, D-146): its memory of a card can be wrong, out of date (errata), or about a different printing, and
  what counts is the card as this engine plays it. The system prompt says so; `get_state` shows each card's name with
  its current characteristics, so the model knows what to look up; looking up a card costs no thinking time.
- `get_history(fromTurn?)`: the events this player saw, the whole game or from a turn.
- `get_my_deck()`: the decklist, and what's left in the library (counts, never the order).
- `get_known_cards()`: what the opponent has shown this game, and cards this player knows the place of: in the
  opponent's hand (one they saw bounced there), on top or bottom of a library (one they put there).
- `inspect(permanent)`: why a permanent has its characteristics now (as `pnpm cli inspect`).
- `search_rules(query)`: the Comprehensive Rules, by number or phrase (`scripts/rule.mjs`'s search).

**Working things out (D-138: previews allowed). The harness computes facts, the model judges (D-147)**
- `clock()`: who has lethal damage on board right now (attacking with everything against every block the defender
  could make), how many turns each player has left at the current rate of damage, and whether this player dies next
  turn if it doesn't block or answer. Models misjudge races; this tells them.
- `what_could_they_have()`: the pool's cards the opponent could cast right now (instants, flash, activated abilities of
  what they control) with their untapped mana and the colors they've shown, so the model can play around a combat
  trick or a counterspell. From the card pool, which every player may know, never from the opponent's hidden hand or
  deck (D-044), and never from the model's memory (D-146).
- `preview_combat(attackers, blocks?)`: the engine plays the combat out and reports damage, deaths and life totals,
  for blocks given or for each block the opponent could make.
- `preview(action)`: what happens if this player takes the action and everyone then passes: the engine plays it
  forward on a world made only of what the player knows. Hidden cards are stand-ins, and where a hidden card would
  matter (a draw, the opponent's response) the preview stops and says so.
- `can_pay(action)`: whether the action's cost can be paid now, and with which sources.

**A check before big moves (D-147).** Before an attack, a block, or a spell or ability that costs most of its mana,
the harness runs `preview` itself and shows the outcome ("this attack loses your Hill Giant to their likely block"),
and the model confirms or changes its move. Small moves (a land, paying, an obvious target) aren't checked.

**Acting**
- `take_action(n)`: the numbered legal action.
- Readable forms for the common ones: `cast(card, targets?, x?)`, `activate(permanent, ability, targets?)`,
  `play_land(card)`, `declare_attackers([...])`, `declare_blockers([...])`, `pass()`. Each is turned into a legal
  action or refused with the reason.

**Being a player**
- `note(text)`: a scratchpad for this game ("holding Giant Growth for their blockers"), shown back in each situation
  message. No memory between games yet (D-138); the RPG may add it.
- `say(text)`: table talk, shown in the app beside the opponent. Flavor only; it never changes the game.

## Response windows and pacing

- The match host asks the LLM about every decision a human in its seat would face. Auto-pass may skip only what a
  human's auto-pass would (no castable instant, no activatable ability), so the model gets the same chances to respond
  with a trick or a counterspell.
- **Thinking limit (D-138): 30 seconds per decision.** At the limit, the heuristic AI decides that one decision. A fast
  model is expected to stay well inside it.
- Pacing reads as a person's: a forced or obvious answer is quick, a real decision takes its time. The app shows a
  thinking indicator, as for any opponent.

## Failure handling

- An invalid action call is refused with the reason; after three refusals in one decision the heuristic AI decides it.
- A network or API error, or no reply within the limit: the heuristic AI decides that decision, and the app shows a
  small notice. The game never stops for the model.
- Every request and reply can be logged to the replay's side file for debugging (off by default; the key is never
  logged).

## Evaluation

A CLI command plays N games between the LLM and a built-in agent and reports: wins, illegal attempts, decisions that fell
back to the heuristic AI, tool calls per decision, time per decision, and tokens used. Its transcripts show `get_card` looked up for the cards
it plays and faces, as D-146 asks. *Accept (M3-02b):* no illegal
action is ever applied, it beats the random agent in most games, and the owner plays a full game against it in the app.

## Open

- Personas: whether the owner writes them, the deck brings them, or both. Not decided (2026-11-22).
- Memory between games: a later feature, for the RPG.
