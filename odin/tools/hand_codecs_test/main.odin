// Edge cases of the hand-written codecs (odin/engine/types/hand_codecs.odin) where Rust's reading is easy to get
// wrong: each case is an input and what Rust's Deserialize makes of it, re-encoded. Found by review (2026-11-24);
// the recorded games never hit these. Usage: hand_codecs_test (exits 1 on a failure).
package hand_codecs_test

import "core:fmt"
import "core:os"
import "core:strings"
import json "../../engine/json"
import types "../../engine/types"

failures := 0

// Decodes `input` as T and checks the result: `want` is the re-encoded JSON, or "" when Rust rejects the input.
expect :: proc(name, input: string, $T: typeid, dec: proc(json.Value, ^T) -> bool, enc: proc(^strings.Builder, T), want: string) {
	v, err := json.parse(transmute([]byte)input)
	if err != nil { fmt.printf("FAIL %v: bad test input\n", name); failures += 1; return }
	x: T
	types.decode_error = ""
	ok := dec(v, &x)
	if want == "" {
		if ok { fmt.printf("FAIL %v: accepted %v, Rust rejects it\n", name, input); failures += 1 }
		return
	}
	if !ok { fmt.printf("FAIL %v: rejected %v (%v)\n", name, input, types.decode_error); failures += 1; return }
	b := strings.builder_make()
	enc(&b, x)
	got, _ := json.parse(transmute([]byte)strings.to_string(b))
	w, _ := json.parse(transmute([]byte)want)
	if !json.equal(got, w, nil) { fmt.printf("FAIL %v: got %v, want %v\n", name, strings.to_string(b), want); failures += 1 }
}

Counters :: [dynamic]types.Tuple2(types.CounterType, u32)
TupleKeys :: [dynamic]types.Tuple2(types.Tuple2(types.ObjectId, int), u32)
UsageKeys :: [dynamic]types.Tuple2(types.AbilityUsageKey, u32)

main :: proc() {
	// phase-ast types/counter.rs: duplicate keys merge by CounterType value; "Stun" is Generic("stun"), not Stun.
	expect("counters merge equal types", `{"stun":1,"stun":2}`, Counters, types.decode_with_counter_map_serde, types.encode_with_counter_map_serde, `{"stun":3}`)
	expect("counters keep Generic(stun) apart from Stun", `{"Stun":1,"stun":2}`, Counters, types.decode_with_counter_map_serde, types.encode_with_counter_map_serde, `{"stun":1,"stun":2}`)
	// parse_counter_type trims " counter" twice (its own trim, then try_parse_counter_type's).
	expect("counter suffix trimmed twice", `{"quest counter  counter":1}`, Counters, types.decode_with_counter_map_serde, types.encode_with_counter_map_serde, `{"quest":1}`)
	// Rust's integer parsing takes no `_` separators: "+1_0/+1" isn't a P/T counter.
	expect("no digit separators in P/T", `{"+1_0/+1":1}`, Counters, types.decode_with_counter_map_serde, types.encode_with_counter_map_serde, `{"+1_0/+1":1}`)
	expect("P/T counter", `{"+2/+1":1}`, Counters, types.decode_with_counter_map_serde, types.encode_with_counter_map_serde, `{"+2/+1":1}`)
	// types/game_state.rs tuple_key_map: keys that parse equal collapse, the later value wins.
	expect("tuple keys collapse", `{"42_0":1,"+42_0":2}`, TupleKeys, types.decode_with_tuple_key_map, types.encode_with_tuple_key_map, `{"42_0":2}`)
	expect("tuple key separators rejected", `{"4_2_0":1}`, TupleKeys, types.decode_with_tuple_key_map, types.encode_with_tuple_key_map, "")
	// ability_usage_key_map: a trailing comma in the grant chain is an empty, invalid stamp.
	expect("usage key trailing comma", `{"5#-#0##7.1,#":1}`, UsageKeys, types.decode_with_ability_usage_key_map, types.encode_with_ability_usage_key_map, "")
	expect("usage key round trip", `{"5#3.2#1#a%23b%25#7.1,8.2#some # text":4}`, UsageKeys, types.decode_with_ability_usage_key_map, types.encode_with_ability_usage_key_map, `{"5#3.2#1#a%23b%25#7.1,8.2#some # text":4}`)
	// types/format.rs GameFormat: Display names and "Custom:<u16>".
	expect("game format", `"Commander"`, types.GameFormat, types.decode_GameFormat, types.encode_GameFormat, `"Commander"`)
	expect("custom format", `"Custom:12"`, types.GameFormat, types.decode_GameFormat, types.encode_GameFormat, `"Custom:12"`)
	expect("custom format separators rejected", `"Custom:1_2"`, types.GameFormat, types.decode_GameFormat, types.encode_GameFormat, "")
	// game/combat.rs blocking_wire: [] is None, null is Some([]).
	expect("blocking none", `[]`, Maybe([dynamic]types.ObjectId), types.decode_with_blocking_wire, types.encode_with_blocking_wire, `[]`)
	expect("blocking empty", `null`, Maybe([dynamic]types.ObjectId), types.decode_with_blocking_wire, types.encode_with_blocking_wire, `null`)
	expect("blocking ids", `[3,4]`, Maybe([dynamic]types.ObjectId), types.decode_with_blocking_wire, types.encode_with_blocking_wire, `[3,4]`)
	// types/game_state.rs StackResolutionBudget: 0 is no cap.
	expect("budget", `0`, types.StackResolutionBudget, types.decode_StackResolutionBudget, types.encode_StackResolutionBudget, `0`)
	expect("budget limited", `7`, types.StackResolutionBudget, types.decode_StackResolutionBudget, types.encode_StackResolutionBudget, `7`)
	// types/ability.rs CostPaidObjectRecord: a bare id is MembershipOnly.
	expect("cost-paid id", `12`, types.CostPaidObjectRecord, types.decode_CostPaidObjectRecord, types.encode_CostPaidObjectRecord, `12`)
	if failures > 0 { fmt.printf("%v failure(s)\n", failures); os.exit(1) }
	fmt.println("hand codec edge cases: all pass")
}
