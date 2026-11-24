// Engine logic written by hand, where the translator can't produce it: functions with generic signatures and the
// internals of the persistent collections. Each mirrors the Rust function it names; translated code calls these.
// The vector check (odin/tools/vector-check.sh) covers them like translated procedures.
package types

// ObjectMap::get (types/object_map.rs): the object with this id, if any. Rust's is generic over `Borrow<Q>` only so
// that `&ObjectId` and `ObjectId` both work; every caller passes an ObjectId.
ObjectMap_get :: proc(self_: ObjectMap, id: ObjectId) -> Maybe(GameObject) {
	if self_.inner == nil do return nil
	if p, ok := self_.inner^[id]; ok && p != nil do return p^
	return nil
}
