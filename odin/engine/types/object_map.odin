// ObjectMap: the Odin model's `GameState.objects` (types/object_map.rs, an `im::HashMap<ObjectId, Arc<GameObject>>`).
// Written by hand, not generated (odingen's `hand_types`): its layout is what makes a GameState clone cheap.
//
// Layout (docs/odin-port.md, "State layout"; D-186):
// - A persistent radix trie indexed by the id itself: nodes of OBJECT_MAP_FANOUT slots, 6 bits of the id per level,
//   the leaves holding shared `^GameObject`s. Ids are dense (1..N with a few gaps), so a game's 100-400 objects sit
//   in a root and a handful of leaves. Every node is a shared allocation (`shared_new`, a count before the value).
// - Cloning shares the root (one count). Writing an object copies the nodes on its path that others share (each
//   copy retains its children) and then the object (`make_mut`), as im's trie copies its path and `Arc::make_mut`
//   the object. A lookup is `height + 1` indexed loads, no hashing.
// - Iteration follows the Rust engine's order (D-182), kept as a shared list of the ids beside the trie: cloning
//   shares it, an insert or removal copies it if shared and puts the id in place.
// The procedures named after Rust's methods (`ObjectMap_get`, ...) are in hand_logic.odin, where the translator
// finds them; this file holds the type and its internals.
package types

import "core:slice"
import "core:strings"
import "../json"

OBJECT_MAP_BITS :: 6
OBJECT_MAP_FANOUT :: 1 << OBJECT_MAP_BITS
OBJECT_MAP_MASK :: OBJECT_MAP_FANOUT - 1

// A trie node. At height 0 a slot holds a `^GameObject`, above it a `^ObjectNode`; nil is empty.
ObjectNode :: struct {
	slots: [OBJECT_MAP_FANOUT]rawptr,
}

ObjectMap :: struct {
	root:   ^ObjectNode, // shared; nil when the map has never held an object
	height: uint, // levels above the leaves: the root covers ids below 64^(height+1)
	count:  int,
	order:  ^[dynamic]ObjectId, // shared; the ids in the Rust engine's iteration order (D-182)
}

// The object stored under `id`, or nil. Read-only: writes go through object_map_get_mut.
object_map_lookup :: #force_inline proc "contextless" (m: ObjectMap, id: ObjectId) -> ^GameObject {
	n := m.root
	k := u64(id)
	// Odin defines shifts at or past the width as 0, so this holds at every height.
	if n == nil || k >> (OBJECT_MAP_BITS * (m.height + 1)) != 0 do return nil
	for h := m.height; h > 0; h -= 1 {
		n = (^ObjectNode)(n.slots[(k >> (OBJECT_MAP_BITS * h)) & OBJECT_MAP_MASK])
		if n == nil do return nil
	}
	return (^GameObject)(n.slots[k & OBJECT_MAP_MASK])
}

// The node at `p^`, owned by this holder alone: created if missing, copied if shared (the copy retains every
// child, since it is a new holder of each).
@(private)
object_node_own :: proc(p: ^^ObjectNode) -> ^ObjectNode {
	n := p^
	if n == nil {
		n = shared_new(ObjectNode)
		p^ = n
		return n
	}
	if shared_count(n)^ > 1 {
		c := shared_new(ObjectNode)
		c.slots = n.slots
		for s in c.slots do if s != nil do shared_count((^u8)(s))^ += 1
		shared_count(n)^ -= 1
		p^ = c
		return c
	}
	return n
}

// Raises the trie until its root covers `id` (each new root holds the old one in slot 0, taking over its count).
@(private)
object_map_grow :: proc(m: ^ObjectMap, id: ObjectId) {
	if m.root == nil {
		m.height = 0
		for u64(id) >> (OBJECT_MAP_BITS * (m.height + 1)) != 0 do m.height += 1
		return
	}
	for u64(id) >> (OBJECT_MAP_BITS * (m.height + 1)) != 0 {
		r := shared_new(ObjectNode)
		r.slots[0] = m.root
		m.root = r
		m.height += 1
	}
}

