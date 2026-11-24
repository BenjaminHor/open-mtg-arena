// What the generated codecs (generated_codecs.odin) call: primitive codecs, tuples, error tracking, and quiet
// decoding for serde's untagged enums. Containers have generated per-type helpers (dec_/enc_/mem_<type>), so no
// code here is called through overload groups, which made the type check slow. docs/odin-port.md, "O-1 data model design".
package types

import "base:intrinsics"
import "core:strconv"
import "core:strings"
import "../json"

// serde's unit `()`, written as null.
Unit :: struct {}

Tuple2 :: struct($A, $B: typeid) {
	_0: A,
	_1: B,
}

Tuple3 :: struct($A, $B, $C: typeid) {
	_0: A,
	_1: B,
	_2: C,
}

Tuple4 :: struct($A, $B, $C, $D: typeid) {
	_0: A,
	_1: B,
	_2: C,
	_3: D,
}

// ------------------------------------------------------------------------------------------------------ errors ---

// The first decode failure since the last reset, for messages ("CardFace.mana_cost"). While `quiet` is set (an
// untagged enum trying its variants), failures aren't recorded.
decode_error: string
quiet: int

fail :: proc(where_: string) -> bool {
	if quiet == 0 && decode_error == "" do decode_error = where_
	return false
}

// Tries a decode without recording its failure (untagged enums try each variant in turn).
decode_quiet_proc :: proc(v: json.Value, out: ^$T, f: proc(v: json.Value, out: ^T) -> bool) -> bool {
	quiet += 1
	defer quiet -= 1
	return f(v, out)
}

// A struct variant's fields are read from an object.
decode_variant :: proc(v: json.Value, out: ^$T, f: proc(v: json.Value, out: ^T) -> bool) -> bool {
	if v.kind != .Object do return fail("variant data: not an object")
	return f(v, out)
}

// The first of several names (a field and its serde aliases) the object has.
get_any :: proc(v: json.Value, names: ..string) -> (json.Value, bool) {
	for n in names do if m, ok := json.get(v, n); ok do return m, true
	return {}, false
}

// Writes `"key":`, with a comma before it unless it's the object's first member.
member :: proc(b: ^strings.Builder, first: ^bool, key: string) {
	if !first^ do strings.write_byte(b, ',')
	first^ = false
	json.write_string(b, key)
	strings.write_byte(b, ':')
}

// --------------------------------------------------------------------------------------------------- primitives ---

decode_bool :: proc(v: json.Value, out: ^bool) -> bool {
	if v.kind != .Bool do return fail("expected a bool")
	out^ = v.boolean
	return true
}

@(private)
decode_integer :: proc(v: json.Value, out: ^$T) -> bool where intrinsics.type_is_integer(T) {
	if v.kind != .Number do return fail("expected an integer")
	when intrinsics.type_is_unsigned(T) {
		n, ok := strconv.parse_u128_of_base(v.text, 10)
		if !ok || n > u128(max(T)) do return fail("integer out of range")
		out^ = T(n)
	} else {
		n, ok := strconv.parse_i128_of_base(v.text, 10)
		if !ok || n > i128(max(T)) || n < i128(min(T)) do return fail("integer out of range")
		out^ = T(n)
	}
	return true
}

decode_int :: proc(v: json.Value, out: ^int) -> bool { return decode_integer(v, out) }
decode_u8 :: proc(v: json.Value, out: ^u8) -> bool { return decode_integer(v, out) }
decode_u16 :: proc(v: json.Value, out: ^u16) -> bool { return decode_integer(v, out) }
decode_u32 :: proc(v: json.Value, out: ^u32) -> bool { return decode_integer(v, out) }
decode_u64 :: proc(v: json.Value, out: ^u64) -> bool { return decode_integer(v, out) }
decode_u128 :: proc(v: json.Value, out: ^u128) -> bool { return decode_integer(v, out) }
decode_i8 :: proc(v: json.Value, out: ^i8) -> bool { return decode_integer(v, out) }
decode_i16 :: proc(v: json.Value, out: ^i16) -> bool { return decode_integer(v, out) }
decode_i32 :: proc(v: json.Value, out: ^i32) -> bool { return decode_integer(v, out) }
decode_i64 :: proc(v: json.Value, out: ^i64) -> bool { return decode_integer(v, out) }
decode_i128 :: proc(v: json.Value, out: ^i128) -> bool { return decode_integer(v, out) }

decode_f64 :: proc(v: json.Value, out: ^f64) -> bool {
	n, ok := json.to_f64(v)
	if !ok do return fail("expected a number")
	out^ = n
	return true
}

decode_f32 :: proc(v: json.Value, out: ^f32) -> bool {
	n, ok := json.to_f64(v)
	if !ok do return fail("expected a number")
	out^ = f32(n)
	return true
}

decode_string :: proc(v: json.Value, out: ^string) -> bool {
	if v.kind != .String do return fail("expected a string")
	out^ = v.text
	return true
}

decode_rune :: proc(v: json.Value, out: ^rune) -> bool {
	if v.kind != .String do return fail("expected a char")
	for r in v.text { out^ = r; return true }
	return fail("empty char")
}

