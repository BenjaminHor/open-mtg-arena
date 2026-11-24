// Checks hand_logic.odin against the Rust engine's own behaviour, from values the real crates produced.
// Usage: odin run odin/tools/hand_logic_test
package hand_logic_test

import "core:fmt"
import "core:os"
import types "../../engine/types"

// The iteration order of an im::HashMap<ObjectId, _, FxBuildHasher> (im 15, rustc-hash 2, 64-bit) after inserting ids
// 1..=400, removing 5, 77, 123 and 300, and inserting 100000 and 123456789: printed by a probe against the real
// crates (D-182).
RUST_ORDER := [?]types.ObjectId{
	398, 44, 269, 140, 11, 280, 151, 22, 291, 162, 387, 33, 258, 129, 302, 173, 88, 313, 184, 55,
	324, 195, 66, 335, 206, 250, 121, 346, 217, 132, 357, 3, 228, 99, 368, 239, 110, 379, 25, 294,
	165, 390, 36, 261, 176, 47, 272, 143, 14, 283, 154, 327, 198, 69, 338, 209, 80, 305, 220, 91,
	316, 187, 58, 371, 242, 113, 382, 253, 124, 349, 264, 135, 360, 6, 231, 102, 50, 275, 146, 17,
	286, 157, 28, 297, 168, 393, 39, 308, 179, 352, 223, 94, 319, 190, 61, 330, 201, 72, 341, 212,
	83, 396, 267, 138, 363, 9, 234, 105, 374, 245, 116, 385, 256, 127, 171, 42, 311, 182, 53, 278,
	149, 20, 289, 160, 31, 75, 344, 215, 86, 355, 226, 97, 322, 193, 64, 333, 204, 377, 248, 119,
	388, 259, 130, 1, 399, 270, 141, 366, 12, 237, 108, 23, 292, 163, 34, 303, 174, 45, 314, 185,
	56, 281, 152, 100, 325, 196, 67, 336, 207, 78, 347, 218, 89, 358, 229, 273, 144, 369, 15, 240,
	111, 380, 251, 122, 391, 262, 133, 4, 48, 317, 188, 59, 284, 155, 26, 295, 166, 37, 306, 177,
	350, 221, 92, 361, 232, 103, 328, 199, 70, 339, 123456789, 210, 81, 125, 394, 265, 136, 7, 276, 147,
	372, 18, 243, 114, 383, 254, 298, 169, 40, 309, 180, 51, 320, 191, 62, 287, 158, 29, 73, 342,
	213, 84, 353, 224, 95, 364, 235, 106, 331, 202, 150, 375, 21, 246, 117, 386, 257, 128, 100000, 397,
	268, 139, 10, 279, 323, 194, 65, 290, 161, 32, 301, 172, 43, 312, 183, 54, 98, 367, 238, 109,
	334, 205, 76, 345, 216, 87, 356, 227, 400, 271, 142, 13, 282, 153, 378, 24, 249, 120, 389, 260,
	131, 2, 175, 46, 315, 186, 57, 326, 197, 68, 293, 164, 35, 304, 348, 219, 90, 359, 230, 101,
	370, 241, 112, 337, 208, 79, 392, 263, 134, 274, 145, 16, 285, 156, 381, 27, 252, 200, 71, 296,
	167, 38, 307, 178, 49, 318, 189, 60, 329, 373, 244, 115, 340, 211, 82, 351, 222, 93, 362, 233,
	104, 148, 19, 288, 159, 384, 30, 255, 126, 395, 266, 137, 8, 277, 321, 192, 63, 332, 203, 74,
	299, 170, 41, 310, 181, 52, 225, 96, 365, 236, 107, 376, 247, 118, 343, 214, 85, 354,
}

main :: proc() {
	// Inserted in RUST_ORDER's own order, then removed and re-inserted, so the order can't come from insertion.
	om: types.ObjectMap
	for id in RUST_ORDER do types.ObjectMap_insert(&om, id, types.GameObject{})
	for id in ([]types.ObjectId{1, 2, 3, 100000}) {
		types.ObjectMap_remove(&om, id)
		types.ObjectMap_insert(&om, id, types.GameObject{})
	}
	got := types.ObjectMap_keys(om)
	if len(got) != len(RUST_ORDER) || types.ObjectMap_len(om) != len(RUST_ORDER) {
		fmt.eprintln("FAIL: ObjectMap_keys length", len(got), "want", len(RUST_ORDER))
		os.exit(1)
	}
	for id, i in RUST_ORDER {
		if got[i] != id {
			fmt.eprintln("FAIL: ObjectMap order differs at", i, ":", got[i], "want", id)
			os.exit(1)
		}
	}
	fmt.println("ok: ObjectMap iterates in the Rust order (", len(got), "ids )")
	check_get_mut_copies_on_write()
	check_insert_remove_on_clones()
}