// The leaf slot for `id` in a trie this map owns along the whole path (nodes created or copied as needed). The
// caller has checked that the root covers `id` (object_map_grow).
@(private)
object_map_slot_own :: proc(m: ^ObjectMap, id: ObjectId) -> ^rawptr {
	k := u64(id)
	n := object_node_own(&m.root)
	for h := m.height; h > 0; h -= 1 {
		n = object_node_own((^^ObjectNode)(&n.slots[(k >> (OBJECT_MAP_BITS * h)) & OBJECT_MAP_MASK]))
	}
	return &n.slots[k & OBJECT_MAP_MASK]
}

// Rust's `get_mut` with `Arc::make_mut`: this map's own copy of the object (copying the shared nodes on its path,
// then the object if shared), or nil when absent. An absent id changes nothing.
object_map_get_mut :: proc(m: ^ObjectMap, id: ObjectId) -> ^GameObject {
	if object_map_lookup(m^, id) == nil do return nil
	slot := (^^GameObject)(object_map_slot_own(m, id))
	return make_mut(slot, clone_GameObject)
}

// `Arc::unwrap_or_clone`: the value, moved out when this was its only holder, else a clone (the holder released).
@(private)
object_unwrap_or_clone :: proc(p: ^GameObject) -> GameObject {
	if shared_count(p)^ == 1 do return p^
	shared_count(p)^ -= 1
	return clone_GameObject(p^)
}

// D-182's order of two ids: by object_map_order_key (hand_logic.odin), then by id (never needed: equal keys would
// be a 32-bit hash collision, which im keeps in insertion order; object_map_insert asserts there is none).
@(private)
object_order_less :: proc(a, b: ObjectId) -> bool {
	ka, kb := object_map_order_key(a), object_map_order_key(b)
	return ka < kb || (ka == kb && a < b)
}

@(private)
object_order_own :: proc(m: ^ObjectMap) -> ^[dynamic]ObjectId {
	if m.order == nil {
		m.order = shared_new([dynamic]ObjectId)
		return m.order
	}
	return make_mut(&m.order, proc(x: [dynamic]ObjectId) -> [dynamic]ObjectId {
		out := make([dynamic]ObjectId, len(x), max(len(x) + 8, 16))
		copy(out[:], x[:])
		return out
	})
}

// The position of `id` in the order list, or where it would go.
@(private)
object_order_search :: proc(order: []ObjectId, id: ObjectId) -> (int, bool) {
	lo, hi := 0, len(order)
	for lo < hi {
		mid := (lo + hi) / 2
		if object_order_less(order[mid], id) do lo = mid + 1
		else do hi = mid
	}
	return lo, lo < len(order) && order[lo] == id
}

// Rust's `insert`: stores `object` under `id`, returning the object it replaces.
object_map_insert :: proc(m: ^ObjectMap, id: ObjectId, object: GameObject) -> Maybe(GameObject) {
	object_map_grow(m, id)
	slot := (^^GameObject)(object_map_slot_own(m, id))
	old := slot^
	slot^ = shared_from(object)
	if old != nil do return object_unwrap_or_clone(old)
	m.count += 1
	order := object_order_own(m)
	at, found := object_order_search(order^[:], id)
	assert(!found)
	assert(at == len(order) || object_map_order_key(order[at]) != object_map_order_key(id), "ObjectMap: 32-bit hash collision (D-182)")
	inject_at(order, at, id)
	return nil
}

// Rust's `remove`: takes the object out, if present.
object_map_remove :: proc(m: ^ObjectMap, id: ObjectId) -> Maybe(GameObject) {
	if object_map_lookup(m^, id) == nil do return nil
	slot := (^^GameObject)(object_map_slot_own(m, id))
	old := slot^
	slot^ = nil
	m.count -= 1
	order := object_order_own(m)
	at, found := object_order_search(order^[:], id)
	assert(found)
	ordered_remove(order, at)
	return object_unwrap_or_clone(old)
}

