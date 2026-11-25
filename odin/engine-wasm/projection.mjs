// The game-relevant projection of a game state (D-187): what two engines must agree on for a captured test to pass,
// without the Rust engine's bookkeeping. Cards are named, not numbered: object ids, timestamps and the order of
// hidden zones after a shuffle are engine choices, so they are left out (a library is compared as its count and
// its cards, not their order). Everything a player can see or the rules read is kept: life, counters, mana, each
// zone's cards, every permanent's status, the stack, the turn and step, and whose decision the game waits for.
//
// Usage (as a module): import { project, firstDifference } from "./projection.mjs"

const nameOf = (state, id) => (id == null ? null : (objectsById(state).get(String(id))?.name ?? `#${id}`));

const cache = new WeakMap();
function objectsById(state) {
  let m = cache.get(state);
  if (!m) {
    m = new Map();
    const objs = state.objects ?? {};
    for (const [k, o] of Object.entries(objs)) m.set(String(o?.id ?? k), o);
    cache.set(state, m);
  }
  return m;
}

const sorted = (list) => [...list].sort();
const names = (state, ids) => (ids ?? []).map((id) => nameOf(state, id));

// Counters as a sorted list of [type, count], whatever map shape the state uses.
function counters(c) {
  if (!c) return [];
  const pairs = Array.isArray(c) ? c.map((e) => (Array.isArray(e) ? e : [e.counter_type ?? e.type, e.count])) : Object.entries(c);
  return pairs.map(([t, n]) => [typeof t === "string" ? t : JSON.stringify(t), n]).filter(([, n]) => n).sort();
}

function permanent(state, id) {
  const o = objectsById(state).get(String(id)) ?? {};
  return {
    name: o.name,
    owner: o.owner,
    controller: o.controller,
    tapped: !!o.tapped,
    power: o.power ?? null,
    toughness: o.toughness ?? null,
    loyalty: o.loyalty ?? null,
    damage: o.damage_marked ?? 0,
    counters: counters(o.counters),
    attached_to: nameOf(state, o.attached_to),
    face_down: !!o.face_down,
    transformed: !!o.transformed,
  };
}

// Whom the game waits for: the decision's kind and its player (or players).
function waiting(w) {
  if (!w) return null;
  const d = w.data ?? {};
  const players = d.player ?? d.players ?? d.pending?.map((p) => p.player) ?? d.winner ?? null;
  return { type: w.type, players };
}

export function project(state) {
  // get_game_state answers { state, derived }; an exported save wraps the state in an envelope.
  while (state && !state.players && state.state) state = state.state;
  return {
    turn: state.turn_number,
    active_player: state.active_player,
    phase: state.phase,
    priority_player: state.priority_player,
    waiting_for: waiting(state.waiting_for),
    players: (state.players ?? []).map((p) => ({
      id: p.id,
      life: p.life,
      poison: p.poison_counters ?? 0,
      energy: p.energy ?? 0,
      eliminated: !!p.is_eliminated,
      hand: sorted(names(state, p.hand)),
      library_count: (p.library ?? []).length,
      library: sorted(names(state, p.library)),
      graveyard: names(state, p.graveyard),
      mana_pool: p.mana_pool ?? null,
      lands_played_this_turn: p.lands_played_this_turn ?? 0,
    })),
    battlefield: (state.battlefield ?? []).map((id) => permanent(state, id)).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
    exile: sorted(names(state, state.exile)),
    command_zone: sorted(names(state, state.command_zone)),
    stack: (state.stack ?? []).map((e) => ({ source: nameOf(state, e.source_id ?? e.id ?? e.object_id), controller: e.controller ?? null, kind: e.kind?.type ?? e.type ?? null })),
  };
}

// The first place two projections differ: { path, a, b }, or null when equal.
export function firstDifference(a, b, path = "") {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = firstDifference(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
    // The same keys and values in another order (JSON.stringify above compares key order too).
    if (Array.isArray(a) === Array.isArray(b)) return null;
  }
  return { path, a, b };
}
