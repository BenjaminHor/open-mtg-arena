// Checks the engine's JSON reader and writer on a real file: parse, write back, parse again, compare; with timings.
// Usage: json_check <file.json>
package json_check

import "core:fmt"
import "core:mem/virtual"
import "core:os"
import "core:strings"
import "core:time"
import json "../../engine/json"

main :: proc() {
	arena: virtual.Arena
	_ = virtual.arena_init_growing(&arena)
	context.allocator = virtual.arena_allocator(&arena)

	data, rerr := os.read_entire_file_from_path(os.args[1], context.allocator)
	if rerr != nil { fmt.eprintln("can't read", os.args[1]); os.exit(1) }

	t := time.now()
	v, err := json.parse(data)
	fmt.printf("parse: %.0f ms, error %v\n", time.duration_milliseconds(time.since(t)), err)

	t = time.now()
	b := strings.builder_make()
	json.write_value(&b, v)
	fmt.printf("write: %.0f ms, %v bytes (input %v)\n", time.duration_milliseconds(time.since(t)), strings.builder_len(b), len(data))

	again, err2 := json.parse(transmute([]byte)strings.to_string(b))
	path := strings.builder_make()
	t = time.now()
	same := json.equal(v, again, &path)
	fmt.printf("round trip equal: %v (%.0f ms) %v, error %v\n", same, time.duration_milliseconds(time.since(t)), strings.to_string(path), err2)
	fmt.printf("byte-identical: %v\n", strings.to_string(b) == string(data))
}
