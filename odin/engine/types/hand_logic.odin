// Engine logic written by hand, where the translator can't produce it: functions with generic signatures and the
// internals of the persistent collections. Each mirrors the Rust function it names; translated code calls these.
// The vector check (odin/tools/vector-check.sh) covers them like translated procedures.
package types

import "core:slice"

// ObjectMap's methods (types/object_map.rs), over the layout in object_map.odin. Rust's iterators return Vecs in
// its order (D-182); `Option<&GameObject>` is a copy of the object (the translator's mapping), and
// object_map_lookup is the pointer form.

// ObjectMap::get: the object with this id, if any. Rust's is generic over `Borrow<Q>` only so that `&ObjectId` and
// `ObjectId` both work; every caller passes an ObjectId.
ObjectMap_get :: proc(self_: ObjectMap, id: ObjectId) -> Maybe(GameObject) {
	if p := object_map_lookup(self_, id); p != nil do return p^
	return nil
}

ObjectMap_new :: proc() -> ObjectMap {
	return {}
}

ObjectMap_len :: proc(self_: ObjectMap) -> int {
	return self_.count
}

ObjectMap_is_empty :: proc(self_: ObjectMap) -> bool {
	return self_.count == 0
}

// Drops this map's hold on its trie and order (a clone keeps them).
ObjectMap_clear :: proc(self_: ^ObjectMap) {
	if self_.root != nil do shared_count(self_.root)^ -= 1
	if self_.order != nil do shared_count(self_.order)^ -= 1
	self_^ = {}
}

ObjectMap_contains_key :: proc(self_: ObjectMap, id: ObjectId) -> bool {
	return object_map_lookup(self_, id) != nil
}

// ObjectMap::get_mut: `inner.get_mut(id).map(Arc::make_mut)`. This state's own copy of the object: the trie nodes
// on its path are copied if another map shares them, then the object if another map shares it.
ObjectMap_get_mut :: proc(self_: ^ObjectMap, id: ObjectId) -> Maybe(^GameObject) {
	if p := object_map_get_mut(self_, id); p != nil do return p
	return nil
}

ObjectMap_insert :: proc(self_: ^ObjectMap, id: ObjectId, object: GameObject) -> Maybe(GameObject) {
	return object_map_insert(self_, id, object)
}

ObjectMap_remove :: proc(self_: ^ObjectMap, id: ObjectId) -> Maybe(GameObject) {
	return object_map_remove(self_, id)
}

// `map[&id]` (Index): Rust panics on an absent id, so does this.
ObjectMap_index :: proc(self_: ObjectMap, id: ObjectId) -> ^GameObject {
	p := object_map_lookup(self_, id)
	assert(p != nil, "ObjectMap: no object with this id")
	return p
}

// `&mut map[&id]` (IndexMut): copy-on-write; never inserts.
ObjectMap_index_mut :: proc(self_: ^ObjectMap, id: ObjectId) -> ^GameObject {
	p := object_map_get_mut(self_, id)
	assert(p != nil, "ObjectMap: no object with this id")
	return p
}

// ObjectMap::ptr_eq: both maps share one root (so hold the same objects); false says nothing.
ObjectMap_ptr_eq :: proc(self_: ObjectMap, other: ObjectMap) -> bool {
	return self_.root == other.root && self_.height == other.height
}

// ObjectMap::shares_object_with: `id` is in both maps as the same allocation.
ObjectMap_shares_object_with :: proc(self_: ObjectMap, other: ObjectMap, id: ObjectId) -> bool {
	a, b := object_map_lookup(self_, id), object_map_lookup(other, id)
	return a != nil && a == b
}

// ObjectMap::unshared_ids: the ids present in one map only or as different allocations, ascending (a BTreeSet).
// Rust compares entry by entry; subtrees both tries share are skipped here, which gives the same set.
ObjectMap_unshared_ids :: proc(self_: ObjectMap, other: ObjectMap) -> [dynamic]ObjectId {
	out := make([dynamic]ObjectId)
	if ObjectMap_ptr_eq(self_, other) do return out
	if self_.order != nil do for id in self_.order^ do if !ObjectMap_shares_object_with(self_, other, id) do append(&out, id)
	if other.order != nil {
		for id in other.order^ do if object_map_lookup(self_, id) == nil do append(&out, id)
	}
	slice.sort(out[:])
	return out
}

// ObjectMap::restricted_to: the entries of `ids` this map holds, sharing their objects.
ObjectMap_restricted_to :: proc(self_: ObjectMap, ids: [dynamic]ObjectId) -> ObjectMap {
	out: ObjectMap
	for id in ids {
		if p := object_map_lookup(self_, id); p != nil {
			shared_retain(p)
			object_map_build_insert(&out, id, p)
		}
	}
	object_map_finish_order(&out)
	return out
}

// D-182: the Rust ObjectMap (an `im::HashMap` with FxHash) iterates in an order that is a pure function of the ids:
// its hash trie is walked by the 32-bit hash's 5-bit chunks from the lowest, and the hash of ObjectId(i) is
// rustc-hash's FxHash on 64 bits, `(i * K) rotl 26`, truncated to u32. Sorting by those chunks, lowest first,
// reproduces it (checked against the real crates, removals included). This is the native (64-bit) order the
// recordings use; a 32-bit build hashes differently (D-182).
object_map_order_key :: proc(id: ObjectId) -> u64 {
	K :: u64(0xf1357aea2e62a9c5)
	x := u64(id) * K
	h := u32((x << 26) | (x >> 38))
	key: u64 = 0
	for level in 0 ..< 7 {
		key = key << 5 | u64(h >> (5 * u32(level))) & 31
	}
	return key
}

// The ids of an ObjectMap in Rust's iteration order (a copy: callers may change the map while walking it).
object_map_ordered_ids :: proc(self_: ObjectMap) -> [dynamic]ObjectId {
	if self_.order == nil do return make([dynamic]ObjectId)
	ids := make([dynamic]ObjectId, len(self_.order))
	copy(ids[:], self_.order^[:])
	return ids
}

// ObjectMap::keys, ::values and ::iter (types/object_map.rs): Rust's iterators, as Vecs in its order.
ObjectMap_keys :: proc(self_: ObjectMap) -> [dynamic]ObjectId {
	return object_map_ordered_ids(self_)
}

ObjectMap_values :: proc(self_: ObjectMap) -> [dynamic]GameObject {
	out := make([dynamic]GameObject, 0, self_.count)
	if self_.order != nil do for id in self_.order^ do append(&out, object_map_lookup(self_, id)^)
	return out
}

ObjectMap_iter :: proc(self_: ObjectMap) -> [dynamic]Tuple2(ObjectId, GameObject) {
	out := make([dynamic]Tuple2(ObjectId, GameObject), 0, self_.count)
	if self_.order != nil {
		for id in self_.order^ do append(&out, Tuple2(ObjectId, GameObject){id, object_map_lookup(self_, id)^})
	}
	return out
}