fail :: proc(msg: ..any) {
	fmt.eprintln(..msg)
	os.exit(1)
}

// ObjectMap::get_mut is `Arc::make_mut` on the trie path and the object: a write through a clone's object leaves the
// original state's object (and trie) untouched, and a second write through the same clone copies nothing again.
check_get_mut_copies_on_write :: proc() {
	original: types.ObjectMap
	for id in 1 ..= types.ObjectId(200) do types.ObjectMap_insert(&original, id, types.GameObject{})
	before_7 := types.object_map_lookup(original, 7)
	copy := types.clone_ObjectMap(original)
	if !types.ObjectMap_ptr_eq(original, copy) do fail("FAIL: a clone doesn't share the trie")
	p, ok := types.ObjectMap_get_mut(&copy, 7).?
	if !ok do fail("FAIL: get_mut found nothing")
	p.tapped = true
	if types.object_map_lookup(original, 7).tapped || types.object_map_lookup(original, 7) != before_7 || types.ObjectMap_ptr_eq(original, copy) {
		fail("FAIL: get_mut on a clone wrote into the original")
	}
	// Only object 7 is unshared; its neighbours in the copied leaf are still the original's allocations.
	if !types.ObjectMap_shares_object_with(original, copy, 8) || types.ObjectMap_shares_object_with(original, copy, 7) {
		fail("FAIL: get_mut unshared more (or less) than the written object")
	}
	unshared := types.ObjectMap_unshared_ids(original, copy)
	if len(unshared) != 1 || unshared[0] != 7 do fail("FAIL: unshared_ids", unshared)
	q, _ := types.ObjectMap_get_mut(&copy, 7).?
	if q != p || !types.object_map_lookup(copy, 7).tapped do fail("FAIL: a second get_mut copied again or lost the write")
	if _, found := types.ObjectMap_get_mut(&copy, 999).?; found do fail("FAIL: get_mut found a missing id")
	if _, found := types.ObjectMap_get(copy, 0).?; found do fail("FAIL: get found id 0")
	// The original's own write, after the clone wrote: copies again (its nodes were shared), the copy keeps its own.
	r, _ := types.ObjectMap_get_mut(&original, 7).?
	if r == p || r.tapped do fail("FAIL: the original's write saw the clone's object")
	fmt.println("ok: ObjectMap.get_mut copies on write")
}

// Inserting into or removing from a clone leaves the original's objects and order alone; ids beyond the root's
// range raise the trie.
check_insert_remove_on_clones :: proc() {
	original: types.ObjectMap
	for id in 1 ..= types.ObjectId(70) do types.ObjectMap_insert(&original, id, types.GameObject{})
	copy := types.clone_ObjectMap(original)
	big := types.ObjectId(1) << 40
	types.ObjectMap_insert(&copy, big, types.GameObject{tapped = true})
	removed, had := types.ObjectMap_remove(&copy, 3).?
	_ = removed
	if !had do fail("FAIL: remove found nothing")
	if types.ObjectMap_len(original) != 70 || types.ObjectMap_len(copy) != 70 do fail("FAIL: lengths", types.ObjectMap_len(original), types.ObjectMap_len(copy))
	if !types.ObjectMap_contains_key(original, 3) || types.ObjectMap_contains_key(copy, 3) do fail("FAIL: remove reached the original")
	if types.ObjectMap_contains_key(original, big) || !types.object_map_lookup(copy, big).tapped do fail("FAIL: insert reached the original")
	if len(types.ObjectMap_keys(original)) != 70 || len(types.ObjectMap_keys(copy)) != 70 do fail("FAIL: order lengths")
	replaced, had_big := types.ObjectMap_insert(&copy, big, types.GameObject{}).?
	if !had_big || !replaced.tapped do fail("FAIL: insert didn't return the replaced object")
	for id in types.ObjectMap_keys(copy) do if types.object_map_lookup(copy, id) == nil do fail("FAIL: an ordered id has no object", id)
	fmt.println("ok: ObjectMap insert and remove on a clone leave the original alone")
}
