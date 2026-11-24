//! Emits the Odin data model: for every Rust type reachable from the roots, an Odin type, a `decode_<T>` and an
//! `encode_<T>` (plus `encode_<T>_members` for types that can be flattened into a parent object). Types whose serde
//! is hand-written in Rust get hand-written Odin codecs (odin/engine/types/hand_*.odin); the generator only emits
//! their Odin type. Mapping and rules: docs/odin-port.md, "O-1 data model design".

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fmt::Write;

use syn::{GenericArgument, PathArguments, Type};

use crate::model::{Fields, Kind, Registry, Serde, TypeDef, Variant};

/// How a Rust type is represented, resolved through aliases.
#[derive(Clone, Debug, PartialEq)]
pub enum Shape {
    Bool,
    Int(&'static str),
    Float(&'static str),
    Str,
    Char,
    Unit,
    Json,
    Option(Box<Shape>),
    /// `Option<Box<T>>`: a nil-able pointer.
    OptPtr(Box<Shape>),
    Ptr(Box<Shape>),
    Vec(Box<Shape>),
    Map(Box<Shape>, Box<Shape>),
    Tuple(Vec<Shape>),
    Array(Box<Shape>, String),
    Named(String, Vec<Shape>),
    Param(String),
    Unknown(String),
}

const ODIN_KEYWORDS: &[&str] = &[
    "import", "foreign", "package", "typeid", "when", "where", "if", "else", "for", "switch", "in", "not_in", "do",
    "case", "break", "continue", "fallthrough", "defer", "return", "proc", "struct", "union", "enum", "bit_set",
    "bit_field", "map", "dynamic", "auto_cast", "cast", "transmute", "distinct", "using", "context", "or_else",
    "or_return", "or_break", "or_continue", "asm", "matrix", "string", "int", "uint", "bool", "rune", "any",
    "rawptr", "b", "x", "v", "out", "first", "ok", "f",
];

/// An Odin identifier for a Rust field name (keywords and names the generated code uses get a trailing `_`).
pub fn field_ident(name: &str) -> String {
    let name = name.strip_prefix("r#").unwrap_or(name);
    if ODIN_KEYWORDS.contains(&name) {
        format!("{name}_")
    } else {
        name.to_string()
    }
}

/// serde_derive's RenameRule, for variants (written in PascalCase in Rust) and fields (snake_case).
pub fn rename(rule: &str, name: &str, is_variant: bool) -> String {
    let words: Vec<String> = if is_variant {
        // Split PascalCase into lowercase words, as serde does (each uppercase letter starts a word).
        let mut words = Vec::new();
        let mut cur = String::new();
        for (i, ch) in name.char_indices() {
            if ch.is_uppercase() && i > 0 {
                words.push(cur.clone());
                cur.clear();
            }
            cur.extend(ch.to_lowercase());
        }
        words.push(cur);
        words
    } else {
        name.split('_').map(|s| s.to_string()).collect()
    };
    match rule {
        "lowercase" => {
            if is_variant { name.to_ascii_lowercase() } else { name.to_string() }
        }
        "UPPERCASE" => name.to_ascii_uppercase(),
        "PascalCase" => {
            if is_variant {
                name.to_string()
            } else {
                words.iter().map(|w| capitalize(w)).collect()
            }
        }
        "camelCase" => {
            let pascal: String = if is_variant { name.to_string() } else { words.iter().map(|w| capitalize(w)).collect() };
            let mut c = pascal.chars();
            match c.next() {
                Some(f) => f.to_lowercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        }
        "snake_case" => {
            if is_variant { words.join("_") } else { name.to_string() }
        }
        "SCREAMING_SNAKE_CASE" => {
            if is_variant { words.join("_").to_ascii_uppercase() } else { name.to_ascii_uppercase() }
        }
        "kebab-case" => {
            if is_variant { words.join("-") } else { name.replace('_', "-") }
        }
        "SCREAMING-KEBAB-CASE" => {
            if is_variant { words.join("-").to_ascii_uppercase() } else { name.replace('_', "-").to_ascii_uppercase() }
        }
        other => panic!("unknown rename rule {other}"),
    }
}

fn capitalize(w: &str) -> String {
    let mut c = w.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

fn last_ident(ty: &Type) -> Option<(String, Vec<Type>)> {
    if let Type::Path(p) = ty {
        let seg = p.path.segments.last()?;
        let mut args = Vec::new();
        if let PathArguments::AngleBracketed(a) = &seg.arguments {
            for arg in &a.args {
                if let GenericArgument::Type(t) = arg {
                    args.push(t.clone());
                }
            }
        }
        return Some((seg.ident.to_string(), args));
    }
    None
}

pub struct Emitter<'a> {
    pub reg: &'a Registry,
    /// Types whose codecs are hand-written in Odin.
    pub hand: BTreeSet<String>,
    pub types_out: String,
    pub codec_out: String,
    pub emitted: BTreeSet<String>,
    queue: VecDeque<String>,
    /// Named skip predicates and default functions that need a hand-written Odin procedure.
    pub needed_skips: BTreeSet<String>,
    pub needed_defaults: BTreeSet<String>,
    pub unknown_shapes: BTreeMap<String, BTreeSet<String>>,
    /// Types that some field flattens into its parent object (they need `_members` encoders).
    pub flattened: BTreeSet<String>,
    current: String,
}

impl<'a> Emitter<'a> {
    pub fn new(reg: &'a Registry, hand: BTreeSet<String>) -> Self {
        Emitter {
            reg,
            hand,
            types_out: String::new(),
            codec_out: String::new(),
            emitted: BTreeSet::new(),
            queue: VecDeque::new(),
            needed_skips: BTreeSet::new(),
            needed_defaults: BTreeSet::new(),
            unknown_shapes: BTreeMap::new(),
            flattened: BTreeSet::new(),
            current: String::new(),
        }
    }

    /// The definition used for a name: the serde-deriving one if there are several.
    pub fn def(&self, name: &str) -> Option<&'a TypeDef> {
        let defs = self.reg.types.get(name)?;
        defs.iter().find(|d| d.derives_serialize() || d.derives_deserialize()).or(defs.first())
    }

    pub fn shape(&mut self, ty: &Type, params: &[String]) -> Shape {
        match ty {
            Type::Reference(r) => return self.shape(&r.elem, params),
            Type::Paren(p) => return self.shape(&p.elem, params),
            Type::Group(g) => return self.shape(&g.elem, params),
            Type::Tuple(t) if t.elems.is_empty() => return Shape::Unit,
            Type::Tuple(t) => return Shape::Tuple(t.elems.iter().map(|e| self.shape(e, params)).collect()),
            Type::Array(a) => {
                let len = &a.len;
                return Shape::Array(Box::new(self.shape(&a.elem, params)), quote::quote!(#len).to_string());
            }
            Type::Slice(s) => return Shape::Vec(Box::new(self.shape(&s.elem, params))),
            _ => {}
        }
        let Some((name, args)) = last_ident(ty) else {
            return Shape::Unknown(quote::quote!(#ty).to_string());
        };
        let arg = |this: &mut Self, i: usize| -> Shape {
            args.get(i).map(|t| this.shape(t, params)).unwrap_or(Shape::Unknown(format!("{name} arg {i}")))
        };
        match name.as_str() {
            "bool" => Shape::Bool,
            "u8" => Shape::Int("u8"),
            "u16" => Shape::Int("u16"),
            "u32" | "NonZeroU32" => Shape::Int("u32"),
            "u64" | "NonZeroU64" => Shape::Int("u64"),
            "u128" => Shape::Int("u128"),
            "usize" | "NonZeroUsize" => Shape::Int("int"),
            "NonZeroU8" => Shape::Int("u8"),
            "i8" => Shape::Int("i8"),
            "i16" => Shape::Int("i16"),
            "i32" => Shape::Int("i32"),
            "i64" => Shape::Int("i64"),
            "i128" => Shape::Int("i128"),
            "isize" => Shape::Int("int"),
            "f32" => Shape::Float("f32"),
            "f64" => Shape::Float("f64"),
            "char" => Shape::Char,
            "String" | "str" | "Cow" => Shape::Str,
            "Value" | "Map" if !self.reg.types.contains_key(&name) || name == "Map" => Shape::Json,
            "Option" => match arg(self, 0) {
                Shape::Ptr(inner) => Shape::OptPtr(inner),
                s => Shape::Option(Box::new(s)),
            },
            "Box" | "Arc" | "Rc" => Shape::Ptr(Box::new(arg(self, 0))),
            "Vec" | "VecDeque" | "SmallVec" | "Vector" | "HashSet" | "BTreeSet" | "IndexSet" | "OrdSet"
            | "FxHashSet" => {
                // SmallVec<[T; N]>: the element is inside the array argument.
                if name == "SmallVec" {
                    if let Some(Type::Array(a)) = args.first() {
                        return Shape::Vec(Box::new(self.shape(&a.elem, params)));
                    }
                }
                Shape::Vec(Box::new(arg(self, 0)))
            }
            "HashMap" | "BTreeMap" | "IndexMap" | "OrdMap" | "FxHashMap" => {
                Shape::Map(Box::new(arg(self, 0)), Box::new(arg(self, 1)))
            }
            "PhantomData" => Shape::Unit,
            _ if params.contains(&name) => Shape::Param(name),
            _ => {
                if let Some(aliases) = self.reg.aliases.get(&name) {
                    if self.reg.types.get(&name).is_none() {
                        let target = aliases[0].0.clone();
                        return self.shape(&target, params);
                    }
                }
                if self.reg.types.contains_key(&name) {
                    let a: Vec<Shape> = (0..args.len()).map(|i| arg(self, i)).collect();
                    self.require(&name);
                    Shape::Named(name, a)
                } else {
                    self.unknown_shapes.entry(name.clone()).or_default().insert(self.current.clone());
                    Shape::Unknown(name)
                }
            }
        }
    }

    pub fn require(&mut self, name: &str) {
        if !self.emitted.contains(name) && !self.queue.iter().any(|q| q == name) {
            self.queue.push_back(name.to_string());
        }
    }

    pub fn odin(&self, s: &Shape) -> String {
        match s {
            Shape::Bool => "bool".into(),
            Shape::Int(t) | Shape::Float(t) => t.to_string(),
            Shape::Str => "string".into(),
            Shape::Char => "rune".into(),
            Shape::Unit => "Unit".into(),
            Shape::Json => "json.Value".into(),
            Shape::Option(i) => format!("Maybe({})", self.odin(i)),
            Shape::OptPtr(i) | Shape::Ptr(i) => format!("^{}", self.odin(i)),
            Shape::Vec(i) => format!("[dynamic]{}", self.odin(i)),
            Shape::Map(k, v) => {
                if self.simple_key(k) {
                    format!("map[{}]{}", self.odin(k), self.odin(v))
                } else {
                    format!("[dynamic]Tuple2({}, {})", self.odin(k), self.odin(v))
                }
            }
            Shape::Tuple(es) => {
                let inner: Vec<String> = es.iter().map(|e| self.odin(e)).collect();
                format!("Tuple{}({})", es.len(), inner.join(", "))
            }
            Shape::Array(e, n) => format!("[{}]{}", n, self.odin(e)),
            Shape::Named(n, args) if args.is_empty() => n.clone(),
            Shape::Named(n, args) => {
                let a: Vec<String> = args.iter().map(|x| self.odin(x)).collect();
                format!("{n}({})", a.join(", "))
            }
            Shape::Param(p) => p.clone(),
            Shape::Unknown(u) => format!("Unknown /* {u} */"),
        }
    }

    /// Map keys Odin can hash and JSON can write as an object key: strings, integers, unit-only enums and newtypes
    /// of those.
    pub fn simple_key(&self, k: &Shape) -> bool {
        match k {
            Shape::Str | Shape::Int(_) | Shape::Char | Shape::Bool => true,
            Shape::Named(n, a) if a.is_empty() => match self.def(n).map(|d| &d.kind) {
                Some(Kind::Enum(vs)) => vs.iter().all(|v| matches!(v.fields, Fields::Unit)),
                Some(Kind::Struct(Fields::Tuple(fs))) if fs.len() == 1 => {
                    matches!(last_ident(&fs[0].ty).map(|x| x.0).as_deref(), Some("u8" | "u16" | "u32" | "u64" | "usize" | "i32" | "i64" | "String"))
                }
                _ => false,
            },
            _ => false,
        }
    }

    pub fn run(&mut self, roots: &[&str]) {
        for r in roots {
            self.require(r);
        }
        while let Some(name) = self.queue.pop_front() {
            if self.emitted.contains(&name) {
                continue;
            }
            self.emitted.insert(name.clone());
            let Some(def) = self.def(&name) else { continue };
            self.current = name.clone();
            self.emit_type(def);
            if !self.hand.contains(&name) {
                self.emit_codec(def);
            }
        }
    }

    fn params_decl(def: &TypeDef) -> String {
        if def.generics.is_empty() {
            String::new()
        } else {
            let p: Vec<String> = def.generics.iter().map(|g| format!("${g}: typeid")).collect();
            format!("({})", p.join(", "))
        }
    }

    fn fields_struct(&mut self, fields: &Fields, params: &[String]) -> String {
        let mut out = String::new();
        match fields {
            Fields::Named(fs) => {
                for f in fs {
                    let s = self.shape(&f.ty, params);
                    let _ = writeln!(out, "\t{}: {},", field_ident(f.name.as_ref().unwrap()), self.odin(&s));
                }
            }
            Fields::Tuple(fs) => {
                for (i, f) in fs.iter().enumerate() {
                    let s = self.shape(&f.ty, params);
                    let _ = writeln!(out, "\t_{i}: {},", self.odin(&s));
                }
            }
            Fields::Unit => {}
        }
        out
    }

    fn is_unit_enum(def: &TypeDef) -> bool {
        matches!(&def.kind, Kind::Enum(vs) if vs.iter().all(|v| matches!(v.fields, Fields::Unit)))
    }

    fn emit_type(&mut self, def: &TypeDef) {
        let params = def.generics.clone();
        let name = &def.name;
        match &def.kind {
            Kind::Struct(Fields::Tuple(fs)) if fs.len() == 1 && params.is_empty() => {
                let s = self.shape(&fs[0].ty, &params);
                let _ = writeln!(self.types_out, "{name} :: distinct {}\n", self.odin(&s));
            }
            Kind::Struct(fields) => {
                let body = self.fields_struct(fields, &params);
                let _ = writeln!(self.types_out, "{name} :: struct{} {{\n{body}}}\n", Self::params_decl(def));
            }
            Kind::Enum(vs) if Self::is_unit_enum(def) => {
                let names: Vec<String> = vs.iter().map(|v| format!("\t{},", v.name)).collect();
                let _ = writeln!(self.types_out, "{name} :: enum u16 {{\n{}\n}}\n", names.join("\n"));
            }
            Kind::Enum(vs) => {
                let mut members = Vec::new();
                for v in vs {
                    let vname = format!("{name}_{}", v.name);
                    let body = self.fields_struct(&v.fields, &params);
                    let _ = writeln!(self.types_out, "{vname} :: struct{} {{\n{body}}}", Self::params_decl(def));
                    if params.is_empty() {
                        members.push(format!("\t{vname},"));
                    } else {
                        members.push(format!("\t{vname}({}),", params.join(", ")));
                    }
                }
                let _ = writeln!(self.types_out, "{name} :: union{} {{\n{}\n}}\n", Self::params_decl(def), members.join("\n"));
            }
        }
    }

    // ------------------------------------------------------------------------------------------------ codecs ---

    fn json_field_name(f_name: &str, field: &Serde, rule: Option<&str>) -> String {
        if let Some(r) = &field.rename {
            return r.clone();
        }
        match rule {
            Some(rule) => rename(rule, f_name.strip_prefix("r#").unwrap_or(f_name), false),
            None => f_name.strip_prefix("r#").unwrap_or(f_name).to_string(),
        }
    }

    fn variant_name(v: &Variant, enum_serde: &Serde) -> String {
        if let Some(r) = &v.serde.rename {
            return r.clone();
        }
        match &enum_serde.rename_all {
            Some(rule) => rename(rule, &v.name, true),
            None => v.name.clone(),
        }
    }

    /// The Odin expression that tests whether a field is skipped when serializing.
    fn skip_expr(&mut self, pred: &str, expr: &str, shape: &Shape) -> String {
        let last = pred.rsplit("::").next().unwrap_or(pred);
        match (pred, last) {
            (_, "is_none") if pred.starts_with("Option") => format!("{expr} == nil"),
            (_, "is_empty") if pred.starts_with("Vec") || pred.starts_with("HashMap") || pred.starts_with("HashSet")
                || pred.starts_with("BTreeMap") || pred.starts_with("BTreeSet") || pred.starts_with("im::")
                || pred.starts_with("String") || pred.starts_with("IndexMap") || pred.starts_with("SmallVec")
                || pred.starts_with("VecDeque") => format!("len({expr}) == 0"),
            ("std::ops::Not::not" | "Not::not", _) | (_, "is_false") => format!("!{expr}"),
            (_, "is_zero_u32" | "is_zero_usize" | "is_zero_u64" | "is_zero" | "is_zero_u32_field" | "is_zero_u8"
                | "is_zero_i32") => format!("{expr} == 0"),
            _ => {
                let _ = shape;
                let proc_name = format!("skip_{}", pred.replace("::", "_").replace("crate_types_", "").replace("phase_ast_types_", ""));
                self.needed_skips.insert(format!("{proc_name}  ({pred})"));
                format!("{proc_name}({expr})")
            }
        }
    }

    fn default_stmt(&mut self, target: &str, field: &Serde, shape: &Shape) -> Option<String> {
        match &field.default {
            Some(Some(path)) => {
                let proc_name = format!("default_{}", path.replace("::", "_"));
                self.needed_defaults.insert(format!("{proc_name}  ({path}) -> {}", self.odin(shape)));
                Some(format!("{target} = {proc_name}()"))
            }
            Some(None) => Some(String::new()),
            None => None,
        }
    }

    /// Decode statements for a struct's named fields from the object `v` into `out`.
    fn decode_named_fields(&mut self, fields: &[crate::model::Field], params: &[String], rule: Option<&str>, container_default: bool, ctx: &str) -> String {
        let mut out = String::new();
        for f in fields {
            let fname = f.name.as_ref().unwrap();
            let id = field_ident(fname);
            if f.serde.skip || f.serde.skip_deserializing {
                continue;
            }
            let shape = self.shape(&f.ty, params);
            if f.serde.flatten {
                let _ = writeln!(out, "\tif !decode(v, &out.{id}) do return fail(\"{ctx}.{fname} (flattened)\")");
                continue;
            }
            let jname = Self::json_field_name(fname, &f.serde, rule);
            let mut names = vec![jname.clone()];
            names.extend(f.serde.aliases.iter().cloned());
            let lookup: Vec<String> = names.iter().map(|n| format!("\"{n}\"")).collect();
            let missing = if let Some(stmt) = self.default_stmt(&format!("out.{id}"), &f.serde, &shape) {
                if stmt.is_empty() { String::new() } else { format!(" else {{ {stmt} }}") }
            } else if container_default || matches!(shape, Shape::Option(_) | Shape::OptPtr(_)) {
                String::new()
            } else {
                format!(" else {{ return fail(\"{ctx}.{fname} missing\") }}")
            };
            let _ = writeln!(
                out,
                "\tif fv, found := get_any(v, {}); found {{ if !decode(fv, &out.{id}) do return fail(\"{ctx}.{fname}\") }}{missing}",
                lookup.join(", ")
            );
        }
        out
    }

    /// Statements writing a struct's named fields as members of an object already opened (`first` tracks commas).
    fn encode_named_fields(&mut self, fields: &[crate::model::Field], params: &[String], rule: Option<&str>, src: &str) -> String {
        let mut out = String::new();
        for f in fields {
            let fname = f.name.as_ref().unwrap();
            let id = field_ident(fname);
            if f.serde.skip || f.serde.skip_serializing {
                continue;
            }
            let shape = self.shape(&f.ty, params);
            let expr = format!("{src}.{id}");
            if f.serde.flatten {
                if let Shape::Named(n, _) = &shape {
                    self.flattened.insert(n.clone());
                }
                let _ = writeln!(out, "\tencode_members(b, {expr}, first)");
                continue;
            }
            let jname = Self::json_field_name(fname, &f.serde, rule);
            let write = format!("member(b, first, \"{jname}\"); encode(b, {expr})");
            match &f.serde.skip_serializing_if {
                Some(pred) => {
                    let cond = self.skip_expr(pred, &expr, &shape);
                    let _ = writeln!(out, "\tif !({cond}) {{ {write} }}");
                }
                None => {
                    let _ = writeln!(out, "\t{write}");
                }
            }
        }
        out
    }

    fn emit_codec(&mut self, def: &TypeDef) {
        let params = def.generics.clone();
        let name = def.name.clone();
        let ty = if params.is_empty() { name.clone() } else { format!("{name}({})", params.iter().map(|p| format!("${p}")).collect::<Vec<_>>().join(", ")) };
        let ty_use = if params.is_empty() { name.clone() } else { format!("{name}({})", params.join(", ")) };
        let serde = def.serde.clone();
        if serde.from.is_some() || serde.into.is_some() || serde.try_from.is_some() {
            // Converted through another type: hand-written.
            self.hand.insert(name.clone());
            return;
        }
        let mut dec = String::new();
        let mut enc = String::new();
        let mut members: Option<String> = None;
        let rule = serde.rename_all.clone();
        match &def.kind {
            Kind::Struct(Fields::Unit) => {
                dec = "\t_ = out\n\treturn v.kind == .Null || v.kind == .Object\n".into();
                enc = "\t_ = x\n\tstrings.write_string(b, \"null\")\n".into();
            }
            Kind::Struct(Fields::Tuple(fs)) if fs.len() == 1 => {
                let inner = self.shape(&fs[0].ty, &params);
                let it = self.odin(&inner);
                if params.is_empty() {
                    dec = format!("\treturn decode(v, cast(^{it})out)\n");
                    enc = format!("\tencode(b, {it}(x))\n");
                } else {
                    dec = "\treturn decode(v, &out._0)\n".into();
                    enc = "\tencode(b, x._0)\n".into();
                }
            }
            Kind::Struct(Fields::Tuple(fs)) => {
                let mut d = format!("\tif v.kind != .Array || len(v.items) != {} do return fail(\"{name} tuple\")\n", fs.len());
                let mut e = "\tstrings.write_byte(b, '[')\n".to_string();
                for (i, _) in fs.iter().enumerate() {
                    let _ = writeln!(d, "\tif !decode(v.items[{i}], &out._{i}) do return fail(\"{name}._{i}\")");
                    if i > 0 {
                        e.push_str("\tstrings.write_byte(b, ',')\n");
                    }
                    let _ = writeln!(e, "\tencode(b, x._{i})");
                }
                d.push_str("\treturn true\n");
                e.push_str("\tstrings.write_byte(b, ']')\n");
                dec = d;
                enc = e;
            }
            Kind::Struct(Fields::Named(fs)) if serde.transparent => {
                let f = fs.iter().find(|f| !f.serde.skip).unwrap();
                let id = field_ident(f.name.as_ref().unwrap());
                dec = format!("\treturn decode(v, &out.{id})\n");
                enc = format!("\tencode(b, x.{id})\n");
            }
            Kind::Struct(Fields::Named(fs)) => {
                let body = self.decode_named_fields(fs, &params, rule.as_deref(), serde.default.is_some(), &name);
                dec = format!("\tif v.kind != .Object do return fail(\"{name}: not an object\")\n{body}\treturn true\n");
                let m = self.encode_named_fields(fs, &params, rule.as_deref(), "x");
                enc = "\tstrings.write_byte(b, '{')\n\tf := true\n\tencode_members(b, x, &f)\n\tstrings.write_byte(b, '}')\n".into();
                members = Some(m);
            }
            Kind::Enum(vs) if Self::is_unit_enum(def) => {
                let (d, e, m) = self.unit_enum_codec(def, vs);
                dec = d;
                enc = e;
                members = m;
            }
            Kind::Enum(vs) => {
                let (d, e, m) = self.data_enum_codec(def, vs, &params);
                dec = d;
                enc = e;
                members = m;
            }
        }
        let _ = writeln!(self.codec_out, "decode_{name} :: proc(v: json.Value, out: ^{ty}) -> bool {{\n{dec}}}\n");
        let _ = writeln!(self.codec_out, "encode_{name} :: proc(b: ^strings.Builder, x: {ty}) {{\n{enc}}}\n");
        if let Some(m) = members {
            let used = if m.contains("x.") || m.contains("x)") || m.contains("(x") || m.contains(" x ") { "" } else { "\t_ = x\n" };
            let firstused = if m.contains("first") { "" } else { "\t_ = first\n" };
            let _ = writeln!(self.codec_out, "encode_{name}_members :: proc(b: ^strings.Builder, x: {ty}, first: ^bool) {{\n{used}{firstused}{m}}}\n");
        }
        let _ = ty_use;
    }

    fn tag_value(enum_serde: &Serde, v: &Variant) -> String {
        Self::variant_name(v, enum_serde)
    }

    fn unit_enum_codec(&mut self, def: &TypeDef, vs: &[Variant]) -> (String, String, Option<String>) {
        let name = &def.name;
        let s = &def.serde;
        // Decode the variant name from a string.
        let mut cases = String::new();
        let mut other = None;
        for v in vs {
            if v.serde.other {
                other = Some(v.name.clone());
            }
            let mut names = vec![Self::tag_value(s, v)];
            names.extend(v.serde.aliases.iter().cloned());
            let lits: Vec<String> = names.iter().map(|n| format!("\"{n}\"")).collect();
            let _ = writeln!(cases, "\tcase {}: out^ = .{}", lits.join(", "), v.name);
        }
        let default_case = match other {
            Some(o) => format!("\tcase: out^ = .{o}\n"),
            None => format!("\tcase: return fail(\"{name}: unknown variant\")\n"),
        };
        let from_str = format!("\tswitch str {{\n{cases}{default_case}\t}}\n\treturn true\n");
        let mut names_tbl = String::new();
        for v in vs {
            let _ = writeln!(names_tbl, "\t\t.{} = \"{}\",", v.name, Self::tag_value(s, v));
        }
        let table = format!("\t@(static, rodata) NAMES := [{name}]string{{\n{names_tbl}\t}}\n");
        if let Some(tag) = &s.tag {
            // Internally (or adjacently) tagged, all unit: {"tag": "Variant"}.
            let dec = format!("\tif v.kind != .Object do return fail(\"{name}: not an object\")\n\ttv, found := json.get(v, \"{tag}\")\n\tif !found || tv.kind != .String do return fail(\"{name}: no tag\")\n\tstr := tv.text\n{from_str}");
            let enc = "\tstrings.write_byte(b, '{')\n\tf := true\n\tencode_members(b, x, &f)\n\tstrings.write_byte(b, '}')\n".to_string();
            let mem = format!("{table}\tmember(b, first, \"{tag}\"); json.write_string(b, NAMES[x])\n");
            return (dec, enc, Some(mem));
        }
        if s.untagged {
            return (format!("\t_ = out\n\treturn v.kind == .Null\n"), "\t_ = x\n\tstrings.write_string(b, \"null\")\n".into(), None);
        }
        let dec = format!("\tif v.kind != .String do return fail(\"{name}: not a string\")\n\tstr := v.text\n{from_str}");
        let enc = format!("{table}\tjson.write_string(b, NAMES[x])\n");
        (dec, enc, None)
    }

    fn data_enum_codec(&mut self, def: &TypeDef, vs: &[Variant], params: &[String]) -> (String, String, Option<String>) {
        let name = def.name.clone();
        let s = def.serde.clone();
        let generic_suffix = if params.is_empty() { String::new() } else { format!("({})", params.join(", ")) };
        let field_rule = s.rename_all_fields.clone();
        let mut dec = String::new();
        let mut enc = String::from("\tswitch y in x {\n");
        let mut mem = String::from("\tswitch y in x {\n");
        let internally = s.tag.is_some() && s.content.is_none();
        let adjacent = s.tag.is_some() && s.content.is_some();

        if s.untagged {
            dec.push_str("\t// untagged: the first variant that decodes wins, as in serde.\n");
            for v in vs {
                let vt = format!("{name}_{}{generic_suffix}", v.name);
                match &v.fields {
                    Fields::Unit => {
                        let _ = writeln!(dec, "\tif v.kind == .Null {{ out^ = {vt}{{}}; return true }}");
                        let _ = writeln!(enc, "\tcase {vt}: _ = y; strings.write_string(b, \"null\")");
                    }
                    Fields::Tuple(fs) if fs.len() == 1 => {
                        let _ = writeln!(dec, "\t{{ tmp: {vt}; if decode_quiet(v, &tmp._0) {{ out^ = tmp; return true }} }}");
                        let _ = writeln!(enc, "\tcase {vt}: encode(b, y._0)");
                    }
                    Fields::Tuple(fs) => {
                        let _ = writeln!(dec, "\tif v.kind == .Array && len(v.items) == {} {{ tmp: {vt}; ok := true", fs.len());
                        for i in 0..fs.len() {
                            let _ = writeln!(dec, "\t\tok = ok && decode_quiet(v.items[{i}], &tmp._{i})");
                        }
                        let _ = writeln!(dec, "\t\tif ok {{ out^ = tmp; return true }}\n\t}}");
                        let mut e = format!("\tcase {vt}: strings.write_byte(b, '[')");
                        for i in 0..fs.len() {
                            if i > 0 {
                                e.push_str("; strings.write_byte(b, ',')");
                            }
                            let _ = write!(e, "; encode(b, y._{i})");
                        }
                        e.push_str("; strings.write_byte(b, ']')\n");
                        enc.push_str(&e);
                    }
                    Fields::Named(fs) => {
                        let rule = v.serde.rename_all.clone().or(field_rule.clone());
                        let body = self.decode_named_fields(fs, params, rule.as_deref(), false, &format!("{name}::{}", v.name));
                        let _ = writeln!(dec, "\tif v.kind == .Object {{ tmp: {vt}; if decode_quiet_proc(v, &tmp, proc(v: json.Value, out: ^{vt}) -> bool {{\n{body}\treturn true\n\t}}) {{ out^ = tmp; return true }} }}");
                        let m = self.encode_named_fields(fs, params, rule.as_deref(), "y");
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); {{ fst := true; first := &fst\n{m}\t}}; strings.write_byte(b, '}}')");
                    }
                }
            }
            let _ = writeln!(dec, "\treturn fail(\"{name}: no untagged variant matched\")");
            enc.push_str("\t}\n");
            return (dec, enc, None);
        }

        // The variant name: externally tagged reads it from the object's only key or a bare string; internally and
        // adjacently tagged from the tag member.
        if internally || adjacent {
            let tag = s.tag.clone().unwrap();
            let _ = writeln!(dec, "\tif v.kind != .Object do return fail(\"{name}: not an object\")\n\ttv, found := json.get(v, \"{tag}\")\n\tif !found || tv.kind != .String do return fail(\"{name}: no tag\")\n\tswitch tv.text {{");
        } else {
            dec.push_str("\tvariant: string\n\tbody: json.Value\n\tswitch v.kind {\n\tcase .String: variant = v.text\n\tcase .Object:\n\t\tif len(v.members) != 1 do return fail(\"");
            let _ = write!(dec, "{name}: externally tagged object needs one key\")\n\t\tvariant, body = v.members[0].key, v.members[0].value\n\tcase: return fail(\"{name}: not a string or object\")\n\t}}\n\tswitch variant {{\n");
        }
        let mut other_variant = None;
        for v in vs {
            if v.serde.skip || v.serde.skip_deserializing && v.serde.skip_serializing {
                continue;
            }
            if v.serde.other {
                other_variant = Some(v.name.clone());
            }
            let vt = format!("{name}_{}{generic_suffix}", v.name);
            let mut names = vec![Self::tag_value(&s, v)];
            names.extend(v.serde.aliases.iter().cloned());
            let lits: Vec<String> = names.iter().map(|n| format!("\"{n}\"")).collect();
            let vname = Self::tag_value(&s, v);
            let ctx = format!("{name}::{}", v.name);
            let rule = v.serde.rename_all.clone().or(field_rule.clone());
            // Where the variant's data is: externally tagged `body`, adjacently the content member, internally the
            // object itself.
            let data_expr = if internally {
                "v".to_string()
            } else if adjacent {
                let content = s.content.clone().unwrap();
                format!("json.get_or_null(v, \"{content}\")")
            } else {
                "body".to_string()
            };
            match &v.fields {
                Fields::Unit => {
                    let _ = writeln!(dec, "\tcase {}: out^ = {vt}{{}}", lits.join(", "));
                    if internally || adjacent {
                        let tag = s.tag.clone().unwrap();
                        let _ = writeln!(enc, "\tcase {vt}: _ = y; strings.write_byte(b, '{{'); f := true; member(b, &f, \"{tag}\"); json.write_string(b, \"{vname}\"); strings.write_byte(b, '}}')");
                        let _ = writeln!(mem, "\tcase {vt}: _ = y; member(b, first, \"{tag}\"); json.write_string(b, \"{vname}\")");
                    } else {
                        let _ = writeln!(enc, "\tcase {vt}: _ = y; json.write_string(b, \"{vname}\")");
                    }
                }
                Fields::Tuple(fs) if fs.len() == 1 => {
                    let _ = writeln!(dec, "\tcase {}: tmp: {vt}; if !decode({data_expr}, &tmp._0) do return fail(\"{ctx}\"); out^ = tmp", lits.join(", "));
                    if internally {
                        // The newtype's members are merged with the tag.
                        let tag = s.tag.clone().unwrap();
                        if let Shape::Named(n, _) = self.shape(&fs[0].ty, params) {
                            self.flattened.insert(n);
                        }
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); f := true; member(b, &f, \"{tag}\"); json.write_string(b, \"{vname}\"); encode_members(b, y._0, &f); strings.write_byte(b, '}}')");
                        let _ = writeln!(mem, "\tcase {vt}: member(b, first, \"{tag}\"); json.write_string(b, \"{vname}\"); encode_members(b, y._0, first)");
                    } else if adjacent {
                        let (tag, content) = (s.tag.clone().unwrap(), s.content.clone().unwrap());
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); f := true; member(b, &f, \"{tag}\"); json.write_string(b, \"{vname}\"); member(b, &f, \"{content}\"); encode(b, y._0); strings.write_byte(b, '}}')");
                    } else {
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); json.write_string(b, \"{vname}\"); strings.write_byte(b, ':'); encode(b, y._0); strings.write_byte(b, '}}')");
                    }
                }
                Fields::Tuple(fs) => {
                    let _ = writeln!(dec, "\tcase {}:\n\t\tdata := {data_expr}\n\t\tif data.kind != .Array || len(data.items) != {} do return fail(\"{ctx}\")\n\t\ttmp: {vt}", lits.join(", "), fs.len());
                    for i in 0..fs.len() {
                        let _ = writeln!(dec, "\t\tif !decode(data.items[{i}], &tmp._{i}) do return fail(\"{ctx}._{i}\")");
                    }
                    dec.push_str("\t\tout^ = tmp\n");
                    let mut arr = String::from("strings.write_byte(b, '[')");
                    for i in 0..fs.len() {
                        if i > 0 {
                            arr.push_str("; strings.write_byte(b, ',')");
                        }
                        let _ = write!(arr, "; encode(b, y._{i})");
                    }
                    arr.push_str("; strings.write_byte(b, ']')");
                    if adjacent {
                        let (tag, content) = (s.tag.clone().unwrap(), s.content.clone().unwrap());
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); f := true; member(b, &f, \"{tag}\"); json.write_string(b, \"{vname}\"); member(b, &f, \"{content}\"); {arr}; strings.write_byte(b, '}}')");
                    } else {
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); json.write_string(b, \"{vname}\"); strings.write_byte(b, ':'); {arr}; strings.write_byte(b, '}}')");
                    }
                }
                Fields::Named(fs) => {
                    let body = self.decode_named_fields(fs, params, rule.as_deref(), false, &ctx);
                    let _ = writeln!(dec, "\tcase {}:\n\t\ttmp: {vt}\n\t\tif !decode_variant({data_expr}, &tmp, proc(v: json.Value, out: ^{vt}) -> bool {{\n{body}\treturn true\n\t\t}}) do return fail(\"{ctx}\")\n\t\tout^ = tmp", lits.join(", "));
                    let m = self.encode_named_fields(fs, params, rule.as_deref(), "y");
                    if internally {
                        let tag = s.tag.clone().unwrap();
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); {{ fst := true; first := &fst; member(b, first, \"{tag}\"); json.write_string(b, \"{vname}\")\n{m}\t}}; strings.write_byte(b, '}}')");
                        let _ = writeln!(mem, "\tcase {vt}: member(b, first, \"{tag}\"); json.write_string(b, \"{vname}\")\n{m}");
                    } else if adjacent {
                        let (tag, content) = (s.tag.clone().unwrap(), s.content.clone().unwrap());
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); f := true; member(b, &f, \"{tag}\"); json.write_string(b, \"{vname}\"); member(b, &f, \"{content}\"); strings.write_byte(b, '{{'); {{ fst := true; first := &fst\n{m}\t}}; strings.write_byte(b, '}}'); strings.write_byte(b, '}}')");
                    } else {
                        let _ = writeln!(enc, "\tcase {vt}: strings.write_byte(b, '{{'); json.write_string(b, \"{vname}\"); strings.write_byte(b, ':'); strings.write_byte(b, '{{'); {{ fst := true; first := &fst\n{m}\t}}; strings.write_byte(b, '}}'); strings.write_byte(b, '}}')");
                    }
                }
            }
        }
        match other_variant {
            Some(o) => {
                let _ = writeln!(dec, "\tcase: out^ = {name}_{o}{generic_suffix}{{}}");
            }
            None => {
                let _ = writeln!(dec, "\tcase: return fail(\"{name}: unknown variant\")");
            }
        }
        dec.push_str("\t}\n\treturn true\n");
        enc.push_str("\t}\n");
        mem.push_str("\t}\n");
        let members = if internally { Some(mem) } else { None };
        (dec, enc, members)
    }
}

