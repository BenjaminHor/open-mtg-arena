// Prints the same RNG test vectors as odin/spike/rng-vectors (Rust), from the Odin port, for a byte-for-byte diff.
package rng_vectors

import "core:fmt"
import "core:strings"
import rng "../rng"

SEEDS := [6]u64{0, 1, 42, 0xDEAD_BEEF, 0x0123_4567_89AB_CDEF, max(u64)}

line :: proc(seed: u64, label: string, items: []string) {
	fmt.printf("seed %v %v %v\n", seed, label, strings.join(items, " ", context.temp_allocator))
}

main :: proc() {
	for seed in SEEDS {
		items := make([dynamic]string, context.temp_allocator)

		r := rng.from_u64(seed)
		for _ in 0 ..< 70 do append(&items, fmt.tprint(rng.next_u32(&r)))
		line(seed, "u32", items[:]); clear(&items)

		r = rng.from_u64(seed)
		rng.next_u32(&r)
		for _ in 0 ..< 40 do append(&items, fmt.tprint(rng.next_u64(&r)))
		line(seed, "u64odd", items[:]); clear(&items)

		r = rng.from_u64(seed)
		for n in ([]int{0, 1, 2, 3, 7, 13, 40, 60, 100, 250}) {
			v := make([]int, n, context.temp_allocator)
			for i in 0 ..< n do v[i] = i
			rng.shuffle(&r, v)
			for x in v do append(&items, fmt.tprint(x))
			line(seed, fmt.tprintf("shuffle%v", n), items[:]); clear(&items)
		}

		r = rng.from_u64(seed)
		for n in ([]u32{1, 2, 3, 6, 10, 20, 60, 1000, 1 << 20, max(u32) - 1}) {
			for _ in 0 ..< 5 do append(&items, fmt.tprint(rng.range_u32(&r, 0, n)))
		}
		for _ in 0 ..< 5 {
			append(&items, fmt.tprint(1 + rng.u32_inclusive_offset(&r, 6))) // 1..=6u32
			append(&items, fmt.tprint(rng.range_i32_inclusive(&r, -3, 3)))
			append(&items, fmt.tprint(rng.range_u64(&r, 0, max(u64))))
			append(&items, fmt.tprint(u8(rng.range_u32(&r, 10, 20)))) // 10u8..20
		}
		line(seed, "range", items[:]); clear(&items)

		r = rng.from_u64(seed)
		for p in ([]f64{0.0, 0.25, 0.5, 1.0 / 3.0, 0.9, 1.0}) {
			for _ in 0 ..< 8 do append(&items, rng.random_bool(&r, p) ? "1" : "0")
		}
		line(seed, "bool", items[:]); clear(&items)

		r = rng.from_u64(seed)
		for n in ([]int{1, 2, 5, 17, 99}) {
			for _ in 0 ..< 4 do append(&items, fmt.tprint(rng.choose_index(&r, n)))
		}
		line(seed, "choose", items[:]); clear(&items)

		free_all(context.temp_allocator)
	}
}