// Building a map nothing shares yet (decoding): objects go straight in; object_map_finish_order sorts the ids once.
@(private)
object_map_build_insert :: proc(m: ^ObjectMap, id: ObjectId, object: ^GameObject) {
	object_map_grow(m, id)
	slot := (^^GameObject)(object_map_slot_own(m, id))
	if slot^ == nil {
		m.count += 1
		if m.order == nil do m.order = shared_new([dynamic]ObjectId)
		append(m.order, id)
	}
	slot^ = object
}

@(private)
object_map_finish_order :: proc(m: ^ObjectMap) {
	if m.order != nil do slice.sort_by(m.order^[:], object_order_less)
}

// Visits the objects in ascending id order (the trie's own order).
object_map_walk_ascending :: proc(m: ObjectMap, visit: proc(id: ObjectId, o: ^GameObject, data: rawptr), data: rawptr) {
	walk :: proc(n: ^ObjectNode, h: uint, base: u64, visit: proc(id: ObjectId, o: ^GameObject, data: rawptr), data: rawptr) {
		for s, i in n.slots {
			if s == nil do continue
			k := base | u64(i) << (OBJECT_MAP_BITS * h)
			if h == 0 do visit(ObjectId(k), (^GameObject)(s), data)
			else do walk((^ObjectNode)(s), h - 1, k, visit, data)
		}
	}
	if m.root != nil do walk(m.root, m.height, 0, visit, data)
}

// Rust's Clone: shares the trie and the order list.
clone_ObjectMap :: proc(x: ObjectMap) -> ObjectMap {
	shared_retain(x.root)
	shared_retain(x.order)
	return x
}

// The map as Rust's `Deserialize` reads it: an object keyed by the id's decimal string.
decode_ObjectMap :: proc(v: json.Value, out: ^ObjectMap) -> bool {
	when COVERAGE do cov_hit("hand:ObjectMap")
	if v.kind != .Object do return fail("ObjectMap: expected an object (map)")
	out^ = {}
	for m in v.members {
		id: ObjectId
		if !decode_ObjectId(json.Value{kind = .Number, text = m.key}, &id) do return false
		p := shared_new(GameObject)
		if !decode_GameObject(m.value, p) do return false
		object_map_build_insert(out, id, p)
	}
	object_map_finish_order(out)
	return true
}

// Rust's `Serialize` (the map's iteration order, D-182).
encode_ObjectMap :: proc(b: ^strings.Builder, x: ObjectMap) {
	strings.write_byte(b, '{')
	if x.order != nil {
		for id, i in x.order^ {
			if i > 0 do strings.write_byte(b, ',')
			strings.write_byte(b, '"'); encode_ObjectId(b, id); strings.write_byte(b, '"')
			strings.write_byte(b, ':')
			encode_GameObject(b, object_map_lookup(x, id)^)
		}
	}
	strings.write_byte(b, '}')
}

// types/object_map.rs serialize_sorted: GameState.objects written in ascending ObjectId order.
encode_with_sorted :: proc(b: ^strings.Builder, x: ObjectMap) {
	strings.write_byte(b, '{')
	first := true
	State :: struct { b: ^strings.Builder, first: ^bool }
	st := State{b, &first}
	object_map_walk_ascending(x, proc(id: ObjectId, o: ^GameObject, data: rawptr) {
		st := (^State)(data)
		if !st.first^ do strings.write_byte(st.b, ',')
		st.first^ = false
		strings.write_byte(st.b, '"'); encode_ObjectId(st.b, id); strings.write_byte(st.b, '"')
		strings.write_byte(st.b, ':')
		encode_GameObject(st.b, o^)
	}, &st)
	strings.write_byte(b, '}')
}
