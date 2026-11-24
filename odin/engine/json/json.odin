// The engine's JSON: a reader into a light value tree, a writer that escapes like serde_json, and an equality check
// for tests (docs/odin-port.md, "O-1 data model design").
//
// Why not core:encoding/json: it parses integers into i64, and the engine has u64 values (seeds, hashes) above
// i64's range; here a number keeps its source text and is converted by the decoder that knows its type. Strings are
// slices of the input unless they contain escapes, which keeps the 98 MB card file's load to one pass and few copies.
// The input must outlive the tree.
package json

import "core:strconv"
import "core:strings"

Kind :: enum u8 {
	Null,
	Bool,
	Number,
	String,
	Array,
	Object,
}

Member :: struct {
	key:   string,
	value: Value,
}

Value :: struct {
	kind:    Kind,
	boolean: bool,
	// Number: its source text. String: its content, unescaped.
	text:    string,
	items:   []Value,  // Array
	members: []Member, // Object, in source order
}

Error :: struct {
	offset:  int,
	message: string,
}

@(private)
Parser :: struct {
	data: []byte,
	pos:  int,
	err:  Maybe(Error),
}

// Parses a whole document. Allocations (arrays, objects, unescaped strings) use context.allocator; an arena suits a
// document that is read once.
parse :: proc(data: []byte) -> (v: Value, err: Maybe(Error)) {
	p := Parser{data = data}
	skip_ws(&p)
	v = parse_value(&p)
	if p.err == nil {
		skip_ws(&p)
		if p.pos != len(p.data) do fail(&p, "trailing characters")
	}
	return v, p.err
}

@(private)
fail :: proc(p: ^Parser, msg: string) {
	if p.err == nil do p.err = Error{p.pos, msg}
	p.pos = len(p.data)
}

@(private)
skip_ws :: #force_inline proc(p: ^Parser) {
	for p.pos < len(p.data) {
		switch p.data[p.pos] {
		case ' ', '\t', '\n', '\r': p.pos += 1
		case: return
		}
	}
}

@(private)
expect_word :: proc(p: ^Parser, word: string) -> bool {
	if p.pos + len(word) > len(p.data) || string(p.data[p.pos:p.pos + len(word)]) != word {
		fail(p, "bad literal")
		return false
	}
	p.pos += len(word)
	return true
}

@(private)
parse_value :: proc(p: ^Parser) -> Value {
	if p.pos >= len(p.data) {
		fail(p, "unexpected end")
		return {}
	}
	switch p.data[p.pos] {
	case '{': return parse_object(p)
	case '[': return parse_array(p)
	case '"': return Value{kind = .String, text = parse_string(p)}
	case 't': expect_word(p, "true"); return Value{kind = .Bool, boolean = true}
	case 'f': expect_word(p, "false"); return Value{kind = .Bool}
	case 'n': expect_word(p, "null"); return Value{kind = .Null}
	case '-', '0' ..= '9': return parse_number(p)
	}
	fail(p, "unexpected character")
	return {}
}

@(private)
parse_number :: proc(p: ^Parser) -> Value {
	start := p.pos
	for p.pos < len(p.data) {
		switch p.data[p.pos] {
		case '-', '+', '.', 'e', 'E', '0' ..= '9': p.pos += 1
		case: return Value{kind = .Number, text = string(p.data[start:p.pos])}
		}
	}
	return Value{kind = .Number, text = string(p.data[start:p.pos])}
}

@(private)
parse_string :: proc(p: ^Parser) -> string {
	p.pos += 1 // opening quote
	start := p.pos
	for p.pos < len(p.data) {
		c := p.data[p.pos]
		if c == '"' {
			s := string(p.data[start:p.pos])
			p.pos += 1
			return s
		}
		if c == '\\' do return parse_escaped_string(p, start)
		p.pos += 1
	}
	fail(p, "unterminated string")
	return ""
}

@(private)
hex4 :: proc(p: ^Parser) -> (r: rune, ok: bool) {
	if p.pos + 4 > len(p.data) do return 0, false
	for i in 0 ..< 4 {
		c := p.data[p.pos + i]
		d: rune
		switch c {
		case '0' ..= '9': d = rune(c - '0')
		case 'a' ..= 'f': d = rune(c - 'a' + 10)
		case 'A' ..= 'F': d = rune(c - 'A' + 10)
		case: return 0, false
		}
		r = r * 16 + d
	}
	p.pos += 4
	return r, true
}

