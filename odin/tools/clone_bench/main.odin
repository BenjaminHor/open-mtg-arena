// The Odin side of crates/phase-ai/src/bin/clone_bench.rs: GameState clones on recorded states, checked for
// correctness (a clone encodes to the same JSON as its original) and timed:
// - clone;
// - clone, then write one object (ObjectMap_get_mut: copy-on-write of the trie path and the object);
// - lookup of every object by id (the pointer lookup; also the `Maybe(GameObject)` copy ObjectMap_get returns);
// - the stale-count pattern: a clone discarded without releasing its counts, then the parent appends to its rules
//   journal and writes one object (every shared part the parent writes is copied, as nothing tells it the clone
//   died).
// Clones are allocated from an arena reset after each batch, as the state layout proposes (docs/odin-port.md,
// "State layout"): a plain `core:mem` arena over a preallocated buffer (the per-action arena), and `core:mem/virtual`'s
// growing arena for comparison. Rust's numbers include the drop; arenas have none.
//
// Usage: clone_bench <game.jsonl> [every-nth-state]
// `-define:OLD_LAYOUT=true` builds it against the model before D-186 (ObjectMap as a shared Odin map), for the
// before/after comparison.
package clone_bench

import "core:fmt"
import "core:mem"
import "core:mem/virtual"
import "core:os"
import "core:strconv"
import "core:strings"
import "core:time"
import json "../../engine/json"
import types "../../engine/types"

OLD_LAYOUT :: #config(OLD_LAYOUT, false)
REPS :: 200

lookup :: #force_inline proc(m: types.ObjectMap, id: types.ObjectId) -> ^types.GameObject {
	when OLD_LAYOUT {
		return m.inner^[id]
	} else {
		return types.object_map_lookup(m, id)
	}
}

Totals :: struct {
	clone, write, clone_virtual, write_virtual, stale, lookup, get_copy: f64,
	bytes, allocs: int,
}

// Counts what one clone allocates.
Counter :: struct {
	inner:  mem.Allocator,
	bytes:  int,
	allocs: int,
}

counting_allocator :: proc(c: ^Counter) -> mem.Allocator {
	return {procedure = proc(data: rawptr, mode: mem.Allocator_Mode, size, alignment: int, old: rawptr, old_size: int, loc := #caller_location) -> ([]byte, mem.Allocator_Error) {
		c := (^Counter)(data)
		if mode == .Alloc || mode == .Alloc_Non_Zeroed || mode == .Resize || mode == .Resize_Non_Zeroed {
			c.bytes += size
			c.allocs += 1
		}
		return c.inner.procedure(c.inner.data, mode, size, alignment, old, old_size, loc)
	}, data = c}
}

