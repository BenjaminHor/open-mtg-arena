//! D-183: the card-text parses the engine would otherwise run during play,
//! precomputed into the card data.
//!
//! A few engine paths parse text while a game runs: dungeon rooms, a catalog
//! token's rules text, ability stickers, a Champion keyword's type and a
//! protection quality's subtype word (docs/odin-port.md, "D-183 runtime parse
//! census"). Every one of those inputs is either an engine constant or a string
//! from the card data, so oracle-gen runs the same parses at build time and
//! writes the results into `card-data.json` under [`ENGINE_PARSES_KEY`].
//!
//! Loading card data that carries the table installs it process-wide
//! ([`install`]). Each parse site then looks its input up here first and parses
//! only on a miss: in Rust that keeps the unit tests that build cards from
//! Oracle text (no card-data file) working unchanged, and with card data loaded
//! a miss means a gap in the build-time enumeration ([`miss_count`]). A hit
//! holds exactly what the parser returns for the same input, so the engine
//! behaves the same either way. The Odin engine reads only the table.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};

use crate::types::ability::{
    AbilityDefinition, AbilityKind, ContinuousModification, StaticDefinition, TargetFilter,
};
use crate::types::card::CardFace;

/// The reserved top-level key of `card-data.json` that holds the table. No card
/// is keyed by it (card keys are lowercased card names); the card-data loaders
/// read it apart from the cards.
pub const ENGINE_PARSES_KEY: &str = "__engine_parses__";

/// The precomputed parses, keyed by their inputs. Maps are ordered so the card
/// data is written deterministically.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct EngineParses {
    /// CR 309.4c: dungeon room texts parsed as spell abilities
    /// (`dungeon::ROOM_EFFECT_TEXTS`), by text.
    #[serde(default)]
    pub effect_chains: BTreeMap<String, AbilityDefinition>,
    /// CR 111.4: a catalog token's rules text, by the token's display name, then
    /// by the text (`TokenPreset::rules_text`).
    #[serde(default)]
    pub token_rules_texts: BTreeMap<String, BTreeMap<String, TokenRulesTextParse>>,
    /// CR 123.7: an ability sticker's text as the card face it grants, by text.
    #[serde(default)]
    pub sticker_faces: BTreeMap<String, CardFace>,
    /// CR 702.72a: a Champion keyword's type as the union filter of an "X or Y"
    /// type (null for a single type), by the keyword's type text.
    #[serde(default)]
    pub champion_type_unions: BTreeMap<String, Option<TargetFilter>>,
    /// CR 205.3m: a lowercased protection quality read as a subtype word (null
    /// when it isn't one), by the quality.
    #[serde(default)]
    pub subtype_words: BTreeMap<String, Option<SubtypeWord>>,
}

/// What a catalog token's rules text defines (`token::parse_catalog_rules_text`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TokenRulesTextParse {
    pub static_definitions: Vec<StaticDefinition>,
    pub modifications: Vec<ContinuousModification>,
    pub unparsed_lines: Vec<String>,
}

/// A subtype word at the start of a text: the subtype and the bytes it spans.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubtypeWord {
    pub subtype: String,
    pub consumed: usize,
}

static INSTALLED: RwLock<Option<Arc<EngineParses>>> = RwLock::new(None);
static MISSES: AtomicUsize = AtomicUsize::new(0);

/// Make `parses` the table every parse site reads. Called by the card-data
/// loaders when the data carries one; the last loaded table wins.
pub fn install(parses: Arc<EngineParses>) {
    *INSTALLED.write().unwrap_or_else(|e| e.into_inner()) = Some(parses);
}

/// How many lookups missed while a table was installed: inputs the build-time
/// enumeration didn't reach, which the engine then parsed.
pub fn miss_count() -> usize {
    MISSES.load(Ordering::Relaxed)
}

/// Look `find` up in the installed table. `None` when no table is installed or
/// the input isn't in it (counted as a miss).
fn lookup<T>(find: impl FnOnce(&EngineParses) -> Option<T>) -> Option<T> {
    let installed = INSTALLED.read().unwrap_or_else(|e| e.into_inner());
    let table = installed.as_deref()?;
    let found = find(table);
    if found.is_none() {
        MISSES.fetch_add(1, Ordering::Relaxed);
    }
    found
}

