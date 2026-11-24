// PVec: the Odin model's `im::Vector<T>`, a persistent vector. Values sit in chunks of PVEC_CHUNK, each a shared
// allocation (`shared_new`, a count before the value); a PVec is its list of chunk pointers. So, as with `im::Vector`:
// - cloning copies the chunk list and shares every chunk (O(n / PVEC_CHUNK));
// - writing an element, or appending to the last chunk, copies only that chunk, and only when it is shared;
// - reading is an index into a chunk.
// docs/odin-port.md, "State layout".
package types

PVEC_CHUNK :: 64

PChunk :: struct($T: typeid) {
	n:     int,
	items: [PVEC_CHUNK]T,
}

PVec :: struct($T: typeid) {
	chunks: [dynamic]^PChunk(T),
	len:    int,
}

pvec_len :: proc(v: PVec($T)) -> int {
	return v.len
}

// The element at i (a copy of the value; its owned parts are still the vector's).
pvec_get :: proc(v: PVec($T), i: int) -> T {
	return v.chunks[i / PVEC_CHUNK].items[i % PVEC_CHUNK]
}

// A read-only pointer to the element at i.
pvec_at :: proc(v: PVec($T), i: int) -> ^T {
	return &v.chunks[i / PVEC_CHUNK].items[i % PVEC_CHUNK]
}

// A chunk this vector alone holds, copying it (each element with `clone`) if it is shared.
@(private)
pvec_own_chunk :: proc(v: ^PVec($T), c: int, clone: proc(x: T) -> T) -> ^PChunk(T) {
	p := v.chunks[c]
	if shared_count(p)^ > 1 {
		q := shared_new(PChunk(T))
		q.n = p.n
		for k in 0 ..< p.n do q.items[k] = clone(p.items[k])
		shared_count(p)^ -= 1
		v.chunks[c] = q
		return q
	}
	return p
}

// A writable pointer to the element at i (Rust's `get_mut` on an im::Vector).
pvec_mut :: proc(v: ^PVec($T), i: int, clone: proc(x: T) -> T) -> ^T {
	return &pvec_own_chunk(v, i / PVEC_CHUNK, clone).items[i % PVEC_CHUNK]
}

pvec_push :: proc(v: ^PVec($T), x: T, clone: proc(x: T) -> T) {
	if v.len % PVEC_CHUNK == 0 {
		append(&v.chunks, shared_new(PChunk(T)))
	}
	c := pvec_own_chunk(v, len(v.chunks) - 1, clone)
	c.items[c.n] = x
	c.n += 1
	v.len += 1
}

// Appending while the vector is being built (decoding): its chunks aren't shared yet.
pvec_push_new :: proc(v: ^PVec($T), x: T) {
	if v.len % PVEC_CHUNK == 0 {
		append(&v.chunks, shared_new(PChunk(T)))
	}
	c := v.chunks[len(v.chunks) - 1]
	c.items[c.n] = x
	c.n += 1
	v.len += 1
}

// Clone: a new chunk list sharing every chunk.
pvec_clone :: proc(v: PVec($T)) -> PVec(T) {
	out := PVec(T){len = v.len}
	out.chunks = make([dynamic]^PChunk(T), len(v.chunks))
	for c, i in v.chunks {
		shared_retain(c)
		out.chunks[i] = c
	}
	return out
}
