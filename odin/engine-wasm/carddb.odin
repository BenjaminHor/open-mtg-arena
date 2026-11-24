// The card database: the card data the client loads (about 100 MB of JSON, some 36,000 cards). Loading only indexes
// it, recording where each card's JSON is; a card is decoded the first time the engine asks for it. Decoding every
// card up front took about 15 seconds and 1.5 GB of memory, most of it cards no game uses.
package engine_odin

import "base:runtime"
import "core:strings"
import json "../engine/json"
import types "../engine/types"

@(private = "file")
card_source: map[string][]byte // the JSON of each card, by lowercase name, into card_text
@(private = "file")
card_text: []byte
@(private = "file")
decoded: map[string]^types.CardExportEntry
@(private = "file")
cards_arena: runtime.Arena

card_db_loaded :: proc() -> bool {return card_text != nil}

card_count :: proc() -> int {return len(card_source)}

// The card under its database key (its lowercase name), decoded on first use. A card whose JSON doesn't decode is
// reported as missing, as the eager load would have left it out.
card_by_key :: proc(key: string) -> (^types.CardExportEntry, bool) {
	if e, ok := decoded[key]; ok do return e, e != nil
	source, ok := card_source[key]
	if !ok do return nil, false
	context.allocator = runtime.arena_allocator(&cards_arena)
	entry: ^types.CardExportEntry
	if tree, err := json.parse(source); err == nil {
		entry = new(types.CardExportEntry)
		if !types.decode_CardExportEntry(tree, entry) do entry = nil
	}
	decoded[strings.clone(key)] = entry
	return entry, entry != nil
}

// load_card_database(json_str): indexes the card data (an object of cards by lowercase name) and answers the count.
load_card_database :: proc(b: ^strings.Builder, args: []json.Value) {
	if len(args) < 1 || args[0].kind != .String {
		reply_err(b, "load_card_database: expected the card data as a string")
		return
	}
	// The text and the index live in their own arena, replaced on a reload.
	runtime.arena_destroy(&cards_arena)
	card_source, decoded, card_text = nil, nil, nil
	context.allocator = runtime.arena_allocator(&cards_arena)
	text := transmute([]byte)strings.clone(args[0].text)
	index, ok := index_object(text)
	if !ok {
		reply_err(b, "Failed to parse card database")
		return
	}
	card_text, card_source = text, index
	decoded = make(map[string]^types.CardExportEntry)
	count := strings.builder_make(context.temp_allocator)
	strings.write_int(&count, len(card_source))
	reply_ok_raw(b, strings.to_string(count))
}

// The members of a JSON object, each as its key and the bytes of its value, without building a tree.
@(private = "file")
index_object :: proc(data: []byte) -> (members: map[string][]byte, ok: bool) {
	i := skip_space(data, 0)
	if i >= len(data) || data[i] != '{' do return nil, false
	members = make(map[string][]byte, 40000)
	i = skip_space(data, i + 1)
	if i < len(data) && data[i] == '}' do return members, true
	for i < len(data) {
		if data[i] != '"' do return nil, false
		key_end := string_end(data, i) or_return
		key := string(data[i + 1:key_end - 1])
		if strings.contains_rune(key, '\\') {
			// An escaped key: the JSON parser unescapes it.
			v, err := json.parse(data[i:key_end])
			if err != nil do return nil, false
			key = v.text
		}
		i = skip_space(data, key_end)
		if i >= len(data) || data[i] != ':' do return nil, false
		start := skip_space(data, i + 1)
		end := value_end(data, start) or_return
		members[key] = data[start:end]
		i = skip_space(data, end)
		if i < len(data) && data[i] == ',' {
			i = skip_space(data, i + 1)
			continue
		}
		return members, i < len(data) && data[i] == '}'
	}
	return nil, false
}

@(private = "file")
skip_space :: proc(data: []byte, i: int) -> int {
	i := i
	for i < len(data) && (data[i] == ' ' || data[i] == '\n' || data[i] == '\r' || data[i] == '\t') do i += 1
	return i
}

// The index just past the string that starts at data[i] (a quote).
@(private = "file")
string_end :: proc(data: []byte, i: int) -> (end: int, ok: bool) {
	for j := i + 1; j < len(data); j += 1 {
		switch data[j] {
		case '\\':
			j += 1
		case '"':
			return j + 1, true
		}
	}
	return 0, false
}

// The index just past the JSON value that starts at data[i].
@(private = "file")
value_end :: proc(data: []byte, i: int) -> (end: int, ok: bool) {
	if i >= len(data) do return 0, false
	switch data[i] {
	case '"':
		return string_end(data, i)
	case '{', '[':
		depth := 0
		for j := i; j < len(data); j += 1 {
			switch data[j] {
			case '"':
				close := string_end(data, j) or_return
				j = close - 1
			case '{', '[':
				depth += 1
			case '}', ']':
				depth -= 1
				if depth == 0 do return j + 1, true
			}
		}
		return 0, false
	}
	// A number, true, false or null: up to the next delimiter.
	j := i
	for j < len(data) && data[j] != ',' && data[j] != '}' && data[j] != ']' && data[j] != ' ' && data[j] != '\n' do j += 1
	return j, j > i
}
