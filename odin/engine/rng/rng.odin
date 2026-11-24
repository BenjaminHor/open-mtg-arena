// The engine's random number generator, reproduced bit for bit (O-0 spike, docs/odin-port.md, D-179).
//
// The Rust engine's `GameRng` is rand_chacha 0.9.0's `ChaCha20Rng::seed_from_u64(seed)`, and it draws with
// rand 0.9.4's `shuffle`, `random_range`, `choose` and `random_bool`. Seeds, recordings and saved replays carry over
// between the two engines only if every one of these returns exactly what the Rust crates return, so each procedure
// below follows the crate source line for line (paths in the comments). odin/spike/rng-vectors prints the Rust side; odin/spike/rng_vectors the Odin side.
package rng

// rand_chacha keeps 4 ChaCha blocks (64 words) per refill: chacha.rs BUF_BLOCKS = 4, BLOCK_WORDS = 16.
BUF_WORDS :: 64

Chacha20 :: struct {
	key:     [8]u32, // the 32-byte seed, read as little-endian words
	counter: u64,    // block counter, words 12-13 of the ChaCha state
	stream:  u64,    // nonce, words 14-15 (always 0 for seed_from_u64)
	results: [BUF_WORDS]u32,
	index:   int,    // next unread word; BUF_WORDS means "refill first" (rand_core block.rs BlockRng::new)
}

// rand_core 0.9.5 lib.rs `seed_from_u64`: PCG32 expands the u64 into the 32-byte seed, 4 bytes per step, written
// little-endian, so each output is one key word.
from_u64 :: proc(seed: u64) -> Chacha20 {
	PCG_MUL :: u64(6364136223846793005)
	PCG_INC :: u64(11634580027462260723)
	r: Chacha20
	state := seed
	for i in 0 ..< 8 {
		state = state * PCG_MUL + PCG_INC // wrapping, as Odin's unsigned arithmetic is
		xorshifted := u32(((state >> 18) ~ state) >> 27)
		rot := u32(state >> 59)
		r.key[i] = (xorshifted >> rot) | (xorshifted << ((32 - rot) & 31))
	}
	r.index = BUF_WORDS
	return r
}

@(private)
quarter_round :: #force_inline proc(x: ^[16]u32, a, b, c, d: int) {
	x[a] += x[b]; x[d] ~= x[a]; x[d] = (x[d] << 16) | (x[d] >> 16)
	x[c] += x[d]; x[b] ~= x[c]; x[b] = (x[b] << 12) | (x[b] >> 20)
	x[a] += x[b]; x[d] ~= x[a]; x[d] = (x[d] << 8) | (x[d] >> 24)
	x[c] += x[d]; x[b] ~= x[c]; x[b] = (x[b] << 7) | (x[b] >> 25)
}

// rand_chacha guts.rs `refill_wide_impl`: four consecutive 20-round ChaCha blocks (counter, counter+1, ...), each the
// standard state "expand 32-byte k" | key | 64-bit counter | 64-bit stream, then the counter advances by 4.
@(private)
refill :: proc(r: ^Chacha20) {
	for blk in 0 ..< 4 {
		ctr := r.counter + u64(blk)
		s := [16]u32{
			0x6170_7865, 0x3320_646e, 0x7962_2d32, 0x6b20_6574,
			r.key[0], r.key[1], r.key[2], r.key[3], r.key[4], r.key[5], r.key[6], r.key[7],
			u32(ctr), u32(ctr >> 32), u32(r.stream), u32(r.stream >> 32),
		}
		x := s
		for _ in 0 ..< 10 { // 20 rounds = 10 double rounds
			quarter_round(&x, 0, 4, 8, 12); quarter_round(&x, 1, 5, 9, 13)
			quarter_round(&x, 2, 6, 10, 14); quarter_round(&x, 3, 7, 11, 15)
			quarter_round(&x, 0, 5, 10, 15); quarter_round(&x, 1, 6, 11, 12)
			quarter_round(&x, 2, 7, 8, 13); quarter_round(&x, 3, 4, 9, 14)
		}
		for w in 0 ..< 16 do r.results[blk * 16 + w] = x[w] + s[w]
	}
	r.counter += 4
}

// rand_core block.rs `BlockRng::next_u32`.
next_u32 :: proc(r: ^Chacha20) -> u32 {
	if r.index >= BUF_WORDS {
		refill(r)
		r.index = 0
	}
	v := r.results[r.index]
	r.index += 1
	return v
}

// rand_core block.rs `BlockRng::next_u64`: low word first; a u64 that would straddle the buffer takes the last word
// as its low half and the first word of the next buffer as its high half.
next_u64 :: proc(r: ^Chacha20) -> u64 {
	if r.index < BUF_WORDS - 1 {
		v := u64(r.results[r.index]) | (u64(r.results[r.index + 1]) << 32)
		r.index += 2
		return v
	} else if r.index >= BUF_WORDS {
		refill(r)
		r.index = 2
		return u64(r.results[0]) | (u64(r.results[1]) << 32)
	}
	lo := u64(r.results[BUF_WORDS - 1])
	refill(r)
	r.index = 1
	return lo | (u64(r.results[0]) << 32)
}

