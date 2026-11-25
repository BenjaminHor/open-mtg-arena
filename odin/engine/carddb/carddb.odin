// The card database (the card data the client loads: about 100 MB of JSON, some 36,000 cards), shared by the
// WebAssembly engine and the native tests. Loading only indexes it, recording where each card's JSON is; a card is
// decoded the first time it's asked for. Decoding every card up front took about 15 seconds and 1.5 GB of memory,
// most of it cards no game uses.
package carddb

import "base:runtime"
import "core:strings"
import json "../json"
import types "../types"

DB :: struct {
	text:    []byte, // the card data, kept for the database's lifetime
	source:  map[string][]byte, // each card's JSON, by lowercase name, into text
	decoded: map[string]^types.CardExportEntry,
	arena:   runtime.Arena,
	faces:   map[string][2]string, // by oracle id, each face's key by face_index (built on first use)
	faces_built: bool,
}

// Indexes the card data (an object of cards by lowercase name). Replaces whatever the database held.
load :: proc(db: ^DB, text: string) -> bool {
	runtime.arena_destroy(&db.arena)
	db^ = {}
	context.allocator = runtime.arena_allocator(&db.arena)
	data := transmute([]byte)strings.clone(text)
	index, ok := index_object(data)
	if !ok do return false
	db.text, db.source = data, index
	db.decoded = make(map[string]^types.CardExportEntry)
	return true
}

loaded :: proc(db: ^DB) -> bool {return db.text != nil}

count :: proc(db: ^DB) -> int {return len(db.source)}

// The card under its database key (its lowercase name), decoded on first use. A card whose JSON doesn't decode is
// reported as missing, as an eager load would have left it out.
by_key :: proc(db: ^DB, key: string) -> (^types.CardExportEntry, bool) {
	if e, ok := db.decoded[key]; ok do return e, e != nil
	source, ok := db.source[key]
	if !ok do return nil, false
	context.allocator = runtime.arena_allocator(&db.arena)
	entry: ^types.CardExportEntry
	if tree, err := json.parse(source); err == nil {
		entry = new(types.CardExportEntry)
		if !types.decode_CardExportEntry(tree, entry) do entry = nil
	}
	if entry != nil do join_spell_paragraphs(&entry.face)
	db.decoded[strings.clone(key)] = entry
	return entry, entry != nil
}

// A spell's text in several paragraphs ("Return target creature to its owner's hand. / Addendum — If you cast this
// spell during your main phase, draw a card.") is one list of instructions, followed in order (CR 608.2c). The card
// data lists each paragraph as a spell ability of its own; they're joined into one chain here, each later paragraph
// an independent instruction after the ones before (its own condition skips only itself).
join_spell_paragraphs :: proc(face: ^types.CardFace) {
	if face.modal != nil do return
	spells := 0
	for a in face.abilities do if a.kind == .Spell do spells += 1
	if spells < 2 do return
	kept := make([dynamic]types.AbilityDefinition)
	first := -1
	for a in face.abilities {
		if a.kind != .Spell || first < 0 {
			if a.kind == .Spell do first = len(kept)
			append(&kept, a)
			continue
		}
		last := &kept[first]
		for last.sub_ability != nil do last = last.sub_ability
		next := new(types.AbilityDefinition)
		next^ = a
		next.sub_link = .SequentialSibling
		last.sub_ability = next
	}
	face.abilities = kept
}

// A card by the name a deck list spells it: keys are lowercase, and a composite "Front // Back" spelling names its
// front face.
find :: proc(db: ^DB, name: string) -> (^types.CardExportEntry, bool) {
	key := strings.to_lower(name, context.temp_allocator)
	if e, ok := by_key(db, key); ok do return e, true
	if i := strings.index(key, "//"); i >= 0 {
		if e, ok := by_key(db, strings.trim_space(key[:i])); ok do return e, true
	}
	return nil, false
}

// The members of a JSON object, each as its key and the bytes of its value, without building a tree.
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

// The other face of a double-faced card (CR 712): the entry with the same oracle id and the other face index. The
// card data lists each face as a card of its own, linked only by that id.
other_face :: proc(db: ^DB, e: ^types.CardExportEntry) -> (^types.CardExportEntry, bool) {
	oracle, has_oracle := e.face.scryfall_oracle_id.?
	index, has_index := e.face_index.?
	if !has_oracle || !has_index || index > 1 do return nil, false
	if !db.faces_built {
		context.allocator = runtime.arena_allocator(&db.arena)
		db.faces = make(map[string][2]string)
		for key, source in db.source {
			text := string(source)
			if !strings.contains(text, `"face_index":`) do continue
			id := field_string(text, `"scryfall_oracle_id":"`)
			at := strings.index(text, `"face_index":`)
			if id == "" || at < 0 do continue
			rest := strings.trim_left_space(text[at + len(`"face_index":`):])
			if len(rest) == 0 || rest[0] < '0' || rest[0] > '1' do continue
			pair := db.faces[id]
			pair[rest[0] - '0'] = key
			db.faces[id] = pair
		}
		db.faces_built = true
	}
	pair, ok := db.faces[oracle]
	if !ok do return nil, false
	key := pair[1 - index]
	if key == "" do return nil, false
	return by_key(db, key)
}

// The string value after a JSON key prefix (`"key":"`), or "".
@(private = "file")
field_string :: proc(text: string, prefix: string) -> string {
	at := strings.index(text, prefix)
	if at < 0 do return ""
	rest := text[at + len(prefix):]
	end := strings.index_byte(rest, '"')
	if end < 0 do return ""
	return rest[:end]
}