/// Names of every type the generated code defines, with their decode/encode procedure names, for the overload
/// groups.
pub fn overload_groups(e: &Emitter) -> String {
    let mut dec = vec![];
    let mut enc = vec![];
    let mut mem = vec![];
    for n in &e.emitted {
        let Some(d) = e.def(n) else { continue };
        dec.push(format!("decode_{n}"));
        enc.push(format!("encode_{n}"));
        let has_members = match &d.kind {
            Kind::Struct(Fields::Named(_)) => !d.serde.transparent,
            Kind::Enum(_) => d.serde.tag.is_some() && d.serde.content.is_none() && !d.serde.untagged,
            _ => false,
        };
        if has_members || e.flattened.contains(n) && e.hand.contains(n) {
            mem.push(format!("encode_{n}_members"));
        }
    }
    format!(
        "decode :: proc {{\n\tdecode_bool, decode_int, decode_u8, decode_u16, decode_u32, decode_u64, decode_u128, decode_i8, decode_i16, decode_i32, decode_i64, decode_i128, decode_f32, decode_f64, decode_string, decode_rune, decode_json, decode_unit,\n\tdecode_maybe, decode_ptr, decode_dynamic, decode_map, decode_pairs, decode_array, decode_tuple2, decode_tuple3, decode_tuple4,\n\t{},\n}}\n\nencode :: proc {{\n\tencode_bool, encode_int, encode_u8, encode_u16, encode_u32, encode_u64, encode_u128, encode_i8, encode_i16, encode_i32, encode_i64, encode_i128, encode_f32, encode_f64, encode_string, encode_rune, encode_json, encode_unit,\n\tencode_maybe, encode_ptr, encode_dynamic, encode_map, encode_pairs, encode_array, encode_tuple2, encode_tuple3, encode_tuple4,\n\t{},\n}}\n\nencode_members :: proc {{\n\tencode_map_members,\n\t{},\n}}\n",
        dec.join(",\n\t"),
        enc.join(",\n\t"),
        mem.join(",\n\t")
    )
}