// serde_json::Value fields pass through as the tree.
decode_json :: proc(v: json.Value, out: ^json.Value) -> bool {
	out^ = v
	return true
}

decode_unit :: proc(v: json.Value, out: ^Unit) -> bool {
	_ = out
	return v.kind == .Null || fail("expected null")
}

encode_bool :: proc(b: ^strings.Builder, x: bool) { strings.write_string(b, x ? "true" : "false") }
encode_int :: proc(b: ^strings.Builder, x: int) { strings.write_i64(b, i64(x)) }
encode_u8 :: proc(b: ^strings.Builder, x: u8) { strings.write_u64(b, u64(x)) }
encode_u16 :: proc(b: ^strings.Builder, x: u16) { strings.write_u64(b, u64(x)) }
encode_u32 :: proc(b: ^strings.Builder, x: u32) { strings.write_u64(b, u64(x)) }
encode_u64 :: proc(b: ^strings.Builder, x: u64) { strings.write_u64(b, x) }
encode_i8 :: proc(b: ^strings.Builder, x: i8) { strings.write_i64(b, i64(x)) }
encode_i16 :: proc(b: ^strings.Builder, x: i16) { strings.write_i64(b, i64(x)) }
encode_i32 :: proc(b: ^strings.Builder, x: i32) { strings.write_i64(b, i64(x)) }
encode_i64 :: proc(b: ^strings.Builder, x: i64) { strings.write_i64(b, x) }

encode_u128 :: proc(b: ^strings.Builder, x: u128) {
	buf: [64]byte
	strings.write_string(b, strconv.write_bits_128(buf[:], x, 10, false, 128, strconv.digits, nil))
}

encode_i128 :: proc(b: ^strings.Builder, x: i128) {
	buf: [64]byte
	strings.write_string(b, strconv.write_bits_128(buf[:], u128(x), 10, true, 128, strconv.digits, nil))
}

// Floats: shortest round-trip text, like serde_json; the tests compare numbers by value, so the exact text form
// (ryu's) only matters for byte-identical output, which nothing relies on.
encode_f64 :: proc(b: ^strings.Builder, x: f64) {
	buf: [64]byte
	s := strconv.write_float(buf[:], x, 'g', -1, 64)
	if s[0] == '+' do s = s[1:]
	strings.write_string(b, s)
}

encode_f32 :: proc(b: ^strings.Builder, x: f32) {
	buf: [64]byte
	s := strconv.write_float(buf[:], f64(x), 'g', -1, 32)
	if s[0] == '+' do s = s[1:]
	strings.write_string(b, s)
}

encode_string :: proc(b: ^strings.Builder, x: string) { json.write_string(b, x) }

encode_rune :: proc(b: ^strings.Builder, x: rune) {
	buf: [4]byte
	n := 0
	{
		enc, w := utf8_encode(x)
		buf = enc
		n = w
	}
	json.write_string(b, string(buf[:n]))
}

@(private)
utf8_encode :: proc(r: rune) -> ([4]byte, int) {
	b: [4]byte
	switch {
	case r < 0x80: b[0] = byte(r); return b, 1
	case r < 0x800: b[0] = 0xC0 | byte(r >> 6); b[1] = 0x80 | byte(r & 0x3F); return b, 2
	case r < 0x10000:
		b[0] = 0xE0 | byte(r >> 12); b[1] = 0x80 | byte((r >> 6) & 0x3F); b[2] = 0x80 | byte(r & 0x3F)
		return b, 3
	}
	b[0] = 0xF0 | byte(r >> 18); b[1] = 0x80 | byte((r >> 12) & 0x3F); b[2] = 0x80 | byte((r >> 6) & 0x3F)
	b[3] = 0x80 | byte(r & 0x3F)
	return b, 4
}

encode_json :: proc(b: ^strings.Builder, x: json.Value) { json.write_value(b, x) }

encode_unit :: proc(b: ^strings.Builder, x: Unit) {
	_ = x
	strings.write_string(b, "null")
}

// `vec![a, b]` in translated code: a dynamic array holding a copy of the literal's items.
dynamic_from :: proc(xs: []$T) -> [dynamic]T {
	out := make([dynamic]T, len(xs))
	copy(out[:], xs)
	return out
}

// A type the model doesn't hold: only behind runtime-only fields (e.g. the test-support RawFace in
// CardDatabase's face slots), never serialized. Its uses are named in generated_types.odin.
Unknown :: struct {}

// `matches!(x, Enum::Variant)` / `x == Enum::Variant` on a data enum, in translated code.
is_variant :: proc(x: $U, $V: typeid) -> bool {
	_, ok := x.(V)
	return ok
}

// Internally tagged newtype variants holding a unit enum: serde writes the inner variant as a member key with a
// null value ({"type": "Destination", "Hand": null}). The key is that variant's JSON string.
member_json_key :: proc(b: ^strings.Builder, first: ^bool, x: $T, enc: proc(b: ^strings.Builder, x: T)) {
	if !first^ do strings.write_byte(b, ',')
	first^ = false
	enc(b, x)
	strings.write_byte(b, ':')
}

// The first member of an object that isn't the tag (reading the case above).
other_member_key :: proc(v: json.Value, tag: string) -> string {
	for m in v.members do if m.key != tag do return m.key
	return ""
}