@(private)
parse_escaped_string :: proc(p: ^Parser, start: int) -> string {
	b := strings.builder_make()
	strings.write_bytes(&b, p.data[start:p.pos])
	for p.pos < len(p.data) {
		c := p.data[p.pos]
		switch c {
		case '"':
			p.pos += 1
			return strings.to_string(b)
		case '\\':
			p.pos += 1
			if p.pos >= len(p.data) do break
			e := p.data[p.pos]
			p.pos += 1
			switch e {
			case '"': strings.write_byte(&b, '"')
			case '\\': strings.write_byte(&b, '\\')
			case '/': strings.write_byte(&b, '/')
			case 'b': strings.write_byte(&b, '\b')
			case 'f': strings.write_byte(&b, '\f')
			case 'n': strings.write_byte(&b, '\n')
			case 'r': strings.write_byte(&b, '\r')
			case 't': strings.write_byte(&b, '\t')
			case 'u':
				r, ok := hex4(p)
				if !ok { fail(p, "bad \\u escape"); return "" }
				// A surrogate pair is two escapes.
				if r >= 0xD800 && r < 0xDC00 && p.pos + 6 <= len(p.data) && p.data[p.pos] == '\\' && p.data[p.pos + 1] == 'u' {
					p.pos += 2
					lo, ok2 := hex4(p)
					if !ok2 { fail(p, "bad \\u escape"); return "" }
					r = 0x10000 + ((r - 0xD800) << 10) + (lo - 0xDC00)
				}
				strings.write_rune(&b, r)
			case:
				fail(p, "bad escape")
				return ""
			}
		case:
			strings.write_byte(&b, c)
			p.pos += 1
		}
	}
	fail(p, "unterminated string")
	return ""
}

@(private)
parse_array :: proc(p: ^Parser) -> Value {
	p.pos += 1
	items := make([dynamic]Value)
	skip_ws(p)
	if p.pos < len(p.data) && p.data[p.pos] == ']' {
		p.pos += 1
		return Value{kind = .Array, items = items[:]}
	}
	for p.err == nil {
		skip_ws(p)
		append(&items, parse_value(p))
		skip_ws(p)
		if p.pos >= len(p.data) { fail(p, "unterminated array"); break }
		c := p.data[p.pos]
		p.pos += 1
		if c == ']' do break
		if c != ',' { fail(p, "expected , or ]"); break }
	}
	shrink(&items)
	return Value{kind = .Array, items = items[:]}
}

@(private)
parse_object :: proc(p: ^Parser) -> Value {
	p.pos += 1
	members := make([dynamic]Member)
	skip_ws(p)
	if p.pos < len(p.data) && p.data[p.pos] == '}' {
		p.pos += 1
		return Value{kind = .Object, members = members[:]}
	}
	for p.err == nil {
		skip_ws(p)
		if p.pos >= len(p.data) || p.data[p.pos] != '"' { fail(p, "expected key"); break }
		key := parse_string(p)
		skip_ws(p)
		if p.pos >= len(p.data) || p.data[p.pos] != ':' { fail(p, "expected :"); break }
		p.pos += 1
		skip_ws(p)
		append(&members, Member{key, parse_value(p)})
		skip_ws(p)
		if p.pos >= len(p.data) { fail(p, "unterminated object"); break }
		c := p.data[p.pos]
		p.pos += 1
		if c == '}' do break
		if c != ',' { fail(p, "expected , or }"); break }
	}
	shrink(&members)
	return Value{kind = .Object, members = members[:]}
}

// ---------------------------------------------------------------------------------------------- reading values ---

// The member named key, if v is an object that has it. Objects are small, so a scan.
get :: proc(v: Value, key: string) -> (Value, bool) {
	for m in v.members do if m.key == key do return m.value, true
	return {}, false
}

// The nth (from 0) member named key.
get_nth :: proc(v: Value, key: string, nth: int) -> (Value, bool) {
	n := nth
	for m in v.members do if m.key == key {
		if n == 0 do return m.value, true
		n -= 1
	}
	return {}, false
}

// v without its first member named key (reading the inner of a nested internally tagged enum, whose tag is the
// second occurrence).
without_first :: proc(v: Value, key: string) -> Value {
	for m, i in v.members do if m.key == key {
		out := v
		ms := make([]Member, len(v.members) - 1)
		copy(ms, v.members[:i])
		copy(ms[i:], v.members[i + 1:])
		out.members = ms
		return out
	}
	return v
}

to_u64 :: proc(v: Value) -> (u64, bool) {
	if v.kind != .Number do return 0, false
	return strconv.parse_u64_of_base(v.text, 10)
}

to_i64 :: proc(v: Value) -> (i64, bool) {
	if v.kind != .Number do return 0, false
	return strconv.parse_i64_of_base(v.text, 10)
}

to_f64 :: proc(v: Value) -> (f64, bool) {
	if v.kind != .Number do return 0, false
	return strconv.parse_f64(v.text)
}

