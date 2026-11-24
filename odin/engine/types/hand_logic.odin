// Engine logic written by hand, where the translator can't produce it: functions with generic signatures and the
// internals of the persistent collections. Each mirrors the Rust function it names; translated code calls these.
// The vector check (odin/tools/vector-check.sh) covers them like translated procedures.
package types

import "core:slice"

// ObjectMap::get (types/object_map.rs): the object with this id, if any. Rust's is generic over `Borrow<Q>` only so
// that `&ObjectId` and `ObjectId` both work; every caller passes an ObjectId.
ObjectMap_get :: proc(self_: ObjectMap, id: ObjectId) -> Maybe(GameObject) {
	if self_.inner == nil do return nil
	if p, ok := self_.inner^[id]; ok && p != nil do return p^
	return nil
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

// The ids of an ObjectMap in Rust's iteration order.
object_map_ordered_ids :: proc(self_: ObjectMap) -> [dynamic]ObjectId {
	ids := make([dynamic]ObjectId)
	if self_.inner == nil do return ids
	for id in self_.inner^ do append(&ids, id)
	slice.sort_by(ids[:], proc(a, b: ObjectId) -> bool {
		ka, kb := object_map_order_key(a), object_map_order_key(b)
		return ka < kb || (ka == kb && a < b)
	})
	return ids
}

// ObjectMap::keys, ::values and ::iter (types/object_map.rs): Rust's iterators, as Vecs in its order.
ObjectMap_keys :: proc(self_: ObjectMap) -> [dynamic]ObjectId {
	return object_map_ordered_ids(self_)
}

ObjectMap_values :: proc(self_: ObjectMap) -> [dynamic]GameObject {
	out := make([dynamic]GameObject)
	for id in object_map_ordered_ids(self_) do append(&out, self_.inner^[id]^)
	return out
}

ObjectMap_iter :: proc(self_: ObjectMap) -> [dynamic]Tuple2(ObjectId, GameObject) {
	out := make([dynamic]Tuple2(ObjectId, GameObject))
	for id in object_map_ordered_ids(self_) do append(&out, Tuple2(ObjectId, GameObject){id, self_.inner^[id]^})
	return out
}