/// A dungeon room text's precomputed parse.
pub fn effect_chain(text: &str) -> Option<AbilityDefinition> {
    lookup(|table| table.effect_chains.get(text).cloned())
}

/// A catalog token's precomputed rules-text parse.
pub fn token_rules_text(display_name: &str, rules_text: &str) -> Option<TokenRulesTextParse> {
    lookup(|table| {
        table
            .token_rules_texts
            .get(display_name)
            .and_then(|by_text| by_text.get(rules_text))
            .cloned()
    })
}

/// An ability sticker's precomputed face.
pub fn sticker_face(text: &str) -> Option<CardFace> {
    lookup(|table| table.sticker_faces.get(text).cloned())
}

/// A Champion type's precomputed union filter. The outer `Option` is the lookup;
/// the inner one is the parse's own answer.
pub fn champion_type_union(type_str: &str) -> Option<Option<TargetFilter>> {
    lookup(|table| table.champion_type_unions.get(type_str).cloned())
}

/// A protection quality's precomputed subtype word, in `parse_subtype`'s shape.
/// The outer `Option` is the lookup; the inner one is the parse's own answer.
pub fn subtype_word(quality: &str) -> Option<Option<(String, usize)>> {
    lookup(|table| {
        table
            .subtype_words
            .get(quality)
            .map(|word| word.as_ref().map(|w| (w.subtype.clone(), w.consumed)))
    })
}

/// Build the table: what oracle-gen writes into the card data. `faces` are the
/// card data's faces, searched for Champion types and protection qualities
/// (with the token catalog's and stickers' own parses, which can carry them too).
pub fn build<'a>(faces: impl IntoIterator<Item = &'a CardFace>) -> EngineParses {
    let mut parses = EngineParses::default();

    for text in crate::game::dungeon::ROOM_EFFECT_TEXTS {
        let parsed =
            crate::parser::oracle_effect::parse_effect_chain(text, AbilityKind::Spell);
        parses.effect_chains.insert(text.to_string(), parsed);
    }

    for preset in crate::game::token_presets::known_token_presets() {
        let Some(rules_text) = preset.rules_text.as_deref().filter(|text| !text.is_empty()) else {
            continue;
        };
        let display_name = &preset.body.display_name;
        let (static_definitions, modifications, unparsed_lines) =
            crate::game::effects::token::parse_catalog_rules_text(rules_text, display_name);
        parses
            .token_rules_texts
            .entry(display_name.clone())
            .or_default()
            .insert(
                rules_text.to_string(),
                TokenRulesTextParse {
                    static_definitions,
                    modifications,
                    unparsed_lines,
                },
            );
    }

    for text in crate::game::stickers::ability_sticker_texts() {
        let face = crate::game::stickers::build_sticker_ability_face(&text);
        parses.sticker_faces.insert(text, face);
    }

    // Champion types and protection qualities come from keywords anywhere in the
    // data: printed, granted by an effect, or in a token's or sticker's abilities.
    let mut inputs = KeywordInputs::default();
    for face in faces {
        inputs.collect(face);
    }
    for face in parses.sticker_faces.values() {
        inputs.collect(face);
    }
    for by_text in parses.token_rules_texts.values() {
        for parse in by_text.values() {
            inputs.collect(parse);
        }
    }
    for chain in parses.effect_chains.values() {
        inputs.collect(chain);
    }
    for type_str in inputs.champion_types {
        let union = crate::database::synthesis::parse_champion_type_union(&type_str);
        parses.champion_type_unions.insert(type_str, union);
    }
    for quality in inputs.protection_qualities {
        let word = crate::parser::oracle_util::parse_subtype(&quality)
            .map(|(subtype, consumed)| SubtypeWord { subtype, consumed });
        parses.subtype_words.insert(quality, word);
    }

    parses
}

/// The keyword payloads that reach a parse during play.
#[derive(Default)]
struct KeywordInputs {
    /// `Keyword::Champion(type)`: parsed when Champion's triggers are built
    /// (`synthesis::champion_type_filter`), except for "creature".
    champion_types: BTreeSet<String>,
    /// `ProtectionTarget::CardType(quality)`, lowercased as
    /// `keywords::matching_card_type_quality` reads it.
    protection_qualities: BTreeSet<String>,
}

