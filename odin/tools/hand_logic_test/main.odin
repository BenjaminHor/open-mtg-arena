// Checks hand_logic.odin against the Rust engine's own behaviour, from values the real crates produced.
// Usage: odin run odin/tools/hand_logic_test
package hand_logic_test

import "core:fmt"
import "core:os"
import rng "../../engine/rng"
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
	m := make(map[types.ObjectId]^types.GameObject)
	for id in RUST_ORDER do m[id] = new(types.GameObject)
	om := types.ObjectMap{inner = &m}
	got := types.ObjectMap_keys(om)
	if len(got) != len(RUST_ORDER) {
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
	check_rng_word_pos()
}

// ObjectMap::get_mut is `Arc::make_mut` on the map and the object: a write through a clone's object leaves the
// original state's object (and map) untouched, and a second write through the same clone copies nothing again.
check_get_mut_copies_on_write :: proc() {
	m := types.shared_from(make(map[types.ObjectId]^types.GameObject))
	obj := types.shared_from(types.GameObject{})
	m^[7] = obj
	original := types.ObjectMap{inner = m}
	copy := types.clone_ObjectMap(original)
	p, ok := types.ObjectMap_get_mut(&copy, 7).?
	if !ok {
		fmt.eprintln("FAIL: get_mut found nothing")
		os.exit(1)
	}
	p.tapped = true
	if original.inner^[7].tapped || original.inner == copy.inner || original.inner^[7] == copy.inner^[7] {
		fmt.eprintln("FAIL: get_mut on a clone wrote into the original")
		os.exit(1)
	}
	q, _ := types.ObjectMap_get_mut(&copy, 7).?
	if q != p || !copy.inner^[7].tapped {
		fmt.eprintln("FAIL: a second get_mut copied again or lost the write")
		os.exit(1)
	}
	if _, none := types.ObjectMap_get_mut(&copy, 99).?; none {
		fmt.eprintln("FAIL: get_mut found a missing id")
		os.exit(1)
	}
	fmt.println("ok: ObjectMap.get_mut copies on write")
}

// rand_chacha's get_word_pos/set_word_pos, which the replay harness uses to restore the game RNG (GameState.rng is
// skipped on the wire; GameState::rehydrate_rng). Expected values printed by rand_chacha 0.9.0 itself, seed 7.
check_rng_word_pos :: proc() {
	fail :: proc(what: string, got, want: $T) {
		fmt.eprintln("FAIL: rng", what, got, "want", want)
		os.exit(1)
	}
	r := rng.from_u64(7)
	if p := rng.get_word_pos(&r); p != 0 do fail("fresh position", p, 0)
	for _ in 0 ..< 70 do rng.next_u32(&r)
	if p := rng.get_word_pos(&r); p != 70 do fail("position after 70 words", p, 70)
	if v := rng.next_u64(&r); v != 9740124526150893278 do fail("u64 at 70", v, 9740124526150893278)
	if p := rng.get_word_pos(&r); p != 72 do fail("position after a u64", p, 72)
	rng.set_word_pos(&r, 1000)
	if p := rng.get_word_pos(&r); p != 1000 do fail("position after seeking 1000", p, 1000)
	if v := rng.next_u32(&r); v != 2579269477 do fail("u32 at 1000", v, 2579269477)
	// A u64 straddling the buffer's end, from a seek to its last word.
	f := rng.from_u64(7)
	rng.set_word_pos(&f, 63)
	if v := rng.next_u64(&f); v != 8657037805721133790 do fail("u64 at 63", v, 8657037805721133790)
	if p := rng.get_word_pos(&f); p != 65 do fail("position after the straddling u64", p, 65)
	fmt.println("ok: rng word positions match rand_chacha")
}
