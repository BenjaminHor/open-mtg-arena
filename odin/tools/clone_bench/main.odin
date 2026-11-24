// The Odin side of crates/phase-ai/src/bin/clone_bench.rs: GameState clones on recorded states, checked for
// correctness (a clone encodes to the same JSON as its original) and timed: clone; clone and write one object
// (copy-on-write through make_mut); lookups by id. Clones are allocated from an arena reset after each batch, as
// the state layout proposes (docs/odin-port.md, "State layout").
// Usage: clone_bench <game.jsonl> [every-nth-state]
package clone_bench

import "core:fmt"
import "core:mem/virtual"
import "core:os"
import "core:strconv"
import "core:strings"
import "core:time"
import json "../../engine/json"
import types "../../engine/types"

REPS :: 200

main :: proc() {
	if len(os.args) < 2 { fmt.eprintln("usage: clone_bench <game.jsonl> [every-nth-state]"); os.exit(2) }
	every := 25
	if len(os.args) > 2 do every, _ = strconv.parse_int(os.args[2])
	data, err := os.read_entire_file_from_path(os.args[1], context.allocator)
	if err != nil { fmt.eprintln("can't read", os.args[1]); os.exit(1) }

	scratch: virtual.Arena
	_ = virtual.arena_init_growing(&scratch)
	states, objects, mismatches := 0, 0, 0
	clone_ns, write_ns, lookup_ns: f64
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
		ids := make([dynamic]types.ObjectId)
		for id in state.objects.inner do append(&ids, id)
		if len(ids) == 0 do continue

		// Correctness: the clone writes the same JSON as the original.
		{
			c := types.clone_GameState(state)
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
			context.allocator = virtual.arena_allocator(&scratch)
			t := time.now()
			for _ in 0 ..< REPS do _ = types.clone_GameState(state)
			clone_ns += f64(time.duration_nanoseconds(time.since(t))) / REPS
			virtual.arena_free_all(&scratch)

			t = time.now()
			for r in 0 ..< REPS {
				sim := types.clone_GameState(state)
				p := &sim.objects.inner[ids[r % len(ids)]]
				obj := types.make_mut(p, types.clone_GameObject)
				obj.tapped = !obj.tapped
			}
			write_ns += f64(time.duration_nanoseconds(time.since(t))) / REPS
			virtual.arena_free_all(&scratch)
		}

		t := time.now()
		hits := 0
		for r in 0 ..< REPS do for id in ids do if state.objects.inner[id] != nil do hits += 1 + r & 1
		lookup_ns += f64(time.duration_nanoseconds(time.since(t))) / REPS / f64(len(ids))

		if hits == 0 do fmt.println("no hits")
		states += 1
		objects += len(ids)
	}
	n := f64(max(states, 1))
	fmt.printf("%v states (avg %v objects): clone %.0f ns, clone+write one object %.0f ns, lookup %.1f ns; clone mismatches %v\n",
		states, objects / max(states, 1), clone_ns / n, write_ns / n, lookup_ns / n, mismatches)
	if mismatches > 0 do os.exit(1)
}