impl KeywordInputs {
    /// Search a value's serialized form. Keyword is externally tagged
    /// (`{"Champion": "Goblin or Shaman"}`), and so is ProtectionTarget
    /// (`{"CardType": "Elves"}`); any other `{"CardType": text}` only adds an
    /// unused entry.
    fn collect(&mut self, value: &impl Serialize) {
        let value = serde_json::to_value(value).expect("card data serializes");
        self.walk(&value);
    }

    fn walk(&mut self, value: &serde_json::Value) {
        match value {
            serde_json::Value::Object(map) => {
                if map.len() == 1 {
                    match map.iter().next() {
                        Some((key, serde_json::Value::String(text))) if key == "Champion" => {
                            if !text.eq_ignore_ascii_case("creature") {
                                self.champion_types.insert(text.clone());
                            }
                        }
                        Some((key, serde_json::Value::String(text))) if key == "CardType" => {
                            self.protection_qualities.insert(text.to_ascii_lowercase());
                        }
                        _ => {}
                    }
                }
                for child in map.values() {
                    self.walk(child);
                }
            }
            serde_json::Value::Array(items) => {
                for item in items {
                    self.walk(item);
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::keywords::{Keyword, ProtectionTarget};

    /// The table with no card faces: every engine-constant input (rooms, catalog
    /// tokens, stickers) and the keyword inputs those parses carry.
    fn engine_constant_table() -> EngineParses {
        build(std::iter::empty())
    }

    /// D-183: a lookup must return exactly what the parser returns, so every
    /// precomputed value has to survive the card data's JSON unchanged.
    #[test]
    fn table_round_trips_through_card_data_json() {
        let table = engine_constant_table();
        assert_eq!(table.effect_chains.len(), crate::game::dungeon::ROOM_EFFECT_TEXTS.len());
        assert!(!table.token_rules_texts.is_empty());
        assert!(!table.sticker_faces.is_empty());
        let json = serde_json::to_string(&table).unwrap();
        let read: EngineParses = serde_json::from_str(&json).unwrap();
        assert_eq!(read, table);
    }

    /// CR 702.72a + CR 702.16: Champion types and protection qualities are
    /// collected from a face's keywords, keyed as the play-time readers ask.
    #[test]
    fn keyword_inputs_are_collected_from_faces() {
        let face = CardFace {
            name: "Test Champion".to_string(),
            keywords: vec![
                Keyword::Champion("Goblin or Shaman".to_string()),
                Keyword::Champion("Creature".to_string()),
                Keyword::Protection(ProtectionTarget::CardType("Elves".to_string())),
            ],
            ..Default::default()
        };
        let table = build([&face]);
        assert_eq!(
            table.champion_type_unions.get("Goblin or Shaman"),
            Some(&crate::database::synthesis::parse_champion_type_union("Goblin or Shaman")),
        );
        assert!(
            table.champion_type_unions["Goblin or Shaman"].is_some(),
            "an \"X or Y\" type is a union"
        );
        // "creature" never reaches the type-phrase parse (champion_type_filter).
        assert!(!table.champion_type_unions.contains_key("Creature"));
        assert_eq!(
            table.subtype_words.get("elves"),
            Some(&Some(SubtypeWord {
                subtype: "Elf".to_string(),
                consumed: "elves".len()
            })),
        );
    }

    /// The card-data loader reads the reserved key apart from the cards and
    /// installs it, after which every engine-constant input is a hit. (The table
    /// installed is the real one, so tests running alongside read the same
    /// answers as their own parses.)
    #[test]
    fn loading_card_data_installs_the_table() {
        let table = engine_constant_table();
        let mut export = serde_json::Map::new();
        export.insert(ENGINE_PARSES_KEY.to_string(), serde_json::to_value(&table).unwrap());
        let db = crate::database::CardDatabase::from_json_str(
            &serde_json::Value::Object(export).to_string(),
        )
        .unwrap();
        assert_eq!(db.card_count(), 0, "the table is not a card");

        // Each lookup must hit: a miss returns None.
        for text in crate::game::dungeon::ROOM_EFFECT_TEXTS {
            assert_eq!(effect_chain(text).as_ref(), table.effect_chains.get(text));
        }
        for text in crate::game::stickers::ability_sticker_texts() {
            assert_eq!(sticker_face(&text).as_ref(), table.sticker_faces.get(&text));
        }
        for (name, by_text) in &table.token_rules_texts {
            for (text, parse) in by_text {
                assert_eq!(token_rules_text(name, text).as_ref(), Some(parse));
            }
        }
    }
}