main :: proc() {
	if len(os.args) < 2 { fmt.eprintln("usage: clone_bench <game.jsonl> [every-nth-state]"); os.exit(2) }
	every := 25
	if len(os.args) > 2 do every, _ = strconv.parse_int(os.args[2])
	data, err := os.read_entire_file_from_path(os.args[1], context.allocator)
	if err != nil { fmt.eprintln("can't read", os.args[1]); os.exit(1) }
	fmt.printf("size_of: GameState %v, GameObject %v, ResolvedCommandJournalEntry %v, ZoneChangeRecord %v\n",
		size_of(types.GameState), size_of(types.GameObject), size_of(types.ResolvedCommandJournalEntry), size_of(types.ZoneChangeRecord))

	buf := make([]byte, 512 * mem.Megabyte)
	plain: mem.Arena
	mem.arena_init(&plain, buf)
	scratch: virtual.Arena
	_ = virtual.arena_init_growing(&scratch)

	states, objects, mismatches := 0, 0, 0
	t: Totals
	rest := string(data)
	line_no := 0
	for line in strings.split_lines_iterator(&rest) {
		line_no += 1
		if line_no == 1 || (line_no - 1) % every != 0 do continue
		root, perr := json.parse(transmute([]byte)line)
		if perr != nil do continue
		sv, _ := json.get(root, "state")
		state: types.GameState
		if !types.decode_GameState(sv, &state) { fmt.eprintln("decode failed:", types.decode_error); os.exit(1) }
		ids := types.ObjectMap_keys(state.objects)
		if len(ids) == 0 do continue

		// Correctness: the clone writes the same JSON as the original, and so does the original after a clone wrote.
		{
			c := types.clone_GameState(state)
			if obj, ok := types.ObjectMap_get_mut(&c.objects, ids[0]).?; ok do obj.tapped = !obj.tapped
			if obj, ok := types.ObjectMap_get_mut(&c.objects, ids[0]).?; ok do obj.tapped = !obj.tapped
			a, b := strings.builder_make(), strings.builder_make()
			types.encode_GameState(&a, state)
			types.encode_GameState(&b, c)
			va, _ := json.parse(transmute([]byte)strings.to_string(a))
			vb, _ := json.parse(transmute([]byte)strings.to_string(b))
			path := strings.builder_make()
			if !json.equal(va, vb, &path) {
				mismatches += 1
				if mismatches <= 3 do fmt.println("clone differs at", strings.to_string(path))
			}
		}

		{
			counter := Counter{inner = mem.arena_allocator(&plain)}
			context.allocator = counting_allocator(&counter)
			_ = types.clone_GameState(state)
			t.bytes += counter.bytes
			t.allocs += counter.allocs
			mem.free_all(mem.arena_allocator(&plain))
		}

		for use_virtual in ([]bool{false, true}) {
			alloc := use_virtual ? virtual.arena_allocator(&scratch) : mem.arena_allocator(&plain)
			context.allocator = alloc
			start := time.now()
			for _ in 0 ..< REPS do _ = types.clone_GameState(state)
			clone := f64(time.duration_nanoseconds(time.since(start))) / REPS
			free_all(alloc)

			start = time.now()
			for r in 0 ..< REPS {
				sim := types.clone_GameState(state)
				if obj, ok := types.ObjectMap_get_mut(&sim.objects, ids[r % len(ids)]).?; ok do obj.tapped = !obj.tapped
			}
			write := f64(time.duration_nanoseconds(time.since(start))) / REPS
			free_all(alloc)
			if use_virtual {
				t.clone_virtual += clone
				t.write_virtual += write
			} else {
				t.clone += clone
				t.write += write
			}
		}

		// Stale counts: the parent is written after each discarded clone.
		{
			alloc := mem.arena_allocator(&plain)
			context.allocator = alloc
			parent := types.clone_GameState(state)
			journal := &parent.resolved_rules_journal.entries
			start := time.now()
			for r in 0 ..< REPS {
				_ = types.clone_GameState(parent)
				if journal.len > 0 {
					entry := types.clone_ResolvedCommandJournalEntry(types.pvec_get(journal^, journal.len - 1))
					types.pvec_push(journal, entry, types.clone_ResolvedCommandJournalEntry)
				}
				if obj, ok := types.ObjectMap_get_mut(&parent.objects, ids[r % len(ids)]).?; ok do obj.tapped = !obj.tapped
			}
			t.stale += f64(time.duration_nanoseconds(time.since(start))) / REPS
			free_all(alloc)
		}

		start := time.now()
		hits := 0
		for r in 0 ..< REPS do for id in ids do if lookup(state.objects, id) != nil do hits += 1 + r & 1
		t.lookup += f64(time.duration_nanoseconds(time.since(start))) / REPS / f64(len(ids))

		start = time.now()
		for _ in 0 ..< 20 do for id in ids do if o, ok := types.ObjectMap_get(state.objects, id).?; ok && o.tapped do hits += 1
		t.get_copy += f64(time.duration_nanoseconds(time.since(start))) / 20 / f64(len(ids))

		if hits == 0 do fmt.println("no hits")
		states += 1
		objects += len(ids)
	}
	n := f64(max(states, 1))
	fmt.printf("%v states (avg %v objects), %v KB in %v allocations per clone\n", states, objects / max(states, 1), t.bytes / max(states, 1) / 1024, t.allocs / max(states, 1))
	fmt.printf("plain arena:   clone %.0f ns, clone+write one object %.0f ns\n", t.clone / n, t.write / n)
	fmt.printf("virtual arena: clone %.0f ns, clone+write one object %.0f ns\n", t.clone_virtual / n, t.write_virtual / n)
	fmt.printf("stale counts (discarded clone, then the parent appends to its journal and writes one object): %.0f ns a round\n", t.stale / n)
	fmt.printf("lookup by id: %.1f ns (ObjectMap_get's Maybe(GameObject) copy: %.1f ns)\n", t.lookup / n, t.get_copy / n)
	fmt.printf("clone mismatches %v\n", mismatches)
	if mismatches > 0 do os.exit(1)
}