// rand 0.9.4 distr/uniform_int.rs `sample_single_inclusive` (not the "unbiased" feature, which the engine doesn't
// enable), for the types sampled through u32 (u8, u16, u32, i8, i16, i32, and usize up to u32::MAX, see
// `UniformUsize`): Canon's method, one widening multiply plus at most one more draw. Returns the offset from low.
u32_inclusive_offset :: proc(r: ^Chacha20, range: u32) -> u32 {
	if range == 0 do return next_u32(r) // the whole u32 domain
	m := u64(next_u32(r)) * u64(range)
	result, lo_order := u32(m >> 32), u32(m)
	if lo_order > -range { // range.wrapping_neg()
		new_hi := u32((u64(next_u32(r)) * u64(range)) >> 32)
		if u64(lo_order) + u64(new_hi) > u64(max(u32)) do result += 1
	}
	return result
}

// The same for u64 and i64 ranges (sampled through u64).
u64_inclusive_offset :: proc(r: ^Chacha20, range: u64) -> u64 {
	if range == 0 do return next_u64(r)
	m := u128(next_u64(r)) * u128(range)
	result, lo_order := u64(m >> 64), u64(m)
	if lo_order > -range {
		new_hi := u64((u128(next_u64(r)) * u128(range)) >> 64)
		if u128(lo_order) + u128(new_hi) > u128(max(u64)) do result += 1
	}
	return result
}

// `rng.random_range(low..high)` for usize/u32 (exclusive high): sample_single is sample_single_inclusive(low, high-1).
range_u32 :: proc(r: ^Chacha20, low, high: u32) -> u32 {
	assert(low < high)
	return low + u32_inclusive_offset(r, high - 1 - low + 1)
}

// `rng.random_range(low..=high)` for i32: the range is computed in u32 (wrapping), the offset added to low.
range_i32_inclusive :: proc(r: ^Chacha20, low, high: i32) -> i32 {
	assert(low <= high)
	range := u32(high) - u32(low) + 1
	return i32(u32(low) + u32_inclusive_offset(r, range))
}

// `rng.random_range(low..high)` for u64 (exclusive high).
range_u64 :: proc(r: ^Chacha20, low, high: u64) -> u64 {
	assert(low < high)
	return low + u64_inclusive_offset(r, high - 1 - low + 1)
}

// rand 0.9.4 distr/bernoulli.rs: p is scaled to a u64 threshold (p = 1 always true, no draw); otherwise one u64 is
// drawn and compared, even for p = 0.
random_bool :: proc(r: ^Chacha20, p: f64) -> bool {
	assert(p >= 0 && p <= 1)
	if p == 1 do return true
	SCALE :: 2.0 * f64(u64(1) << 63)
	p_int := u64(p * SCALE)
	return next_u64(r) < p_int
}

// rand 0.9.4 seq/slice.rs `choose`: `random_range(..len)`.
choose_index :: proc(r: ^Chacha20, len: int) -> int {
	assert(len > 0)
	return int(range_u32(r, 0, u32(len)))
}

// rand 0.9.4 seq/increasing_uniform.rs `calculate_bound_u32`: the largest product m*(m+1)*... that fits in a u32,
// and how many factors it took.
@(private)
calculate_bound_u32 :: proc(m: u32) -> (bound: u32, count: u8) {
	product := u64(m)
	current := u64(m) + 1
	for {
		p := product * current
		if p > u64(max(u32)) do return u32(product), u8(current - u64(m))
		product = p
		current += 1
	}
}

// rand 0.9.4 seq/slice.rs `shuffle` → `partial_shuffle(len)`, Durstenfeld's Fisher-Yates driven by
// `IncreasingUniform`, which draws one u32 and spends it on several swap indices.
shuffle :: proc(r: ^Chacha20, s: []$T) {
	if len(s) <= 1 do return
	n: u32 = 0 // IncreasingUniform::new(rng, m) with m = len - amount = 0
	chunk: u32 = 0
	chunk_remaining: u8 = 1 // n == 0
	for i in 0 ..< len(s) {
		next_n := n + 1
		next_chunk_remaining: u8
		if chunk_remaining > 0 {
			next_chunk_remaining = chunk_remaining - 1
		} else {
			bound, remaining := calculate_bound_u32(next_n)
			chunk = range_u32(r, 0, bound)
			next_chunk_remaining = remaining - 1
		}
		index: u32
		if next_chunk_remaining == 0 {
			index = chunk
		} else {
			index = chunk % next_n
			chunk /= next_n
		}
		chunk_remaining = next_chunk_remaining
		n = next_n
		s[i], s[index] = s[index], s[i]
	}
}

// rand_chacha 0.9.0 chacha.rs `get_word_pos`: the offset from the start of the stream, in 32-bit words. The buffer
// holds the BUF_WORDS words starting at block `counter - 4` (refill has already advanced the counter), so the
// position is that block's first word plus the read index. A fresh generator (index BUF_WORDS, counter 0) is at 0:
// the block subtraction wraps, as Rust's `wrapping_sub` does, and the index puts it back.
get_word_pos :: proc(r: ^Chacha20) -> u128 {
	buf_start_block := r.counter - 4 // wrapping, as u64 arithmetic is in Odin
	pos_block := buf_start_block + u64(r.index / 16)
	return u128(pos_block) * 16 + u128(r.index % 16)
}

// rand_chacha 0.9.0 chacha.rs `set_word_pos`: seek to the block holding the word, generate the buffer from there
// (rand_core block.rs `generate_and_set`), and read on from the word's offset within its block.
set_word_pos :: proc(r: ^Chacha20, word_offset: u128) {
	r.counter = u64(word_offset / 16)
	refill(r)
	r.index = int(word_offset % 16)
}