// ----------------------------------------------------------------------------------------------------- writing ---

// serde_json's string escaping: quote, backslash and control characters (\b \f \n \r \t, others as \u00XX);
// everything else, non-ASCII included, as is.
write_string :: proc(b: ^strings.Builder, s: string) {
	strings.write_byte(b, '"')
	start := 0
	for i in 0 ..< len(s) {
		c := s[i]
		if c >= 0x20 && c != '"' && c != '\\' do continue
		strings.write_string(b, s[start:i])
		switch c {
		case '"': strings.write_string(b, `\"`)
		case '\\': strings.write_string(b, `\\`)
		case '\b': strings.write_string(b, `\b`)
		case '\f': strings.write_string(b, `\f`)
		case '\n': strings.write_string(b, `\n`)
		case '\r': strings.write_string(b, `\r`)
		case '\t': strings.write_string(b, `\t`)
		case:
			HEX := "0123456789abcdef"
			strings.write_string(b, `\u00`)
			strings.write_byte(b, HEX[c >> 4])
			strings.write_byte(b, HEX[c & 0xF])
		}
		start = i + 1
	}
	strings.write_string(b, s[start:])
	strings.write_byte(b, '"')
}

// Writes a value back out (compact, members in order), for tests and pass-through fields.
write_value :: proc(b: ^strings.Builder, v: Value) {
	switch v.kind {
	case .Null: strings.write_string(b, "null")
	case .Bool: strings.write_string(b, v.boolean ? "true" : "false")
	case .Number: strings.write_string(b, v.text)
	case .String: write_string(b, v.text)
	case .Array:
		strings.write_byte(b, '[')
		for item, i in v.items {
			if i > 0 do strings.write_byte(b, ',')
			write_value(b, item)
		}
		strings.write_byte(b, ']')
	case .Object:
		strings.write_byte(b, '{')
		for m, i in v.members {
			if i > 0 do strings.write_byte(b, ',')
			write_string(b, m.key)
			strings.write_byte(b, ':')
			write_value(b, m.value)
		}
		strings.write_byte(b, '}')
	}
}

// -------------------------------------------------------------------------------------------------- comparing ---

// Equal as JSON values: object member order ignored, array order kept, numbers compared by value. On a mismatch,
// path says where (for test output).
equal :: proc(a, b: Value, path: ^strings.Builder = nil) -> bool {
	note :: proc(path: ^strings.Builder, s: string) { if path != nil do strings.write_string(path, s) }
	if a.kind != b.kind {
		note(path, " (kinds differ)")
		return false
	}
	switch a.kind {
	case .Null: return true
	case .Bool: return a.boolean == b.boolean
	case .String:
		if a.text != b.text { note(path, " (strings differ)"); return false }
		return true
	case .Number:
		if a.text == b.text do return true
		x, okx := to_f64(a)
		y, oky := to_f64(b)
		if okx && oky && x == y do return true
		note(path, " (numbers differ)")
		return false
	case .Array:
		if len(a.items) != len(b.items) { note(path, " (array lengths differ)"); return false }
		for i in 0 ..< len(a.items) {
			mark := path != nil ? strings.builder_len(path^) : 0
			if path != nil do strings.write_string(path, "[]")
			if !equal(a.items[i], b.items[i], path) do return false
			if path != nil do resize(&path.buf, mark)
		}
		return true
	case .Object:
		if len(a.members) != len(b.members) {
			if path != nil {
				for m in a.members do if _, ok := get(b, m.key); !ok { strings.write_string(path, " missing on the right: "); strings.write_string(path, m.key); return false }
				for m in b.members do if _, ok := get(a, m.key); !ok { strings.write_string(path, " missing on the left: "); strings.write_string(path, m.key); return false }
			}
			return false
		}
		for m, i in a.members {
			// A repeated key (serde writes one when an internally tagged enum holds another with the same tag)
			// pairs with the same occurrence on the other side.
			nth := 0
			for prev in a.members[:i] do if prev.key == m.key do nth += 1
			other, ok := get_nth(b, m.key, nth)
			mark := path != nil ? strings.builder_len(path^) : 0
			if path != nil { strings.write_byte(path, '.'); strings.write_string(path, m.key) }
			if !ok { note(path, " (missing on the right)"); return false }
			if !equal(m.value, other, path) do return false
			if path != nil do resize(&path.buf, mark)
		}
		return true
	}
	return false
}


// The member named key, or null if v doesn't have it (adjacently tagged enums: a unit variant has no content).
get_or_null :: proc(v: Value, key: string) -> Value {
	m, _ := get(v, key)
	return m
}
