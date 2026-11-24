//! Translates Rust function bodies to Odin, for the subset of Rust they use. It starts with the default functions
//! and skip predicates serde attributes name (`default = "default_quantity_one"`,
//! `skip_serializing_if = "is_player_scope_controller"`), whose bodies are literals, variants, `vec![...]` and
//! `matches!`; docs/odin-port.md ("How the engine logic gets ported") is the plan for growing it into the engine's
//! translator. Anything it can't translate is reported for a hand-written Odin procedure, never guessed at.

use std::collections::BTreeMap;
use std::fmt::Write;

use quote::ToTokens;
use syn::{BinOp, Expr, Lit, Pat, Stmt, UnOp};

use crate::emit::{field_ident, Emitter, Shape};
use crate::model::{Fields, FnDef, Kind};

type R<T> = Result<T, String>;

pub struct Tx<'a, 'b> {
    pub e: &'b mut Emitter<'a>,
    /// Rust parameter names (and `self`) and the Odin expressions they become.
    pub vars: BTreeMap<String, (String, Shape)>,
    pub self_ty: Option<String>,
    /// Inlining depth (calls to single-expression functions are translated in place).
    pub depth: u32,
    /// Whole-function translation (body.rs): calls to engine functions stay calls to their translated procedures
    /// (`Owner_method`), and `.clone()` clones. Off for the serde defaults and skip predicates, which inline.
    pub calls: bool,
    /// Statements an expression needs before the line it's on (`?` becomes a temporary and an early return);
    /// body.rs writes them out ahead of the statement.
    pub pre: Vec<String>,
    /// The enclosing function's result shape (what an early return from `?` must produce).
    pub fn_ret: Shape,
    pub temps: u32,
}

/// The Odin procedure a translated engine function becomes: `Owner_method` for methods and associated
/// functions, the bare name for free functions.
pub fn proc_name(owner: Option<&str>, name: &str) -> String {
    match owner {
        Some(o) => format!("{o}_{name}"),
        None => name.to_string(),
    }
}

/// The procedure name for an engine function: methods `Owner_method`; free functions `<file>_<name>` (free
/// functions repeat names across modules, and some match Odin builtins such as `append`).
thread_local! {
    /// The file of the function being translated (free calls resolve against it).
    pub static CURRENT_FILE: std::cell::RefCell<Option<std::path::PathBuf>> = const { std::cell::RefCell::new(None) };
    /// The Rust types of the current procedure's parameters and annotated or constructed locals, by Rust name: the
    /// model holds sets as Vecs, so set operations look here (and at field types) to know what they act on.
    pub static RUST_TYPES: std::cell::RefCell<BTreeMap<String, String>> = std::cell::RefCell::new(BTreeMap::new());
    /// The function being translated names a std set type: a collect whose destination isn't seen is refused.
    pub static MENTIONS_SET: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    /// The collect expression (by address) whose destination the context knows, and what that destination is.
    pub static COLLECT_INTO: std::cell::RefCell<Option<(usize, SetKind)>> = const { std::cell::RefCell::new(None) };
    /// Inside an inlined closure body: where `?` goes instead of returning (the block's label, the result variable,
    /// the closure's result shape).
    pub static TRY_EXIT: std::cell::RefCell<Option<(String, String, Shape)>> = const { std::cell::RefCell::new(None) };
    /// Inside an inlined closure body: where `return` goes (the same block, result variable and shape as TRY_EXIT).
    /// A closure's `return` gives the closure's value, not the enclosing procedure's.
    pub static RETURN_EXIT: std::cell::RefCell<Option<(String, String, Shape)>> = const { std::cell::RefCell::new(None) };
    /// Locals declared empty (`let mut v = Vec::new()`) whose element type only a later use shows (`v.push(id)` with
    /// `id` bound further on): Odin name → (a map rather than a sequence, the shape once a use fixes it). The
    /// declaration carries a placeholder type that the finished function's text gets in its place (body.rs).
    pub static PENDING: std::cell::RefCell<BTreeMap<String, (bool, Option<Shape>)>> = const { std::cell::RefCell::new(BTreeMap::new()) };
    /// Set when translated code reads or writes a field the Rust engine doesn't serialize (`#[serde(skip)]`).
    pub static TOUCHES_UNLOGGED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    /// Procedures written by hand (hand_logic.odin and the runtime): callable even when the Rust one is generic.
    pub static HAND: std::cell::RefCell<std::collections::BTreeSet<String>> = const { std::cell::RefCell::new(std::collections::BTreeSet::new()) };
    /// Procedure names more than one engine function would get: never translated or called.
    pub static COLLIDING: std::cell::RefCell<std::collections::BTreeSet<String>> = const { std::cell::RefCell::new(std::collections::BTreeSet::new()) };
}

/// A file's module name: its stem, or its directory's name for `mod.rs`.
pub fn file_module(p: &std::path::Path) -> &str {
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    if stem == "mod" {
        p.parent().and_then(|d| d.file_name()).and_then(|s| s.to_str()).unwrap_or(stem)
    } else {
        stem
    }
}

/// The module `super` names from a file: the parent of its module.
fn parent_module(p: &std::path::Path) -> Option<&str> {
    let dir = p.parent()?;
    let dir = if p.file_stem().and_then(|s| s.to_str()) == Some("mod") { dir.parent()? } else { dir };
    let name = dir.file_name()?.to_str()?;
    Some(if name == "src" { "lib" } else { name })
}

pub fn proc_name_for(owner: Option<&str>, name: &str, f: &FnDef) -> String {
    match owner {
        Some(o) => format!("{o}_{name}"),
        None => {
            let stem = f.file.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let stem = if stem == "mod" {
                f.file.parent().and_then(|p| p.file_name()).map(|s| s.to_string_lossy().to_string()).unwrap_or(stem)
            } else {
                stem
            };
            format!("{stem}_{name}")
        }
    }
}

fn path_segs(p: &syn::Path) -> Vec<String> {
    p.segments.iter().map(|s| s.ident.to_string()).collect()
}

fn lit(l: &Lit) -> R<String> {
    Ok(match l {
        Lit::Int(i) => i.base10_digits().to_string(),
        Lit::Float(f) => f.base10_digits().to_string(),
        Lit::Bool(b) => b.value.to_string(),
        Lit::Str(s) => odin_string(&s.value()),
        Lit::Char(c) => format!("'{}'", c.value()),
        other => return Err(format!("literal {}", quote::quote!(#other))),
    })
}

/// An Odin string literal (Rust's `{:?}` writes `\u{..}` escapes, which Odin doesn't read).
pub fn odin_string(v: &str) -> String {
    let mut out = String::from("\"");
    for c in v.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\x{:02x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

impl<'a, 'b> Tx<'a, 'b> {
    /// The owner a path names: `Self::x` is the impl type, `T::x` is T, a bare `x` has none.
    /// The engine function a call names. Free functions are found by their module path (`topology::is_opponent`
    /// is the one in topology.rs), or, unqualified, in the caller's file, or as the only one of that name; anything
    /// else is ambiguous and refused. Looking them up by bare name once made `players::is_opponent`, which delegates
    /// to `topology::is_opponent`, call itself. Procedure names two functions share are refused too.
    pub fn resolve_fn(&self, owner: Option<&str>, segs: &[String], last: &str) -> Option<FnDef> {
        let defs = self.e.reg.fns.get(&(owner.map(str::to_string), last.to_string()))?;
        let f = if owner.is_some() {
            if defs.len() != 1 {
                return None;
            }
            defs[0].clone()
        } else {
            let here = CURRENT_FILE.with(|c| c.borrow().clone());
            let module = if segs.len() >= 2 { Some(segs[segs.len() - 2].as_str()) } else { None };
            let cands: Vec<&FnDef> = match module {
                None | Some("self") => {
                    let same: Vec<&FnDef> = defs.iter().filter(|d| Some(&d.file) == here.as_ref()).collect();
                    if same.is_empty() && module.is_none() && defs.len() == 1 { defs.iter().collect() } else { same }
                }
                Some("super") => {
                    let parent = here.as_deref().and_then(parent_module);
                    defs.iter().filter(|d| Some(file_module(&d.file)) == parent).collect()
                }
                Some("crate") => defs.iter().filter(|d| file_module(&d.file) == "lib").collect(),
                Some(m) => defs.iter().filter(|d| file_module(&d.file) == m).collect(),
            };
            if cands.len() != 1 {
                return None;
            }
            cands[0].clone()
        };
        let pname = proc_name_for(owner, last, &f);
        if COLLIDING.with(|c| c.borrow().contains(&pname)) {
            return None;
        }
        Some(f)
    }

    fn owner_of(&self, segs: &[String]) -> Option<String> {
        if segs.len() >= 2 {
            let o = &segs[segs.len() - 2];
            if o == "Self" { self.self_ty.clone() } else if o.chars().next()?.is_uppercase() { Some(o.clone()) } else { None }
        } else {
            None
        }
    }

    /// A named constant, translated from its value.
    fn const_value(&mut self, segs: &[String], want: &Shape) -> Option<R<String>> {
        let name = segs.last()?.clone();
        let owner = self.owner_of(segs);
        let c = self.e.reg.consts.get(&(owner.clone(), name.clone())).and_then(|v| v.first()).cloned()?;
        let shape = self.e.shape(&c.ty, &[]);
        let shape = if matches!(shape, Shape::Named(ref n, _) if n == "Self") { want.clone() } else { shape };
        let next_self = owner.or(self.self_ty.clone());
        let saved = std::mem::replace(&mut self.self_ty, next_self);
        let r = self.expr(&c.expr, &shape);
        self.self_ty = saved;
        Some(r)
    }

    /// A call to a function whose body is one expression: its parameters bound to the (translated) arguments.
    fn inline_call(&mut self, owner: Option<String>, name: &str, recv: Option<(String, Shape)>, args: &[&Expr], want: &Shape) -> Option<R<String>> {
        if self.depth > 8 {
            return Some(Err("inlining too deep".into()));
        }
        let f = self.e.reg.fns.get(&(owner.clone(), name.to_string())).and_then(|v| v.first()).cloned()?;
        let body = single_expr(&f.block)?.clone();
        let mut vars = BTreeMap::new();
        let mut arg_i = 0;
        for input in &f.sig.inputs {
            match input {
                syn::FnArg::Receiver(_) => {
                    let Some((r, sh)) = recv.clone() else { return Some(Err("method without receiver".into())) };
                    vars.insert("self".to_string(), (r, sh));
                }
                syn::FnArg::Typed(pt) => {
                    let Pat::Ident(pi) = &*pt.pat else { return Some(Err("parameter pattern".into())) };
                    let sh = self.e.shape(&pt.ty, &[]);
                    let Some(a) = args.get(arg_i) else { return Some(Err("arity".into())) };
                    arg_i += 1;
                    let v = match self.expr(a, &sh) {
                        Ok(v) => v,
                        Err(e) => return Some(Err(e)),
                    };
                    vars.insert(pi.ident.to_string(), (format!("({v})"), sh));
                }
            }
        }
        let ret = match &f.sig.output {
            syn::ReturnType::Type(_, t) => {
                let sh = self.e.shape(t, &[]);
                if matches!(sh, Shape::Named(ref n, _) if n == "Self") { want.clone() } else { sh }
            }
            syn::ReturnType::Default => Shape::Unit,
        };
        let saved_vars = std::mem::replace(&mut self.vars, vars);
        let next_self = owner.or(self.self_ty.clone());
        let saved_self = std::mem::replace(&mut self.self_ty, next_self);
        self.depth += 1;
        let r = self.expr(&body, &ret);
        self.depth -= 1;
        self.vars = saved_vars;
        self.self_ty = saved_self;
        Some(r)
    }

    fn enum_variants(&self, name: &str) -> Option<(bool, Vec<crate::model::Variant>)> {
        let def = self.e.def(name)?;
        match &def.kind {
            Kind::Enum(vs) => Some((vs.iter().all(|v| matches!(v.fields, Fields::Unit)), vs.clone())),
            _ => None,
        }
    }

    /// The enum a path's variant belongs to: `E::V`, `Self::V`, or a bare `V` read against the wanted type.
    fn variant_of(&self, segs: &[String], want: &Shape) -> Option<(String, String)> {
        let v = segs.last()?.clone();
        let e = if segs.len() >= 2 {
            let e = &segs[segs.len() - 2];
            if e == "Self" { self.self_ty.clone()? } else { e.clone() }
        } else if let Shape::Named(n, _) = want {
            n.clone()
        } else {
            return None;
        };
        let (_, vs) = self.enum_variants(&e)?;
        vs.iter().any(|x| x.name == v).then_some((e, v))
    }

    /// Whether Odin's `==` works on values of this shape: no dynamic arrays, maps or pointers inside.
    pub fn comparable_pub(&mut self, s: &Shape) -> bool {
        self.comparable(s)
    }

    fn comparable(&mut self, s: &Shape) -> bool {
        match s {
            Shape::Bool | Shape::Int(_) | Shape::Float(_) | Shape::Str | Shape::Char | Shape::Unit => true,
            Shape::Option(i) => self.comparable(i),
            Shape::Named(n, _) => {
                let Some(def) = self.e.def(n).cloned() else { return false };
                let mut tys = Vec::new();
                match &def.kind {
                    Kind::Struct(Fields::Named(fs) | Fields::Tuple(fs)) => tys.extend(fs.iter().map(|f| f.ty.clone())),
                    Kind::Struct(Fields::Unit) => {}
                    Kind::Enum(vs) => {
                        for v in vs {
                            if let Fields::Named(fs) | Fields::Tuple(fs) = &v.fields {
                                tys.extend(fs.iter().map(|f| f.ty.clone()));
                            }
                        }
                    }
                }
                tys.iter().all(|t| {
                    let sh = self.e.shape(t, &[]);
                    !matches!(sh, Shape::Named(ref m, _) if m == n) && self.comparable(&sh)
                })
            }
            _ => false,
        }
    }

    fn named_fields(&self, ty: &str, variant: Option<&str>) -> Option<Fields> {
        // A monomorphized generic (DisplayOnly_ptr_CardPrinting) has its base type's fields.
        let ty = self.e.instances.get(ty).map(|(b, _)| b.as_str()).unwrap_or(ty);
        let def = self.e.def(ty)?;
        match (&def.kind, variant) {
            (Kind::Struct(f), None) => Some(f.clone()),
            (Kind::Enum(vs), Some(v)) => vs.iter().find(|x| x.name == v).map(|x| x.fields.clone()),
            _ => None,
        }
    }

    fn field_shape(&mut self, fields: &Fields, name: &str, ty_params: &[String]) -> Option<Shape> {
        if let Fields::Named(fs) = fields {
            let f = fs.iter().find(|f| f.name.as_deref() == Some(name))?;
            return Some(self.e.shape(&f.ty, ty_params));
        }
        None
    }

    fn tuple_shapes(&mut self, fields: &Fields) -> Vec<Shape> {
        match fields {
            Fields::Tuple(fs) => fs.iter().map(|f| self.e.shape(&f.ty, &[])).collect(),
            _ => vec![],
        }
    }

    /// An expression in value position, given the type it must have.
    /// An expression as an Odin value of the wanted shape: translated, then adapted where Rust converts silently
    /// (a `Box`/`Arc` read as its contents; a place handed out as `&mut`).
    pub fn expr(&mut self, ex: &Expr, want: &Shape) -> R<String> {
        if !self.calls {
            return self.expr_raw(ex, want);
        }
        match want {
            // A `&mut` result from a value place (`self` in a `-> &mut Self` builder, `self.field`).
            Shape::MutRef(inner) if !matches!(ex, Expr::Reference(_)) => {
                let actual = self.shape_of(ex);
                if matches!(actual, Some(Shape::MutRef(_))) || actual.is_none() {
                    return self.expr_raw(ex, want);
                }
                let v = self.expr_raw(ex, inner)?;
                return Ok(match v.strip_suffix('^') {
                    Some(p) if !p.contains(['.', '[', '(']) => p.to_string(),
                    _ => format!("&{v}"),
                });
            }
            Shape::Ptr(..) | Shape::OptPtr(..) | Shape::Option(_) | Shape::Unit => self.expr_raw(ex, want),
            _ => {
                // A Box/Arc where its contents are wanted: dereferenced.
                if let Some(Shape::Ptr(inner, _)) = self.shape_of(ex) {
                    if *inner == *want {
                        let v = self.expr_raw(ex, &Shape::Ptr(inner.clone(), false))?;
                        return Ok(format!("{v}^"));
                    }
                }
                self.expr_raw(ex, want)
            }
        }
    }

    fn expr_raw(&mut self, ex: &Expr, want: &Shape) -> R<String> {
        match ex {
            Expr::Lit(l) => lit(&l.lit),
            Expr::Field(fe) => {
                let mut base_shape = self.shape_of(&fe.base).ok_or("field of an unknown value")?;
                let mut base = self.expr(&fe.base, &base_shape)?;
                if let Shape::Ptr(inner, _) | Shape::MutRef(inner) = base_shape.clone() {
                    base = format!("{base}^");
                    base_shape = *inner;
                }
                let Shape::Named(tn, _) = &base_shape else { return Err("field of a non-struct".into()) };
                match &fe.member {
                    syn::Member::Named(id) => {
                        // A field the Rust engine never serializes: the vector check can't see what such code reads or
                        // writes, so a pass there proves less (noted per procedure).
                        if let Some(Fields::Named(fs)) = self.named_fields(tn, None) {
                            if fs.iter().any(|f| f.name.as_deref() == Some(&id.to_string()) && (f.serde.skip || f.serde.skip_serializing)) {
                                TOUCHES_UNLOGGED.with(|t| t.set(true));
                            }
                        }
                        Ok(format!("{base}.{}", field_ident(&id.to_string())))
                    }
                    // A newtype's only field: the Odin type is `distinct` of it, so the value itself.
                    syn::Member::Unnamed(i) if i.index == 0 => match self.named_fields(tn, None) {
                        Some(Fields::Tuple(fs)) if fs.len() == 1 => {
                            // A monomorphized generic: its parameters stand for the instance's arguments.
                            let saved = self.e.subst.clone();
                            if let Some((base, args)) = self.e.instances.get(tn).cloned() {
                                if let Some(d) = self.e.def(&base) {
                                    self.e.subst = d.generics.iter().cloned().zip(args).collect();
                                }
                            }
                            let inner = self.e.shape(&fs[0].ty, &[]);
                            self.e.subst = saved;
                            Ok(format!("(cast({})({base}))", self.e.odin(&inner)))
                        }
                        _ => Ok(format!("{base}._0")),
                    },
                    _ => Err("tuple field".into()),
                }
            }
            Expr::Paren(p) => self.expr(&p.expr, want),
            // `()`: the unit value.
            Expr::Tuple(t) if t.elems.is_empty() => Ok("Unit{}".into()),
            // `x?`: a temporary, an early return of the error (or None), and the value.
            Expr::Try(t) if self.calls => {
                let sh = self.shape_of(&t.expr).ok_or("? on an untyped value")?;
                let v = self.expr(&t.expr, &sh)?;
                self.temps += 1;
                let tmp = format!("t{}_", self.temps);
                // Inside an inlined closure, `?` leaves the closure: its result becomes None/Err and its block ends.
                if let Some((label, res, rshape)) = TRY_EXIT.with(|t| t.borrow().clone()) {
                    return match (&sh, &rshape) {
                        (Shape::Result(_, _), Shape::Result(..)) => {
                            let rty = self.e.odin(&rshape);
                            self.pre.push(format!("{tmp} := {v}"));
                            self.pre.push(format!("if e_, failed := {tmp}.err.?; failed {{ {res} = {rty}{{err = e_}}; break {label} }}"));
                            Ok(format!("{tmp}.ok"))
                        }
                        (Shape::Option(_), Shape::Option(_)) => {
                            self.pre.push(format!("{tmp} := {v}"));
                            self.pre.push(format!("if {tmp} == nil {{ {res} = nil; break {label} }}"));
                            Ok(format!("{tmp}.?"))
                        }
                        // A dry run (the closure's result shape still unknown): the value only.
                        (Shape::Option(_), Shape::Unknown(_)) => {
                            self.pre.push(format!("{tmp} := {v}"));
                            Ok(format!("{tmp}.?"))
                        }
                        (Shape::Result(_, _), Shape::Unknown(_)) => {
                            self.pre.push(format!("{tmp} := {v}"));
                            Ok(format!("{tmp}.ok"))
                        }
                        _ => Err("? between different kinds in a closure".into()),
                    };
                }
                match (&sh, self.fn_ret.clone()) {
                    (Shape::Result(_, _), Shape::Result(..)) => {
                        let ret_ty = self.e.odin(&self.fn_ret.clone());
                        self.pre.push(format!("{tmp} := {v}"));
                        self.pre.push(format!("if e_, failed := {tmp}.err.?; failed do return {ret_ty}{{err = e_}}"));
                        Ok(format!("{tmp}.ok"))
                    }
                    (Shape::Option(_), Shape::Option(_)) => {
                        self.pre.push(format!("{tmp} := {v}"));
                        self.pre.push(format!("if {tmp} == nil do return nil"));
                        Ok(format!("{tmp}.?"))
                    }
                    _ => Err("? between different kinds".into()),
                }
            }
            Expr::Group(g) => self.expr(&g.expr, want),
            // `&mut place` where a pointer is wanted (a function returning `&mut T`): the place's address.
            Expr::Reference(r) if matches!(want, Shape::MutRef(_)) => {
                let Shape::MutRef(inner) = want else { unreachable!() };
                if let Some(Shape::MutRef(_)) = self.shape_of(&r.expr) {
                    return self.expr(&r.expr, want);
                }
                let v = self.expr(&r.expr, inner)?;
                // A `&mut` parameter or binding is used as `p^`: its address is `p`.
                Ok(match v.strip_suffix('^') {
                    Some(p) if !p.contains(['.', '[', '(']) => p.to_string(),
                    _ => format!("&{v}"),
                })
            }
            Expr::Reference(r) => self.expr(&r.expr, want),
            Expr::Block(b) if b.block.stmts.len() == 1 => match &b.block.stmts[0] {
                Stmt::Expr(e, None) => self.expr(e, want),
                _ => Err("block".into()),
            },
            Expr::Unary(u) => {
                let inner = self.expr(&u.expr, want)?;
                Ok(match u.op {
                    UnOp::Deref(_) => inner,
                    // `!` on an integer is bitwise in Rust.
                    UnOp::Not(_) if matches!(self.shape_of(&u.expr).unwrap_or_else(|| want.clone()), Shape::Int(_)) => format!("~{inner}"),
                    UnOp::Not(_) => format!("!{inner}"),
                    UnOp::Neg(_) => format!("-{inner}"),
                    _ => return Err("unary".into()),
                })
            }
            Expr::Path(p) => {
                let segs = path_segs(&p.path);
                if segs.len() == 1 {
                    if let Some((odin, _)) = self.vars.get(&segs[0]) {
                        return Ok(odin.clone());
                    }
                    if segs[0] == "None" {
                        return Ok("nil".into());
                    }
                }
                let target = match want {
                    Shape::Ptr(i, _) | Shape::OptPtr(i, _) | Shape::Option(i) => (**i).clone(),
                    s => s.clone(),
                };
                if let Some((e, v)) = self.variant_of(&segs, &target) {
                    let (unit, _) = self.enum_variants(&e).unwrap();
                    let val = if unit { format!("{e}.{v}") } else { format!("{e}_{v}{{}}") };
                    return Ok(match want {
                        Shape::Ptr(_, _) | Shape::OptPtr(_, _) => format!("new_clone({e}({val}))"),
                        _ => val,
                    });
                }
                if let Some(v) = self.const_value(&segs, want) {
                    return v;
                }
                // u64::MAX and friends.
                if segs.len() == 2 && matches!(segs[1].as_str(), "MAX" | "MIN")
                    && matches!(segs[0].as_str(), "u8" | "u16" | "u32" | "u64" | "usize" | "i8" | "i16" | "i32" | "i64" | "isize")
                {
                    let t = match segs[0].as_str() { "usize" | "isize" => "int", t => t };
                    return Ok(format!("{}({t})", segs[1].to_lowercase()));
                }
                Err(format!("path {}", segs.join("::")))
            }
            Expr::Call(c) => {
                let Expr::Path(fp) = &*c.func else { return Err("call target".into()) };
                let segs = path_segs(&fp.path);
                let last = segs.last().cloned().unwrap_or_default();
                let args: Vec<&Expr> = c.args.iter().collect();
                // A call of a closure in scope (a local one, or an instance's closure parameter): its body, inlined.
                if self.calls && segs.len() == 1 && !self.vars.contains_key(&segs[0]) {
                    if let Some(info) = crate::closures::lookup(&segs[0]) {
                        return self.inline_closure(&info, &args, want);
                    }
                }
                match (segs.as_slice(), last.as_str()) {
                    (_, "Ok" | "Err") if args.len() == 1 && self.calls => {
                        let Shape::Result(t, er) = want else { return Err("Ok/Err without a Result type".into()) };
                        let ty = self.e.odin(want);
                        return Ok(if last == "Ok" {
                            let v = self.expr(args[0], t)?;
                            format!("{ty}{{ok = {v}}}")
                        } else {
                            // `err` is a Maybe: an untyped `{}`/`nil` there would read as "no error".
                            let v = self.expr(args[0], er)?;
                            let v = self.typed_value(&v, er);
                            format!("{ty}{{err = {v}}}")
                        });
                    }
                    (_, "Some") if args.len() == 1 => {
                        let inner = match want {
                            Shape::Option(i) => (**i).clone(),
                            Shape::OptPtr(i, sh) => Shape::Ptr(i.clone(), *sh),
                            s => s.clone(),
                        };
                        let v = self.expr(args[0], &inner)?;
                        // `Some(Vec::new())` is `{}` and `Some(None)` is `nil`: untyped, they'd take the Maybe's own
                        // type and become None. Typed, they're a present value.
                        return Ok(if matches!(want, Shape::Option(_)) {
                            format!("{}({})", self.e.odin(want), self.typed_value(&v, &inner))
                        } else {
                            v
                        });
                    }
                    (_, "new") if segs.len() == 2 && matches!(segs[0].as_str(), "Box" | "Arc" | "Rc") => {
                        let inner = match want {
                            Shape::Ptr(i, _) | Shape::OptPtr(i, _) => (**i).clone(),
                            s => s.clone(),
                        };
                        let v = self.expr(args[0], &inner)?;
                        return Ok(format!("new_clone({}({v}))", self.e.odin(&inner)));
                    }
                    // Empty standard collections and Default::default(): Odin's zero value.
                    (_, "new" | "with_capacity" | "default")
                        if segs.len() == 2
                            && matches!(segs[0].as_str(), "Vec" | "VecDeque" | "SmallVec" | "HashMap" | "HashSet"
                                | "BTreeMap" | "BTreeSet" | "IndexMap" | "IndexSet" | "String" | "Default" | "Vector") =>
                    {
                        return Ok("{}".into())
                    }
                    _ => {}
                }
                let target = match want {
                    Shape::Ptr(i, _) | Shape::OptPtr(i, _) | Shape::Option(i) => (**i).clone(),
                    s => s.clone(),
                };
                if let Some((e, v)) = self.variant_of(&segs, &target) {
                    let fields = self.named_fields(&e, Some(&v)).unwrap();
                    let shapes = self.tuple_shapes(&fields);
                    let mut parts = Vec::new();
                    for (i, a) in args.iter().enumerate() {
                        let s = shapes.get(i).cloned().ok_or("tuple variant arity")?;
                        parts.push(format!("_{i} = {}", self.expr(a, &s)?));
                    }
                    let val = format!("{e}_{v}{{{}}}", parts.join(", "));
                    return Ok(match want {
                        Shape::Ptr(_, _) | Shape::OptPtr(_, _) => format!("new_clone({e}({val}))"),
                        _ => val,
                    });
                }
                // A newtype struct: `ObjectId(5)`.
                if segs.len() == 1 && args.len() == 1 {
                    if let Some(Fields::Tuple(fs)) = self.named_fields(&last, None) {
                        if fs.len() == 1 {
                            let s = self.e.shape(&fs[0].ty, &[]);
                            return Ok(format!("{last}({})", self.expr(args[0], &s)?));
                        }
                    }
                }
                // `T::default()` / `Default::default()`: Rust's Default for the wanted type.
                if last == "default" && args.is_empty() {
                    // A generic parameter (`T::default()` in `is_default<T>`) is the wanted type.
                    let target = if segs.len() == 2 && segs[0] != "Default" && segs[0] != "Self" && self.e.reg.types.contains_key(&segs[0]) {
                        Shape::Named(segs[0].clone(), vec![])
                    } else {
                        want.clone()
                    };
                    return Ok(match self.e.default_expr(&target) {
                        Some(d) => d,
                        // A pointer's default (`Arc::default()`) is an allocation, not a literal.
                        None if matches!(target, Shape::Ptr(..)) => return Err("default of a shared or boxed value".into()),
                        None => format!("{}{{}}", self.e.odin(&target)),
                    });
                }
                // `Self(x)`: the impl type's newtype constructor.
                if segs.len() == 1 && last == "Self" && args.len() == 1 {
                    if let Some(st) = self.self_ty.clone() {
                        if let Some(Fields::Tuple(fs)) = self.named_fields(&st, None) {
                            if fs.len() == 1 {
                                let sh = self.e.shape(&fs[0].ty, &[]);
                                return Ok(format!("{st}({})", self.expr(args[0], &sh)?));
                            }
                        }
                    }
                }
                let owner = self.owner_of(&segs);
                if self.calls {
                    if let Some(f) = self.resolve_fn(owner.as_deref(), &segs, &last) {
                        return self.call_with_sig(&proc_name_for(owner.as_deref(), &last, &f), &f, None, &args);
                    }
                    return Err(format!("call {}", segs.join("::")));
                }
                if let Some(v) = self.inline_call(owner, &last, None, &args, want) {
                    return v;
                }
                Err(format!("call {}", segs.join("::")))
            }
            Expr::Struct(st) => {
                let segs = path_segs(&st.path);
                let target = match want {
                    Shape::Ptr(i, _) | Shape::OptPtr(i, _) | Shape::Option(i) => (**i).clone(),
                    s => s.clone(),
                };
                let (odin_ty, fields) = if let Some((e, v)) = self.variant_of(&segs, &target) {
                    (format!("{e}_{v}"), self.named_fields(&e, Some(&v)).unwrap())
                } else {
                    let n = if segs.last().map(|s| s == "Self").unwrap_or(false) {
                        self.self_ty.clone().ok_or("Self")?
                    } else {
                        segs.last().cloned().unwrap()
                    };
                    let f = self.named_fields(&n, None).ok_or(format!("struct {n}"))?;
                    (n, f)
                };
                if let Some(rest) = &st.rest {
                    // `..Default::default()`: the other fields keep Odin's zero values, which match derived Default.
                    let ok = matches!(&**rest, Expr::Call(c) if matches!(&*c.func, Expr::Path(p) if path_segs(&p.path).last().map(|s| s == "default").unwrap_or(false)));
                    if !ok {
                        return Err("struct update syntax".into());
                    }
                }
                let mut parts = Vec::new();
                for fv in &st.fields {
                    let syn::Member::Named(id) = &fv.member else { return Err("unnamed member".into()) };
                    let name = id.to_string();
                    let s = self.field_shape(&fields, &name, &[]).ok_or(format!("field {name}"))?;
                    parts.push(format!("{} = {}", field_ident(&name), self.expr(&fv.expr, &s)?));
                }
                let val = format!("{odin_ty}{{{}}}", parts.join(", "));
                Ok(match want {
                    Shape::Ptr(i, _) | Shape::OptPtr(i, _) => format!("new_clone({}({val}))", self.e.odin(i)),
                    _ => val,
                })
            }
            Expr::Macro(m) if m.mac.path.is_ident("matches") && self.calls => {
                let mac: MatchesArgs = m.mac.parse_body().map_err(|e| e.to_string())?;
                self.matches_general(&mac)
            }
            Expr::Macro(m) if m.mac.path.is_ident("matches") => {
                let mac: MatchesArgs = m.mac.parse_body().map_err(|e| e.to_string())?;
                if mac.guard.is_some() {
                    return Err("matches! with a guard".into());
                }
                let sh = self.shape_of(&mac.subject).ok_or("matches! subject")?;
                let subj = self.expr(&mac.subject, &sh)?;
                let alts: Vec<&Pat> = match &mac.pat {
                    Pat::Or(o) => o.cases.iter().collect(),
                    p => vec![p],
                };
                let mut conds = Vec::new();
                for p in alts {
                    let segs = pat_path(p).ok_or("pattern")?;
                    let (e, v) = self.variant_of(&segs, &sh).ok_or("pattern variant")?;
                    let unit_enum = self.enum_variants(&e).map(|x| x.0).unwrap_or(false);
                    let has_field_conds = match p {
                        Pat::Struct(ps) => ps.fields.iter().any(|f| !matches!(*f.pat, Pat::Wild(_))),
                        Pat::TupleStruct(ts) => ts.elems.iter().any(|e| !matches!(e, Pat::Wild(_) | Pat::Rest(_))),
                        _ => false,
                    };
                    if has_field_conds {
                        return Err("matches! with field conditions in an expression".into());
                    }
                    conds.push(if unit_enum { format!("{subj} == {e}.{v}") } else { format!("is_variant({subj}, {e}_{v})") });
                }
                Ok(format!("({})", conds.join(" || ")))
            }
            Expr::Macro(m) if m.mac.path.is_ident("vec") => {
                let Shape::Vec(elem) = want else { return Err("vec! for a non-vector".into()) };
                let items: syn::punctuated::Punctuated<Expr, syn::Token![,]> =
                    m.mac.parse_body_with(syn::punctuated::Punctuated::parse_terminated).map_err(|e| e.to_string())?;
                if items.is_empty() {
                    return Ok("{}".into());
                }
                let mut parts = Vec::new();
                for it in &items {
                    parts.push(self.expr(it, elem)?);
                }
                Ok(format!("dynamic_from([]{}{{{}}})", self.e.odin(elem), parts.join(", ")))
            }
            Expr::Binary(b) => {
                let op = match b.op {
                    BinOp::Eq(_) => "==",
                    BinOp::Ne(_) => "!=",
                    BinOp::Lt(_) => "<",
                    BinOp::Le(_) => "<=",
                    BinOp::Gt(_) => ">",
                    BinOp::Ge(_) => ">=",
                    BinOp::And(_) => "&&",
                    BinOp::Or(_) => "||",
                    // Arithmetic and bit operators on integers: Odin wraps on overflow where Rust's release build
                    // does too; division by zero traps in both.
                    BinOp::Add(_) | BinOp::Sub(_) | BinOp::Mul(_) | BinOp::Div(_) | BinOp::Rem(_) | BinOp::BitAnd(_)
                    | BinOp::BitOr(_) | BinOp::BitXor(_) | BinOp::Shl(_) | BinOp::Shr(_)
                        if self.calls =>
                    {
                        let sym = match b.op {
                            BinOp::Add(_) => "+",
                            BinOp::Sub(_) => "-",
                            BinOp::Mul(_) => "*",
                            BinOp::Div(_) => "/",
                            BinOp::Rem(_) => "%",
                            BinOp::BitAnd(_) => "&",
                            BinOp::BitOr(_) => "|",
                            BinOp::BitXor(_) => "~",
                            BinOp::Shl(_) => "<<",
                            _ => ">>",
                        };
                        let ls = self.shape_of(&b.left).or_else(|| self.shape_of(&b.right)).unwrap_or_else(|| want.clone());
                        if !matches!(ls, Shape::Int(_) | Shape::Float(_)) && !matches!(&ls, Shape::Named(n, _) if self.is_distinct_number(n)) {
                            return Err("arithmetic on a non-number".into());
                        }
                        let l = self.expr(&b.left, &ls)?;
                        let rs = if matches!(sym, "<<" | ">>") { self.shape_of(&b.right).unwrap_or(Shape::Int("u32")) } else { ls.clone() };
                        let r = self.expr(&b.right, &rs)?;
                        return Ok(format!("({l} {sym} {r})"));
                    }
                    _ => return Err("binary operator".into()),
                };
                // Comparisons take the left side's type for the right (literals, variants).
                let left_shape = self.shape_of(&b.left).unwrap_or(Shape::Bool);
                let l = self.expr(&b.left, &left_shape)?;
                let outer = std::mem::take(&mut self.pre);
                let r = self.expr(&b.right, &left_shape);
                let inner = std::mem::replace(&mut self.pre, outer);
                let r = r?;
                // `a && b` evaluates b only when a holds (`a || b` only when it doesn't): statements b needs go
                // inside an `if` on a's value.
                if matches!(op, "&&" | "||") && !inner.is_empty() {
                    let n = self.next_temp();
                    let t = format!("sc{n}_");
                    let cond = if op == "&&" { t.clone() } else { format!("!{t}") };
                    self.pre.push(format!("{t} := {l}"));
                    self.pre.push(format!("if {cond} {{\n{}\n{t} = {r}\n}}", inner.join("\n")));
                    return Ok(t);
                }
                self.pre.extend(inner);
                if matches!(op, "==" | "!=") {
                    if let Shape::Named(n, _) = &left_shape {
                        if !self.enum_variants(n).map(|x| x.0).unwrap_or(true) {
                            // Comparing a data enum with one of its unit variants: a variant test.
                            let segs = match &*b.right {
                                Expr::Path(p) => path_segs(&p.path),
                                _ => vec![],
                            };
                            // Against a unit variant: a variant test; against another value: equality below.
                            if let Some((e, v)) = self.variant_of(&segs, &left_shape).filter(|_| !segs.is_empty() && !(segs.len() == 1 && self.vars.contains_key(&segs[0]))) {
                            if !matches!(self.named_fields(&e, Some(&v)), Some(Fields::Unit)) {
                                return Err("== with a data-carrying variant".into());
                            }
                            let neg = if op == "!=" { "!" } else { "" };
                            return Ok(format!("{neg}is_variant({l}, {e}_{v})"));
                            }
                        }
                    }
                }
                if matches!(op, "==" | "!=") && !self.comparable(&left_shape) {
                    // Rust's derived PartialEq, generated (emit.rs, equaler).
                    if !self.calls {
                        return Err("== on a type Odin can't compare".into());
                    }
                    let p = self.e.equaler(&left_shape)?.ok_or("== on a type Odin can't compare")?;
                    let neg = if op == "!=" { "!" } else { "" };
                    return Ok(format!("{neg}{p}({l}, {r})"));
                }
                Ok(format!("({l} {op} {r})"))
            }
            Expr::MethodCall(mc) if self.calls && self.chain_terminal(mc) => self.chain(mc, want),
            // An iterator where a Vec is wanted (a function returning `impl Iterator`): the chain, collected.
            Expr::MethodCall(mc)
                if self.calls
                    && matches!(want, Shape::Vec(_))
                    && matches!(mc.method.to_string().as_str(), "filter" | "map" | "filter_map" | "iter" | "into_iter" | "copied" | "cloned")
                    && self.chain_source(ex).is_some()
                    && !matches!(self.shape_of(ex), Some(Shape::Vec(_))) =>
            {
                let collected: syn::ExprMethodCall = syn::parse_quote!(#ex.collect());
                self.chain(&collected, want)
            }
            Expr::MethodCall(mc) => {
                if self.calls {
                    if let Some(r) = self.library_method(mc) {
                        return r;
                    }
                }
                let recv_shape = self.shape_of(&mc.receiver).unwrap_or(Shape::Bool);
                let recv = self.expr(&mc.receiver, &recv_shape)?;
                match mc.method.to_string().as_str() {
                    "is_empty" if matches!(recv_shape, Shape::Vec(_) | Shape::Map(..) | Shape::Str) => Ok(format!("(len({recv}) == 0)")),
                    "is_empty" if matches!(recv_shape, Shape::PVec(_)) => Ok(format!("({recv}.len == 0)")),
                    // A shared collection (`Arc<Vec<T>>`, an `im` collection): nil is the empty one.
                    "is_empty" if matches!(&recv_shape, Shape::Ptr(i, _) if matches!(**i, Shape::Vec(_) | Shape::Map(..))) => {
                        Ok(format!("({recv} == nil || len({recv}^) == 0)"))
                    }
                    "is_none" => Ok(format!("({recv} == nil)")),
                    "is_some" => Ok(format!("({recv} != nil)")),
                    "clone" if self.calls => Ok(match self.e.cloner(&recv_shape) {
                        Some(c) => format!("{c}({recv})"),
                        None => recv,
                    }),
                    // In whole-function translation a conversion is the value itself only between equal types
                    // (`String::to_owned`, `x.into()` to its own type); others (`IntoStaticStr`, Display) differ.
                    "into" | "to_owned" | "to_string" if self.calls => {
                        if &recv_shape == want || (matches!(recv_shape, Shape::Str) && matches!(want, Shape::Str)) {
                            Ok(recv)
                        } else {
                            Err(format!("conversion .{}()", mc.method))
                        }
                    }
                    "clone" | "into" | "to_owned" | "to_string" => Ok(recv),
                    m => {
                        let (owner, recv) = match &recv_shape {
                            Shape::Named(n, _) => (Some(n.clone()), recv),
                            Shape::Ptr(i, _) | Shape::MutRef(i) => match &**i {
                                Shape::Named(n, _) => (Some(n.clone()), format!("{recv}^")),
                                _ => (None, recv),
                            },
                            _ => (None, recv),
                        };
                        let args: Vec<&Expr> = mc.args.iter().collect();
                        if self.calls {
                            if let Some(o) = owner.as_ref() {
                                if let Some(f) = self.resolve_fn(Some(o), &[], m) {
                                    return self.call_with_sig(&proc_name_for(Some(o), m, &f), &f, Some(recv), &args);
                                }
                            }
                            return Err(format!("method .{m}() on {}", crate::body::shape_kind(&recv_shape)));
                        }
                        match owner.and_then(|o| self.inline_call(Some(o), m, Some((recv.clone(), recv_shape.clone())), &args, want)) {
                            Some(v) => v,
                            None => Err(format!("method {m}")),
                        }
                    }
                }
            }
            other => Err(format!("expression {}", quote::quote!(#other).to_string().chars().take(60).collect::<String>())),
        }
    }

    /// The shape of a variable reference (parameters and `self`), for comparisons.
    fn shape_of(&mut self, ex: &Expr) -> Option<Shape> {
        match ex {
            Expr::Path(p) if p.path.segments.len() == 1 => match self.vars.get(&p.path.segments[0].ident.to_string()).map(|v| v.1.clone()) {
                // A pending local: its shape once a use has fixed it.
                Some(Shape::Unknown(u)) if u.starts_with(PENDING_TAG) => PENDING.with(|m| m.borrow().get(&u[PENDING_TAG.len()..]).and_then(|e| e.1.clone())),
                other => other,
            },
            Expr::Unary(u) => self.shape_of(&u.expr),
            Expr::Reference(r) => self.shape_of(&r.expr),
            Expr::Paren(p) => self.shape_of(&p.expr),
            Expr::Field(fe) => {
                let base = match self.shape_of(&fe.base)? {
                    Shape::Ptr(inner, _) | Shape::MutRef(inner) => *inner,
                    s => s,
                };
                let Shape::Named(tn, _) = base else { return None };
                let fields = self.named_fields(&tn, None)?;
                match (&fe.member, &fields) {
                    (syn::Member::Named(id), Fields::Named(fs)) => {
                        let f = fs.iter().find(|f| f.name.as_deref() == Some(&id.to_string()))?;
                        Some(self.e.shape(&f.ty, &[]))
                    }
                    (syn::Member::Unnamed(i), Fields::Tuple(fs)) => fs.get(i.index as usize).map(|f| self.e.shape(&f.ty, &[])),
                    _ => None,
                }
            }
            Expr::MethodCall(mc) if self.calls => {
                let m = mc.method.to_string();
                let Some(recv) = self.shape_of(&mc.receiver) else {
                    // An untyped receiver (an iterator chain): methods whose result doesn't depend on it.
                    let n_args = mc.args.len();
                    return match m.as_str() {
                        // Terminals of a chain: their result follows from the chain's item.
                        "collect" if n_args == 0 => self.chain_item_shape(&mc.receiver).map(|i| Shape::Vec(Box::new(i))),
                        "find" | "next" | "last" | "max_by_key" | "min_by_key" | "max_by" | "min_by" | "max" | "min" => {
                            self.chain_item_shape(&mc.receiver).map(|i| Shape::Option(Box::new(i)))
                        }
                        "find_map" if n_args == 1 => {
                            let item = self.chain_item_shape(&mc.receiver)?;
                            let c = Self::closure_of(&mc.args[0]).ok()?;
                            self.closure_shape(&c, "_", &item).filter(|s| matches!(s, Shape::Option(_)))
                        }
                        "len" | "count" => Some(Shape::Int("int")),
                        "is_empty" | "is_some" | "is_none" | "contains" | "contains_key" | "any" | "all" | "is_some_and"
                        | "is_none_or" => Some(Shape::Bool),
                        "position" => Some(Shape::Option(Box::new(Shape::Int("int")))),
                        _ => None,
                    };
                };
                let recv = match recv {
                    Shape::Ptr(inner, _) | Shape::MutRef(inner) => *inner,
                    s => s,
                };
                let args: Vec<&Expr> = mc.args.iter().collect();
                // Combinators: the result follows from the receiver and the closure.
                if m == "collect" && args.is_empty() {
                    if let Some(item) = self.chain_item_shape(&mc.receiver) {
                        return Some(Shape::Vec(Box::new(item)));
                    }
                }
                // Terminals giving one item of the chain.
                if matches!(m.as_str(), "find" | "next" | "last" | "max_by_key" | "min_by_key" | "max_by" | "min_by") {
                    if let Some(item) = self.chain_item_shape(&mc.receiver) {
                        return Some(Shape::Option(Box::new(item)));
                    }
                }
                if m == "find_map" && args.len() == 1 {
                    if let (Some(item), Ok(c)) = (self.chain_item_shape(&mc.receiver), Self::closure_of(args[0])) {
                        return self.closure_shape(&c, "_", &item).filter(|s| matches!(s, Shape::Option(_)));
                    }
                }
                if matches!(m.as_str(), "iter_all" | "iter_unchecked" | "as_slice") && args.is_empty() {
                    let named = match &recv {
                        Shape::Ptr(i, _) => (**i).clone(),
                        s => s.clone(),
                    };
                    if let Shape::Named(n, _) = &named {
                        if let Some(item) = self.definitions_item(n) {
                            return Some(Shape::Vec(Box::new(item)));
                        }
                    }
                }
                match (m.as_str(), &recv, args.len()) {
                    ("map", Shape::Option(i), 1) => {
                        let c = Self::closure_of(args[0]).ok()?;
                        return self.closure_shape(&c, "_", i).map(|s| Shape::Option(Box::new(s)));
                    }
                    ("and_then", Shape::Option(i), 1) => {
                        let c = Self::closure_of(args[0]).ok()?;
                        return self.closure_shape(&c, "_", i).filter(|s| matches!(s, Shape::Option(_)));
                    }
                    ("filter" | "or" | "or_else" | "take" | "xor", Shape::Option(_), _) => return Some(recv.clone()),
                    ("map_or", Shape::Option(i), 2) => {
                        return self.shape_of(args[0]).or_else(|| Self::closure_of(args[1]).ok().and_then(|c| self.closure_shape(&c, "_", i)));
                    }
                    ("ok_or", Shape::Option(i), 1) => return Some(Shape::Result(i.clone(), Box::new(self.shape_of(args[0])?))),
                    ("ok_or_else", Shape::Option(i), 1) => {
                        let Expr::Closure(c) = args[0] else { return None };
                        let err = if c.inputs.is_empty() { self.shape_of(&c.body)? } else { return None };
                        return Some(Shape::Result(i.clone(), Box::new(err)));
                    }
                    ("map_err", Shape::Result(v, e), 1) => {
                        let c = Self::closure_of(args[0]).ok()?;
                        return Some(Shape::Result(v.clone(), Box::new(self.closure_shape(&c, "_", e)?)));
                    }
                    ("ok", Shape::Result(v, _), 0) => return Some(Shape::Option(v.clone())),
                    ("unwrap" | "expect", Shape::Result(v, _), _) => return Some((**v).clone()),
                    ("is_ok" | "is_err", Shape::Result(..), 0) => return Some(Shape::Bool),
                    ("min" | "max" | "saturating_sub" | "saturating_add" | "abs" | "clamp", Shape::Int(_), _) => return Some(recv.clone()),
                    ("to_vec" | "as_slice" | "as_mut_slice" | "iter" | "into_iter", Shape::Vec(_), 0) => return Some(recv.clone()),
                    ("then_some", Shape::Bool, 1) => return Some(Shape::Option(Box::new(self.shape_of(args[0])?))),
                    ("then", Shape::Bool, 1) => {
                        let Expr::Closure(c) = args[0] else { return None };
                        return Some(Shape::Option(Box::new(self.shape_of(&c.body)?)));
                    }
                    ("as_deref" | "as_ref", Shape::OptPtr(..), 0) => return Some(recv.clone()),
                    ("get", Shape::Map(_, v), 1) => return Some(Shape::Option(v.clone())),
                    ("get_mut", Shape::Vec(i), 1) | ("first_mut" | "last_mut", Shape::Vec(i), 0) => {
                        return Some(Shape::Option(Box::new(Shape::MutRef(i.clone()))))
                    }
                    ("insert", Shape::Map(_, v), 2) => return Some(Shape::Option(v.clone())),
                    ("insert", Shape::Vec(_), 1) => return Some(Shape::Bool),
                    ("remove", Shape::Map(_, v), 1) => return Some(Shape::Option(v.clone())),
                    ("or_else", Shape::Option(_), 1) => return Some(recv.clone()),
                    ("remove", Shape::Vec(i), 1) => return Some((**i).clone()),
                    ("pop", Shape::Vec(i), 0) => return Some(Shape::Option(i.clone())),
                    _ => {}
                }
                // Library methods whose result shape follows from the receiver's.
                match (m.as_str(), &recv) {
                    ("len", _) | ("count", _) => return Some(Shape::Int("int")),
                    ("is_empty" | "is_some" | "is_none" | "contains" | "contains_key" | "starts_with" | "ends_with"
                        | "is_some_and" | "is_none_or" | "any" | "all" | "eq_ignore_ascii_case", _) => return Some(Shape::Bool),
                    ("clone" | "to_owned", _) => return Some(recv.clone()),
                    ("to_string" | "to_lowercase" | "to_uppercase" | "trim" | "as_str", _) => return Some(Shape::Str),
                    ("first" | "last" | "get", Shape::Vec(i) | Shape::PVec(i)) => return Some(Shape::Option(i.clone())),
                    ("unwrap" | "expect" | "unwrap_or_default" | "unwrap_or" | "unwrap_or_else", Shape::Option(i)) => return Some((**i).clone()),
                    ("copied" | "cloned" | "as_ref" | "as_deref", Shape::Option(_)) => return Some(recv.clone()),
                    _ => {}
                }
                let Shape::Named(o, _) = recv else { return None };
                let f = self.resolve_fn(Some(&o), &[], &mc.method.to_string())?;
                self.return_shape(&f, Some(&o))
            }
            Expr::Call(c) if self.calls => {
                let Expr::Path(fp) = &*c.func else { return None };
                let segs = path_segs(&fp.path);
                let last = segs.last()?.clone();
                if last == "Some" && c.args.len() == 1 {
                    return Some(Shape::Option(Box::new(self.shape_of(&c.args[0])?)));
                }
                if segs.len() == 1 && !self.vars.contains_key(&segs[0]) {
                    if let Some(info) = crate::closures::lookup(&segs[0]) {
                        if let Some(r) = info.ret {
                            return Some(r);
                        }
                        if info.closure.inputs.len() == 1 && c.args.len() == 1 && info.env.is_empty() && crate::closures::inline_depth() <= 12 {
                            let a = self.shape_of(&c.args[0])?;
                            return crate::closures::in_scope(&info, || self.closure_shape(&info.closure, "_", &a));
                        }
                        // With captures: bind them, then type the body.
                        let mut saved = Vec::new();
                        for (n, o, sh) in &info.env {
                            saved.push((n.clone(), self.vars.insert(n.clone(), (o.clone(), sh.clone()))));
                        }
                        let a = if info.closure.inputs.len() == 1 && c.args.len() == 1 { self.shape_of(&c.args[0]) } else { None };
                        let r = match a {
                            Some(a) if crate::closures::inline_depth() <= 12 => crate::closures::in_scope(&info, || self.closure_shape(&info.closure, "_", &a)),
                            _ => None,
                        };
                        self.unbind(saved);
                        return r;
                    }
                }
                if segs.len() >= 2 && segs[segs.len() - 2] == "mem" && matches!(last.as_str(), "take" | "replace") {
                    return self.shape_of(&c.args[0]);
                }
                // A tuple variant `Enum::V(..)` or a newtype `T(..)`.
                if segs.len() >= 2 {
                    let en = &segs[segs.len() - 2];
                    let en = if en == "Self" { self.self_ty.clone()? } else { en.clone() };
                    if self.enum_variants(&en).is_some_and(|(_, vs)| vs.iter().any(|v| v.name == last)) {
                        return Some(Shape::Named(en, vec![]));
                    }
                } else if self.named_fields(&last, None).is_some_and(|f| matches!(f, Fields::Tuple(_))) {
                    return Some(Shape::Named(last, vec![]));
                }
                let owner = self.owner_of(&segs);
                let f = self.resolve_fn(owner.as_deref(), &segs, &last)?;
                self.return_shape(&f, owner.as_deref())
            }
            Expr::Lit(l) => match &l.lit {
                Lit::Bool(_) => Some(Shape::Bool),
                Lit::Str(_) => Some(Shape::Str),
                Lit::Int(i) => Some(Shape::Int(match i.suffix() {
                    "u8" => "u8",
                    "u16" => "u16",
                    "u32" => "u32",
                    "u64" => "u64",
                    "i32" => "i32",
                    "i64" => "i64",
                    _ => "int",
                })),
                _ => None,
            },
            // Struct literals: `T { .. }`, `Enum::Variant { .. }`.
            Expr::Struct(st) if self.calls => {
                let segs = path_segs(&st.path);
                if segs.len() == 1 && segs[0] == "Self" {
                    return self.self_ty.clone().map(|t| Shape::Named(t, vec![]));
                }
                if segs.len() == 1 && self.e.reg.types.contains_key(&segs[0]) {
                    return Some(Shape::Named(segs[0].clone(), vec![]));
                }
                let enum_name = if segs.len() >= 2 { Some(segs[segs.len() - 2].clone()) } else { None }?;
                let enum_name = if enum_name == "Self" { self.self_ty.clone()? } else { enum_name };
                self.e.reg.types.contains_key(&enum_name).then(|| Shape::Named(enum_name, vec![]))
            }
            Expr::Binary(b) if self.calls => match b.op {
                BinOp::Eq(_) | BinOp::Ne(_) | BinOp::Lt(_) | BinOp::Le(_) | BinOp::Gt(_) | BinOp::Ge(_) | BinOp::And(_)
                | BinOp::Or(_) => Some(Shape::Bool),
                _ => self.shape_of(&b.left).or_else(|| self.shape_of(&b.right)),
            },
            Expr::Cast(c) if self.calls => Some(self.e.shape(&c.ty, &[])),
            Expr::Try(t) if self.calls => match self.shape_of(&t.expr)? {
                Shape::Result(v, _) => Some(*v),
                Shape::Option(v) => Some(*v),
                _ => None,
            },
            Expr::Index(ix) if self.calls => match self.shape_of(&ix.expr)? {
                Shape::Vec(i) | Shape::Array(i, _) | Shape::PVec(i) => Some(*i),
                _ => None,
            },
            Expr::Tuple(t) if t.elems.is_empty() => Some(Shape::Unit),
            Expr::Tuple(t) if self.calls && !t.elems.is_empty() => {
                let mut es = Vec::new();
                for e in &t.elems {
                    es.push(self.shape_of(e)?);
                }
                Some(Shape::Tuple(es))
            }
            Expr::Macro(m) if self.calls => {
                let name = m.mac.path.segments.last()?.ident.to_string();
                match name.as_str() {
                    "format" => Some(Shape::Str),
                    "matches" => Some(Shape::Bool),
                    "vec" => {
                        // The first element's shape.
                        let elems = m.mac.parse_body_with(syn::punctuated::Punctuated::<Expr, syn::Token![,]>::parse_terminated).ok()?;
                        let first = elems.first()?.clone();
                        Some(Shape::Vec(Box::new(self.shape_of(&first)?)))
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// A closure call: the arguments into temporaries, the captures and parameters bound, the body translated in place
    /// (a body with statements becomes a block assigning a result).
    pub fn inline_closure(&mut self, info: &crate::closures::ClosureInfo, args: &[&Expr], want: &Shape) -> R<String> {
        if crate::closures::inline_depth() > 12 {
            return Err("closures inlined too deep".into());
        }
        let c = &info.closure;
        if c.inputs.len() != args.len() {
            return Err("closure called with a different number of arguments".into());
        }
        if !crate::closures::simple_params(c) {
            return Err("closure parameter pattern".into());
        }
        let mut vals = Vec::new();
        for (i, a) in args.iter().enumerate() {
            // The parameter's own annotation (`|x: i32|`), else the callee's bound, else the argument's shape.
            let annotated = match &c.inputs[i] {
                Pat::Type(pt) => Some(self.e.shape(&pt.ty, &[])),
                _ => None,
            };
            let sh = match (annotated, info.args.as_ref().and_then(|v| v.get(i))) {
                (Some(s), _) => s,
                (None, Some(s)) => s.clone(),
                (None, None) => self.shape_of(a).ok_or("closure argument of an untyped value")?,
            };
            let v = self.expr(a, &sh)?;
            let n = self.next_temp();
            let t = format!("ca{n}_");
            self.pre.push(format!("{t}: {} = {v}", self.e.odin(&sh)));
            vals.push((t, sh));
        }
        let mut saved = Vec::new();
        for (name, odin, sh) in &info.env {
            saved.push((name.clone(), self.vars.insert(name.clone(), (odin.clone(), sh.clone()))));
        }
        for (p, (v, sh)) in c.inputs.iter().zip(vals.iter()) {
            match self.bind_param(p, v, sh) {
                Ok(s) => saved.extend(s),
                Err(e) => {
                    self.unbind(saved);
                    return Err(e);
                }
            }
        }
        // A body using `?` or `return` goes the block way, so they can leave it.
        let single = match &*c.body {
            _ if has_try(&c.body) || crate::closures::has_return(&c.body) => None,
            Expr::Block(b) if b.block.stmts.len() == 1 => match &b.block.stmts[0] {
                Stmt::Expr(e, None) => Some(e.clone()),
                _ => None,
            },
            Expr::Block(_) => None,
            e => Some(e.clone()),
        };
        let out = match (&info.ret, &single) {
            (Some(r), _) => r.clone(),
            (None, Some(e)) => self.shape_of(e).unwrap_or_else(|| want.clone()),
            (None, None) => want.clone(),
        };
        let r = crate::closures::in_scope(info, || match (&single, &*c.body) {
            (Some(e), _) => self.expr(e, &out),
            (None, Expr::Block(b)) => crate::body::inline_block(self, &b.block, &out),
            (None, e) => {
                let block: syn::Block = syn::parse_quote!({ #e });
                crate::body::inline_block(self, &block, &out)
            }
        });
        self.unbind(saved);
        let r = r?;
        // A value-returning closure called as a statement: its value is dropped.
        Ok(if matches!(want, Shape::Unit) && !matches!(out, Shape::Unit) && !r.is_empty() { format!("_ = {r}") } else { r })
    }

    /// A call of a generic function: its type parameters inferred from the arguments' shapes (and the wanted
    /// result), and a call of the instance translated with them substituted (monomorphization).
    fn call_generic(&mut self, name: &str, f: &FnDef, recv: Option<String>, args: &[&Expr], tparams: &[String]) -> R<String> {
        let has_recv = f.sig.inputs.iter().any(|i| matches!(i, syn::FnArg::Receiver(_)));
        let shift = usize::from(has_recv && recv.is_none());
        let mut binding: BTreeMap<String, Shape> = BTreeMap::new();
        let typed: Vec<&syn::PatType> = f.sig.inputs.iter().filter_map(|i| if let syn::FnArg::Typed(t) = i { Some(t) } else { None }).collect();
        for (pt, a) in typed.iter().zip(args.iter().skip(shift)) {
            if let Some(sh) = self.shape_of(a) {
                unify(&pt.ty, &sh, tparams, &mut binding);
            }
        }
        if let Some(missing) = tparams.iter().find(|t| !binding.contains_key(*t)) {
            return Err(format!("generic call with an uninferred type ({missing})"));
        }
        if binding.values().any(|s| matches!(s, Shape::Unknown(_) | Shape::Param(_))) {
            return Err("generic call with an unknown type".into());
        }
        let key: Vec<String> = binding.iter().map(|(k, v)| format!("{k}={}", self.e.odin(v))).collect();
        let iname = crate::closures::instance_key(name, &key).replace("__cl", "__g");
        let known = crate::closures::INSTANCES.with(|i| i.borrow().0.get(&iname).cloned());
        match known {
            Some(v) if v.starts_with('!') => return Err(format!("generic instance: {}", &v[1..])),
            Some(_) => {}
            None => {
                let depth = crate::closures::DEPTH.with(|d| d.get());
                if depth >= 6 {
                    return Err("generic instances nested too deep".into());
                }
                crate::closures::INSTANCES.with(|i| i.borrow_mut().0.insert(iname.clone(), iname.clone()));
                crate::closures::DEPTH.with(|d| d.set(depth + 1));
                let made = crate::body::translate_generic_instance(self.e, f.self_ty.as_deref(), &f.sig.ident.to_string(), f, &iname, &binding);
                crate::closures::DEPTH.with(|d| d.set(depth));
                match made {
                    Ok(code) => crate::closures::INSTANCES.with(|i| i.borrow_mut().1.push((iname.clone(), code))),
                    Err(e) => {
                        crate::closures::INSTANCES.with(|i| i.borrow_mut().0.insert(iname.clone(), format!("!{e}")));
                        return Err(format!("generic instance: {e}"));
                    }
                }
            }
        }
        // The call itself, with the parameters' types substituted.
        let mut g = f.clone();
        g.sig.generics.params = f.sig.generics.params.iter().filter(|p| matches!(p, syn::GenericParam::Lifetime(_))).cloned().collect();
        g.sig.generics.where_clause = None;
        let saved = self.e.subst.clone();
        for (k, v) in &binding {
            self.e.subst.insert(k.clone(), v.clone());
        }
        let r = self.call_with_sig(&iname, &g, recv, args);
        self.e.subst = saved;
        r
    }

    /// A call passing closures to `f`: a call of the instance of `f` made for those closures (closures.rs).
    fn call_instance(&mut self, name: &str, f: &FnDef, recv: Option<String>, args: &[&Expr], cps: &[(usize, Vec<syn::Type>, Option<syn::Type>)]) -> R<String> {
        use crate::closures::{ClosureInfo, ClosureOrName};
        let has_recv = f.sig.inputs.iter().any(|i| matches!(i, syn::FnArg::Receiver(_)));
        let shift = usize::from(has_recv && recv.is_none());
        let mut closures: Vec<(usize, ClosureInfo)> = Vec::new();
        let (mut cap_params, mut cap_args, mut key) = (Vec::new(), Vec::new(), Vec::new());
        for (pi, targs, tret) in cps {
            let a = args.get(pi + shift).ok_or("closure argument missing")?;
            let (closure, env, scope) = match crate::closures::closure_arg(a, targs.len()).ok_or("closure argument that isn't a closure")? {
                ClosureOrName::Closure(c) => {
                    let env = crate::closures::captures(self, &c);
                    (c, env, crate::closures::scope_now())
                }
                ClosureOrName::Named(n) => {
                    let info = crate::closures::lookup(&n).ok_or("closure")?;
                    (info.closure, info.env, info.scope)
                }
            };
            let arg_shapes: Vec<Shape> = targs.iter().map(|t| self.e.shape(t, &[])).collect();
            let ret_shape = tret.as_ref().map(|t| self.e.shape(t, &[])).unwrap_or(Shape::Unit);
            if arg_shapes.iter().chain(std::iter::once(&ret_shape)).any(|s| matches!(s, Shape::Unknown(_) | Shape::Param(_))) {
                return Err("closure with a generic signature".into());
            }
            let mut env_inst = Vec::new();
            for (rn, odin, sh) in env {
                let k = cap_params.len();
                let p = format!("cap{k}_");
                let ty = self.e.odin(&sh);
                let by_value = crate::closures::BY_VALUE.with(|b| b.borrow().contains(&odin));
                let mode = if let Some(ptr) = odin.strip_suffix('^') {
                    cap_params.push(format!("{p}: ^{ty}"));
                    cap_args.push(ptr.to_string());
                    env_inst.push((rn.clone(), format!("{p}^"), sh));
                    "ptr"
                } else if by_value {
                    cap_params.push(format!("{p}: {ty}"));
                    cap_args.push(odin.clone());
                    env_inst.push((rn.clone(), p.clone(), sh));
                    "val"
                } else {
                    cap_params.push(format!("{p}: ^{ty}"));
                    cap_args.push(format!("&{odin}"));
                    env_inst.push((rn.clone(), format!("{p}^"), sh));
                    "ptr"
                };
                key.push(format!("{rn}:{ty}:{mode}"));
            }
            key.push(closure.to_token_stream().to_string());
            // A closure that uses other closures of its scope: those are inlined inside the instance too, so their own
            // captures would have to travel with it. Refused for now.
            if !scope.is_empty() && crate::closures::uses_any(&closure, &scope) {
                return Err("closure using another closure, passed to a function".into());
            }
            closures.push((*pi, ClosureInfo { closure, env: env_inst, args: Some(arg_shapes), ret: Some(ret_shape), scope: Default::default() }));
        }
        let iname = crate::closures::instance_key(name, &key);
        let known = crate::closures::INSTANCES.with(|i| i.borrow().0.get(&iname).cloned());
        match known {
            Some(v) if v.starts_with('!') => return Err(format!("closure instance: {}", &v[1..])),
            Some(_) => {}
            None => {
                // Instances made inside instances: bounded (a closure rebuilt at each level would never end).
                let depth = crate::closures::DEPTH.with(|d| d.get());
                if depth >= 6 {
                    return Err("closure instances nested too deep".into());
                }
                // Registered first, so a recursive call inside the instance calls it rather than remaking it.
                crate::closures::INSTANCES.with(|i| i.borrow_mut().0.insert(iname.clone(), iname.clone()));
                crate::closures::DEPTH.with(|d| d.set(depth + 1));
                let made = crate::body::translate_instance(self.e, f.self_ty.as_deref(), &f.sig.ident.to_string(), f, &iname, &closures, &cap_params);
                crate::closures::DEPTH.with(|d| d.set(depth));
                match made {
                    Ok(code) => crate::closures::INSTANCES.with(|i| i.borrow_mut().1.push((iname.clone(), code))),
                    Err(e) => {
                        crate::closures::INSTANCES.with(|i| i.borrow_mut().0.insert(iname.clone(), format!("!{e}")));
                        return Err(format!("closure instance: {e}"));
                    }
                }
            }
        }
        // The call: the other arguments as usual, then the captures.
        let skip: std::collections::BTreeSet<usize> = closures.iter().map(|c| c.0).collect();
        let mut parts = Vec::new();
        let mut ai = 0;
        let mut ti = 0;
        for input in &f.sig.inputs {
            match input {
                syn::FnArg::Receiver(rc) => {
                    let r = match recv.clone() {
                        Some(r) => r,
                        None => {
                            let a = args.get(ai).ok_or("method called without a receiver")?;
                            ai += 1;
                            let owner = f.self_ty.clone().ok_or("receiver of a free function")?;
                            self.expr(a, &Shape::Named(owner, vec![]))?
                        }
                    };
                    parts.push(if rc.mutability.is_some() && rc.reference.is_some() { format!("&{r}") } else { r });
                }
                syn::FnArg::Typed(pt) => {
                    let a = args.get(ai).ok_or("argument count")?;
                    ai += 1;
                    let this = ti;
                    ti += 1;
                    if skip.contains(&this) {
                        continue;
                    }
                    let sh = self.e.shape(&pt.ty, &[]);
                    let v = self.expr(a, &sh)?;
                    let by_mut_ref = matches!(&*pt.ty, syn::Type::Reference(r) if r.mutability.is_some());
                    parts.push(if by_mut_ref { format!("&{v}") } else { v });
                }
            }
        }
        parts.extend(cap_args);
        Ok(format!("{iname}({})", parts.join(", ")))
    }

    /// An Odin value given its type when it is an untyped literal (`{..}` or `nil`).
    fn typed_value(&self, v: &str, shape: &Shape) -> String {
        if v.starts_with('{') && matches!(shape, Shape::Ptr(..) | Shape::OptPtr(..)) {
            // A pointer to a default value needs an allocation; an untyped `{}` would be nil. Left for Odin to reject.
            return format!("UNTRANSLATABLE_default_pointer");
        }
        if v.starts_with('{') {
            format!("{}{v}", self.e.odin(shape))
        } else if v == "nil" {
            format!("({})(nil)", self.e.odin(shape))
        } else {
            v.to_string()
        }
    }

    /// A newtype over a number (`ObjectId(u64)`): an Odin `distinct` number, which supports arithmetic.
    fn is_distinct_number(&mut self, n: &str) -> bool {
        match self.named_fields(n, None) {
            Some(Fields::Tuple(fs)) if fs.len() == 1 => matches!(self.e.shape(&fs[0].ty, &[]), Shape::Int(_) | Shape::Float(_)),
            _ => false,
        }
    }

    /// `matches!(e, P | Q if guard)` with any patterns (pattern.rs): each alternative is a labelled block whose
    /// failed tests leave it; the value is whether one got through.
    fn matches_general(&mut self, mac: &MatchesArgs) -> R<String> {
        let sh = self.shape_of(&mac.subject).ok_or("matches! subject")?;
        let v = self.expr(&mac.subject, &sh)?;
        let n = self.next_temp();
        let subj = format!("mx{n}_");
        let res = format!("mr{n}_");
        self.pre.push(format!("{subj} := {v}"));
        self.pre.push(format!("{res} := false"));
        let alts: Vec<&Pat> = match &mac.pat {
            Pat::Or(o) => o.cases.iter().collect(),
            p => vec![p],
        };
        for alt in alts {
            let code = crate::pattern::compile(self, alt, &subj, &sh, crate::pattern::Mode::Value)?;
            let label = format!("ma{}_", self.next_temp());
            let mut body: Vec<String> = code.stmts.iter().map(|st| st.replace(crate::pattern::FAIL, &format!("break {label}"))).collect();
            let mut saved = Vec::new();
            for (name, init, bsh, _) in &code.binds {
                let ident = format!("{}_m{}", crate::emit::field_ident(name), self.next_temp());
                body.push(format!("{ident} := {init}"));
                saved.push((name.clone(), self.vars.insert(name.clone(), (ident, bsh.clone()))));
            }
            if let Some(g) = &mac.guard {
                let outer = std::mem::take(&mut self.pre);
                let c = self.expr(g, &Shape::Bool);
                let inner = std::mem::replace(&mut self.pre, outer);
                body.extend(inner);
                let c = match c {
                    Ok(c) => c,
                    Err(e) => {
                        self.unbind(saved);
                        return Err(e);
                    }
                };
                body.push(format!("if !({c}) do break {label}"));
            }
            self.unbind(saved);
            body.push(format!("{res} = true"));
            self.pre.push(format!("if !{res} {{ {label}: {{\n{}\n}} }}", body.join("\n")));
        }
        Ok(res)
    }

    /// What a Vec-shaped value is in Rust: a Vec, a sorted set, or a hash set (None when the translator can't tell).
    pub fn set_kind(&mut self, e: &Expr) -> Option<SetKind> {
        let ty = match e {
            Expr::Paren(p) => return self.set_kind(&p.expr),
            Expr::Reference(r) => return self.set_kind(&r.expr),
            Expr::Unary(u) => return self.set_kind(&u.expr),
            Expr::Path(p) if p.path.segments.len() == 1 => RUST_TYPES.with(|t| t.borrow().get(&p.path.segments[0].ident.to_string()).cloned())?,
            Expr::Field(fe) => {
                let base = match self.shape_of(&fe.base)? {
                    Shape::Ptr(i, _) | Shape::MutRef(i) => *i,
                    s => s,
                };
                let Shape::Named(tn, _) = base else { return None };
                let syn::Member::Named(id) = &fe.member else { return None };
                let Some(Fields::Named(fs)) = self.named_fields(&tn, None) else { return None };
                let f = fs.iter().find(|f| f.name.as_deref() == Some(&id.to_string()))?;
                let t = &f.ty;
                quote::quote!(#t).to_string()
            }
            _ => return None,
        };
        Some(set_kind_of(&ty))
    }

    /// Whether Odin's `<` orders values of this shape as Rust's Ord does (numbers, strings, plain enums, newtypes).
    fn ordered(&mut self, s: &Shape) -> bool {
        match s {
            Shape::Int(_) | Shape::Str | Shape::Char | Shape::Bool => true,
            Shape::Named(n, _) => self.is_distinct_number(n) || self.enum_variants(n).is_some_and(|v| v.0),
            _ => false,
        }
    }

    fn next_temp(&mut self) -> u32 {
        self.temps += 1;
        self.temps
    }

    fn shape_of_pub_mc(&mut self, mc: &syn::ExprMethodCall) -> Option<Shape> {
        self.shape_of(&Expr::MethodCall(mc.clone()))
    }

    pub fn shape_of_pub(&mut self, ex: &Expr) -> Option<Shape> {
        self.shape_of(ex)
    }

    pub fn enum_variants_pub(&self, name: &str) -> Option<(bool, Vec<crate::model::Variant>)> {
        self.enum_variants(name)
    }

    pub fn named_fields_pub(&self, ty: &str, variant: Option<&str>) -> Option<Fields> {
        self.named_fields(ty, variant)
    }

    /// The shape an engine function returns (`Self` is its owner).
    pub fn return_shape(&mut self, f: &FnDef, owner: Option<&str>) -> Option<Shape> {
        if let syn::ReturnType::Type(_, t) = &f.sig.output {
            if let Some(s) = self.mut_ref_result(t, owner) {
                return Some(s);
            }
        }
        // ObjectMap's iterators (type aliases over im's) are hand-written as Vecs in Rust's order (D-182).
        if owner == Some("ObjectMap") {
            let named = |n: &str| Shape::Named(n.to_string(), vec![]);
            match f.sig.ident.to_string().as_str() {
                "get_mut" => return Some(Shape::Option(Box::new(Shape::MutRef(Box::new(named("GameObject")))))),
                "values" => return Some(Shape::Vec(Box::new(named("GameObject")))),
                "keys" => return Some(Shape::Vec(Box::new(named("ObjectId")))),
                "iter" => return Some(Shape::Vec(Box::new(Shape::Tuple(vec![named("ObjectId"), named("GameObject")])))),
                _ => {}
            }
        }
        match &f.sig.output {
            syn::ReturnType::Default => Some(Shape::Unit),
            syn::ReturnType::Type(_, t) => {
                let s = self.e.shape(t, &[]);
                Some(match s {
                    Shape::Named(ref n, _) | Shape::Unknown(ref n) if n == "Self" => Shape::Named(owner?.to_string(), vec![]),
                    // `Option<Self>`, `Vec<Self>`, `Result<Self, E>`: the owner inside too.
                    s => {
                        let o = owner.map(str::to_string);
                        subst_self(s, o.as_deref())?
                    }
                })
            }
        }
    }

    /// `&mut T` → MutRef(T), `Option<&mut T>` → Option(MutRef(T)): a result that points into the caller's data.
    pub fn mut_ref_result(&mut self, t: &syn::Type, owner: Option<&str>) -> Option<Shape> {
        let inner_of = |tx: &mut Self, t: &syn::Type| -> Shape {
            let s = tx.e.shape(t, &[]);
            match s {
                Shape::Named(ref n, _) | Shape::Unknown(ref n) if n == "Self" => owner.map(|o| Shape::Named(o.to_string(), vec![])).unwrap_or(s),
                s => s,
            }
        };
        match t {
            syn::Type::Reference(r) if r.mutability.is_some() => Some(Shape::MutRef(Box::new(inner_of(self, &r.elem)))),
            syn::Type::Path(p) => {
                let seg = p.path.segments.last()?;
                if seg.ident != "Option" {
                    return None;
                }
                let syn::PathArguments::AngleBracketed(a) = &seg.arguments else { return None };
                match a.args.first()? {
                    syn::GenericArgument::Type(syn::Type::Reference(r)) if r.mutability.is_some() => {
                        Some(Shape::Option(Box::new(Shape::MutRef(Box::new(inner_of(self, &r.elem))))))
                    }
                    _ => None,
                }
            }
            _ => None,
        }
    }

    /// A call to a translated engine function: arguments shaped by its parameters, `&mut` ones by pointer.
    pub fn call_with_sig(&mut self, name: &str, f: &FnDef, recv: Option<String>, args: &[&Expr]) -> R<String> {
        let cps = crate::closures::closure_params(f);
        if !cps.is_empty() {
            return self.call_instance(name, f, recv, args, &cps);
        }
        // A generic function (not written by hand): an instance for the call's types.
        let tparams: Vec<String> = f.sig.generics.type_params().map(|t| t.ident.to_string()).collect();
        if !tparams.is_empty() && !HAND.with(|h| h.borrow().contains(name)) {
            return self.call_generic(name, f, recv, args, &tparams);
        }
        // A generic function is callable only written by hand, its parameters typed by the call's arguments.
        let hand_generic = crate::body::generic_kind(&f.sig).is_some();
        if hand_generic && !HAND.with(|h| h.borrow().contains(name)) {
            return Err(format!("call to a generic function: {name}"));
        }
        let generics: Vec<String> = f.sig.generics.type_params().map(|t| t.ident.to_string()).collect();
        let mut parts = Vec::new();
        let mut ai = 0;
        for input in &f.sig.inputs {
            match input {
                syn::FnArg::Receiver(rc) => {
                    // `Type::method(x, ..)` (and `.map(Type::method)`): the first argument is the receiver.
                    let r = match recv.clone() {
                        Some(r) => r,
                        None => {
                            let a = args.get(ai).ok_or("method called without a receiver")?;
                            ai += 1;
                            let owner = f.self_ty.clone().ok_or("receiver of a free function")?;
                            self.expr(a, &Shape::Named(owner, vec![]))?
                        }
                    };
                    parts.push(if rc.mutability.is_some() && rc.reference.is_some() { format!("&{r}") } else { r });
                }
                syn::FnArg::Typed(pt) => {
                    let a = args.get(ai).ok_or("argument count")?;
                    ai += 1;
                    let sh = self.e.shape(&pt.ty, &generics);
                    let sh = if shape_mentions_param(&sh) { self.shape_of(a).ok_or("argument to a generic parameter")? } else { sh };
                    let v = self.expr(a, &sh)?;
                    let by_mut_ref = matches!(&*pt.ty, syn::Type::Reference(r) if r.mutability.is_some());
                    parts.push(if by_mut_ref { format!("&{v}") } else { v });
                }
            }
        }
        Ok(format!("{name}({})", parts.join(", ")))
    }

    /// `matches!(subject, pattern)` as statements returning the result.
    pub fn matches_stmts(&mut self, subject: &str, shape: &Shape, pat: &Pat) -> R<String> {
        let alts: Vec<&Pat> = match pat {
            Pat::Or(o) => o.cases.iter().collect(),
            p => vec![p],
        };
        let (inner_shape, subject, wrap_some) = match shape {
            Shape::Option(i) => ((**i).clone(), subject.to_string(), true),
            s => (s.clone(), subject.to_string(), false),
        };
        let _ = wrap_some;
        match &inner_shape {
            Shape::Named(n, _) if self.enum_variants(n).is_some() => {
                let (unit, _) = self.enum_variants(n).unwrap();
                if unit {
                    let mut conds = Vec::new();
                    for p in alts {
                        let segs = pat_path(p).ok_or("pattern")?;
                        let (e, v) = self.variant_of(&segs, &inner_shape).ok_or("pattern variant")?;
                        conds.push(format!("{subject} == {e}.{v}"));
                    }
                    return Ok(format!("\treturn {}\n", conds.join(" || ")));
                }
                let mut out = format!("\t#partial switch y in {subject} {{\n");
                for p in alts {
                    let segs = pat_path(p).ok_or("pattern")?;
                    let (e, v) = self.variant_of(&segs, &inner_shape).ok_or("pattern variant")?;
                    let fields = self.named_fields(&e, Some(&v)).unwrap();
                    let mut conds = Vec::new();
                    match p {
                        Pat::Struct(ps) => {
                            for fp in &ps.fields {
                                let syn::Member::Named(id) = &fp.member else { return Err("pattern member".into()) };
                                let fs = self.field_shape(&fields, &id.to_string(), &[]).ok_or("pattern field")?;
                                let acc = format!("y.{}", field_ident(&id.to_string()));
                                conds.push(self.pat_cond(&acc, &fs, &fp.pat)?);
                            }
                        }
                        Pat::TupleStruct(ts) => {
                            let shapes = self.tuple_shapes(&fields);
                            for (i, sp) in ts.elems.iter().enumerate() {
                                let s = shapes.get(i).cloned().ok_or("pattern arity")?;
                                conds.push(self.pat_cond(&format!("y._{i}"), &s, sp)?);
                            }
                        }
                        _ => {}
                    }
                    conds.retain(|c| c != "true");
                    let cond = if conds.is_empty() { "true".to_string() } else { conds.join(" && ") };
                    let _ = writeln!(out, "\tcase {e}_{v}:\n\t\t_ = y\n\t\treturn {cond}");
                }
                out.push_str("\t}\n\treturn false\n");
                Ok(out)
            }
            _ => {
                let mut conds = Vec::new();
                for p in alts {
                    conds.push(self.pat_cond(&subject, &inner_shape, p)?);
                }
                Ok(format!("\treturn {}\n", conds.join(" || ")))
            }
        }
    }

    /// A sub-pattern as a boolean condition on an already-extracted value.
    fn pat_cond(&mut self, acc: &str, shape: &Shape, p: &Pat) -> R<String> {
        match p {
            Pat::Wild(_) | Pat::Rest(_) => Ok("true".into()),
            Pat::Lit(l) => Ok(format!("{acc} == {}", lit(&l.lit)?)),
            Pat::Ident(i) if i.subpat.is_none() && i.ident == "None" => Ok(format!("{acc} == nil")),
            Pat::Path(_) | Pat::Ident(_) => {
                let segs = pat_path(p).ok_or("sub-pattern")?;
                match self.variant_of(&segs, shape) {
                    Some((e, v)) if self.enum_variants(&e).map(|x| x.0).unwrap_or(false) => Ok(format!("{acc} == {e}.{v}")),
                    _ => Err("sub-pattern path".into()),
                }
            }
            _ => Err(format!("sub-pattern {}", quote::quote!(#p))),
        }
    }
}

fn pat_path(p: &Pat) -> Option<Vec<String>> {
    match p {
        Pat::Path(pp) => Some(path_segs(&pp.path)),
        Pat::Struct(ps) => Some(path_segs(&ps.path)),
        Pat::TupleStruct(ts) => Some(path_segs(&ts.path)),
        Pat::Ident(i) => Some(vec![i.ident.to_string()]),
        _ => None,
    }
}

/// The function a serde attribute path names, looked up the way rustc would: `Type::method` as an impl method,
/// otherwise a free function, preferring the one in the same file as the type that uses it.
fn resolve<'r>(e: &Emitter<'r>, path: &str, user: &str) -> Option<&'r FnDef> {
    let segs: Vec<&str> = path.split("::").collect();
    let name = segs.last()?.to_string();
    let owner = if segs.len() >= 2 && segs[segs.len() - 2].chars().next()?.is_uppercase() {
        Some(segs[segs.len() - 2].to_string())
    } else {
        None
    };
    let defs = e.reg.fns.get(&(owner, name))?;
    let user_file = e.def(user).map(|d| d.file.clone());
    defs.iter().find(|d| Some(&d.file) == user_file.as_ref()).or(defs.first())
}

fn single_expr(block: &syn::Block) -> Option<&Expr> {
    match block.stmts.as_slice() {
        [Stmt::Expr(e, None)] => Some(e),
        [Stmt::Expr(Expr::Return(r), _)] => r.expr.as_deref(),
        _ => None,
    }
}

/// Translates every default function and skip predicate the codecs call. Returns the Odin source and the ones that
/// need writing by hand.
pub fn defaults_and_skips(e: &mut Emitter) -> (String, Vec<String>) {
    let mut out = String::new();
    let mut failed = Vec::new();
    // One Odin procedure per distinct Rust function; each request is an alias of it.
    let mut canonical: BTreeMap<String, String> = BTreeMap::new();
    let defaults: Vec<_> = e.default_reqs.clone().into_iter().collect();
    let skips: Vec<_> = e.skip_reqs.clone().into_iter().collect();
    for (is_default, reqs) in [(true, defaults), (false, skips)] {
        for (proc_name, (path, shape, user)) in reqs {
            let Some(f) = resolve(e, &path, &user) else {
                // Outside the scanned sources (e.g. bin/oracle_gen.rs): written by hand.
                let hand_name = format!("hand_{}", path.rsplit("::").next().unwrap_or(&path));
                let _ = writeln!(out, "{proc_name} :: {hand_name}");
                failed.push(format!("{hand_name}: {path} (not in the scanned sources)"));
                continue;
            };
            let key = format!("{}:{}:{}:{}", f.file.display(), f.self_ty.clone().unwrap_or_default(), f.sig.ident, e.odin(&shape));
            if let Some(c) = canonical.get(&key) {
                let _ = writeln!(out, "{proc_name} :: {c}");
                continue;
            }
            let odin_ty = e.odin(&shape);
            let result = (|| -> R<String> {
                let body = single_expr(&f.block).ok_or("not a single expression")?;
                let mut tx = Tx { e, vars: BTreeMap::new(), self_ty: f.self_ty.clone(), depth: 0, calls: false, pre: Vec::new(), fn_ret: Shape::Unit, temps: 0 };
                if is_default {
                    let v = tx.expr(body, &shape)?;
                    Ok(format!("{proc_name} :: proc() -> {odin_ty} {{\n\treturn {v}\n}}\n"))
                } else {
                    // The predicate's one parameter (or self) is the field value `x`.
                    let pname = match f.sig.inputs.first() {
                        Some(syn::FnArg::Receiver(_)) => "self".to_string(),
                        Some(syn::FnArg::Typed(pt)) => match &*pt.pat {
                            Pat::Ident(i) => i.ident.to_string(),
                            _ => return Err("parameter pattern".into()),
                        },
                        None => return Err("no parameter".into()),
                    };
                    tx.vars.insert(pname, ("x".into(), shape.clone()));
                    let stmts = match body {
                        Expr::Macro(m) if m.mac.path.is_ident("matches") => {
                            let mac: MatchesArgs = m.mac.parse_body().map_err(|e| e.to_string())?;
                            if mac.guard.is_some() {
                                return Err("matches! with a guard".into());
                            }
                            let subject_shape = tx.shape_of(&mac.subject).ok_or("matches! subject")?;
                            tx.matches_stmts("x", &subject_shape, &mac.pat)?
                        }
                        other => format!("\treturn {}\n", tx.expr(other, &Shape::Bool)?),
                    };
                    Ok(format!("{proc_name} :: proc(x: {odin_ty}) -> bool {{\n\t_ = x\n{stmts}}}\n"))
                }
            })();
            match result {
                Ok(src) => {
                    canonical.insert(key, proc_name.clone());
                    out.push_str(&src);
                    out.push('\n');
                }
                Err(why) => {
                    // Written by hand once, as hand_<Type>_<fn> (odin/engine/types/hand_*.odin); each use aliases it.
                    let owner = f.self_ty.clone().map(|t| format!("{t}_")).unwrap_or_default();
                    let hand_name = format!("hand_{owner}{}", f.sig.ident);
                    let _ = writeln!(out, "{proc_name} :: {hand_name}");
                    canonical.insert(key, proc_name.clone());
                    failed.push(format!("{hand_name}: {path} ({why})"));
                }
            }
        }
    }
    // `impl Default for T` bodies, for types whose Default isn't Odin's zero value.
    let manual: Vec<String> = e.manual_default_reqs.iter().cloned().collect();
    for ty in manual {
        let Some(f) = e.reg.fns.get(&(Some(ty.clone()), "__Default".to_string())).and_then(|v| v.first()) else {
            failed.push(format!("default_{ty}: impl Default not found"));
            continue;
        };
        let shape = Shape::Named(ty.clone(), vec![]);
        let res = (|| -> R<String> {
            let body = single_expr(&f.block).ok_or("not a single expression")?;
            let mut tx = Tx { e, vars: BTreeMap::new(), self_ty: Some(ty.clone()), depth: 0, calls: false, pre: Vec::new(), fn_ret: Shape::Unit, temps: 0 };
            tx.expr(body, &shape)
        })();
        match res {
            Ok(v) => {
                let _ = writeln!(out, "default_{ty} :: proc() -> {ty} {{\n\treturn {v}\n}}\n");
            }
            Err(why) => {
                let _ = writeln!(out, "default_{ty} :: hand_default_{ty}\n");
                failed.push(format!("hand_default_{ty}: impl Default for {ty} ({why})"));
            }
        }
    }
    (out, failed)
}

struct MatchesArgs {
    subject: Expr,
    pat: Pat,
    guard: Option<Expr>,
}

impl syn::parse::Parse for MatchesArgs {
    fn parse(input: syn::parse::ParseStream) -> syn::Result<Self> {
        let subject: Expr = input.parse()?;
        input.parse::<syn::Token![,]>()?;
        let pat = Pat::parse_multi_with_leading_vert(input)?;
        // `matches!(x, P if cond)`: the guard is part of the test.
        let guard = if input.peek(syn::Token![if]) {
            input.parse::<syn::Token![if]>()?;
            Some(input.parse::<Expr>()?)
        } else {
            None
        };
        let _ = input.parse::<Option<syn::Token![,]>>();
        Ok(MatchesArgs { subject, pat, guard })
    }
}

// ------------------------------------------------------------------------------------------- iterator chains ---
// `xs.iter().filter(|x| ..).map(|x| ..).collect()` and friends become one loop, written ahead of the line (pre),
// with each closure's body inlined; the chain's value is a temporary. Only expression-bodied closures and a
// collection at the chain's start (a `Vec`, an `im::Vector`, a range) for now.

enum Stage {
    Filter(syn::ExprClosure),
    Map(syn::ExprClosure),
    FilterMap(syn::ExprClosure),
    /// The item with its index among the items reaching this stage: `(int, T)`.
    Enumerate,
    /// Each item's closure result (a Vec or an Option) in turn: an inner loop.
    FlatMap(syn::ExprClosure),
    Pass, // copied(), cloned(), iter(), into_iter()
}

impl<'a, 'b> Tx<'a, 'b> {
    fn chain_terminal(&self, mc: &syn::ExprMethodCall) -> bool {
        matches!(mc.method.to_string().as_str(), "collect" | "any" | "all" | "find" | "position" | "count" | "sum" | "find_map")
            && self.chain_source(&mc.receiver).is_some()
    }

    /// The collection a chain starts from, under its adapters.
    fn chain_source<'e>(&self, mut e: &'e Expr) -> Option<&'e Expr> {
        loop {
            match e {
                Expr::MethodCall(m) => match m.method.to_string().as_str() {
                    "iter" | "into_iter" | "copied" | "cloned" | "filter" | "map" | "filter_map" | "enumerate" | "flat_map" => e = &m.receiver,
                    // Any other call is the source: an `impl Iterator` result is materialized as a Vec (an iterator
                    // method on a Vec-shaped value can only be one: Vec and slices have no `any` or `map`). `chain`
                    // refuses a source that isn't a Vec.
                    _ => return Some(e),
                },
                Expr::Paren(p) => e = &p.expr,
                _ => return Some(e),
            }
        }
    }

    /// An adapter's one-argument closure; a function path `f` (`.map(ObjectId::from)`) is the closure `|x| f(x)`.
    /// The item shape of an iterator chain (`v.iter().filter(..).map(..)`), following each stage's closure.
    fn chain_item_shape(&mut self, e: &Expr) -> Option<Shape> {
        match e {
            Expr::MethodCall(m) => match m.method.to_string().as_str() {
                "iter" | "into_iter" | "copied" | "cloned" if m.args.is_empty() => match self.shape_of(&m.receiver) {
                    Some(Shape::Vec(i) | Shape::PVec(i) | Shape::Array(i, _)) => Some(*i),
                    // An Option iterates its value, if any.
                    Some(Shape::Option(i)) if m.method != "copied" && m.method != "cloned" => Some(*i),
                    Some(Shape::Ptr(p, _)) => match *p {
                        Shape::Vec(i) => Some(*i),
                        _ => None,
                    },
                    // An adapter's receiver is itself a chain (`v.iter().copied()`).
                    _ => self.chain_item_shape(&m.receiver),
                },
                "filter" => self.chain_item_shape(&m.receiver),
                "enumerate" if m.args.is_empty() => Some(Shape::Tuple(vec![Shape::Int("int"), self.chain_item_shape(&m.receiver)?])),
                "flat_map" => {
                    let cur = self.chain_item_shape(&m.receiver)?;
                    let c = Self::closure_of(m.args.first()?).ok()?;
                    match self.closure_shape(&c, "_", &cur)? {
                        Shape::Vec(i) | Shape::Option(i) => Some(*i),
                        _ => None,
                    }
                }
                "map" | "filter_map" => {
                    let cur = self.chain_item_shape(&m.receiver)?;
                    let c = Self::closure_of(m.args.first()?).ok()?;
                    let out = self.closure_shape(&c, "_", &cur)?;
                    if m.method == "map" {
                        Some(out)
                    } else {
                        match out {
                            Shape::Option(i) => Some(*i),
                            _ => None,
                        }
                    }
                }
                // A call as the source: a materialized `impl Iterator` (see `chain_source`).
                _ => match self.shape_of(e)? {
                    Shape::Vec(i) | Shape::PVec(i) => Some(*i),
                    _ => None,
                },
            },
            Expr::Paren(p) => self.chain_item_shape(&p.expr),
            _ => None,
        }
    }

    /// The item type of a `Definitions<T>` instance (`Definitions_TriggerDefinition`).
    fn definitions_item(&self, n: &str) -> Option<Shape> {
        match self.e.instances.get(n) {
            Some((base, args)) if base == "Definitions" && args.len() == 1 => Some(args[0].clone()),
            _ => None,
        }
    }

    fn closure_of(a: &Expr) -> R<syn::ExprClosure> {
        match a {
            Expr::Closure(c) if c.inputs.len() == 1 => Ok(c.clone()),
            Expr::Path(p) if p.qself.is_none() => Ok(syn::parse_quote!(|path_arg_| #p(path_arg_))),
            Expr::Closure(c) => Err(format!("iterator adapter with a {}-argument closure", c.inputs.len())),
            Expr::Path(_) => Err("iterator adapter with a function path".into()),
            _ => Err("iterator adapter with a non-closure argument".into()),
        }
    }

    /// Binds a closure's parameter (`|x|`, `|&x|`, `|(a, b)|`) to an Odin value of a shape; returns the old bindings.
    fn bind_param(&mut self, pat: &Pat, value: &str, shape: &Shape) -> R<Vec<(String, Option<(String, Shape)>)>> {
        let mut saved = Vec::new();
        match pat {
            Pat::Ident(pi) => {
                let n = pi.ident.to_string();
                saved.push((n.clone(), self.vars.insert(n, (value.to_string(), shape.clone()))));
            }
            Pat::Reference(r) => return self.bind_param(&r.pat, value, shape),
            Pat::Type(t) => return self.bind_param(&t.pat, value, shape),
            Pat::Wild(_) => {}
            Pat::Tuple(t) => {
                let Shape::Tuple(es) = shape else { return Err("tuple parameter on a non-tuple".into()) };
                for (i, (p, s)) in t.elems.iter().zip(es.clone().iter()).enumerate() {
                    saved.extend(self.bind_param(p, &format!("{value}._{i}"), s)?);
                }
            }
            _ => return Err("closure parameter pattern".into()),
        }
        Ok(saved)
    }

    fn unbind(&mut self, saved: Vec<(String, Option<(String, Shape)>)>) {
        for (n, old) in saved.into_iter().rev() {
            match old {
                Some(o) => {
                    self.vars.insert(n, o);
                }
                None => {
                    self.vars.remove(&n);
                }
            }
        }
    }

    /// A closure body inside a loop body: its expression, after any statements it needs (into `body`).
    fn closure_in(&mut self, body: &mut Vec<String>, c: &syn::ExprClosure, value: &str, shape: &Shape, want: &Shape) -> R<String> {
        let outer = std::mem::take(&mut self.pre);
        let r = self.closure_expr(c, value, shape, want);
        let inner = std::mem::replace(&mut self.pre, outer);
        body.extend(inner);
        r
    }

    /// A closure body as an expression, with its parameter bound to `value`.
    fn closure_expr(&mut self, c: &syn::ExprClosure, value: &str, shape: &Shape, want: &Shape) -> R<String> {
        // `?` in a closure leaves the closure: the body goes the block way (inline_block), where `?` breaks out of it
        // with None/Err as the closure's value instead of returning from the enclosing procedure.
        if (has_try(&c.body) || crate::closures::has_return(&c.body)) && !matches!(&*c.body, Expr::Block(b) if b.block.stmts.len() != 1) {
            let body = &*c.body;
            let block: syn::Block = match body {
                Expr::Block(b) => b.block.clone(),
                e => syn::parse_quote!({ #e }),
            };
            let saved = self.bind_param(&c.inputs[0], value, shape)?;
            let r = crate::body::inline_block(self, &block, want);
            self.unbind(saved);
            return r;
        }
        let saved = self.bind_param(&c.inputs[0], value, shape)?;
        let body = match &*c.body {
            Expr::Block(b) if b.block.stmts.len() == 1 => match &b.block.stmts[0] {
                Stmt::Expr(e, None) => e.clone(),
                _ => {
                    self.unbind(saved);
                    return Err("closure with statements".into());
                }
            },
            // Statements: a block assigning the value, emitted where the closure runs (closure_in keeps them there).
            Expr::Block(b) => {
                let r = crate::body::inline_block(self, &b.block, want);
                self.unbind(saved);
                return r;
            }
            e => e.clone(),
        };
        let r = self.expr(&body, want);
        self.unbind(saved);
        r
    }

    fn closure_shape(&mut self, c: &syn::ExprClosure, value: &str, shape: &Shape) -> Option<Shape> {
        let saved = self.bind_param(&c.inputs[0], value, shape).ok()?;
        if has_try(&c.body) && !matches!(&*c.body, Expr::Block(_)) {
            let e = &*c.body;
            let block: syn::Block = syn::parse_quote!({ #e });
            let r = crate::body::infer_block_shape(self, &block);
            self.unbind(saved);
            return r;
        }
        let body = match &*c.body {
            Expr::Block(b) if b.block.stmts.len() == 1 && !has_try(&c.body) => match &b.block.stmts[0] {
                // `{ if let .. { Some(x) } else { None } }`: the branches' values, by a dry run.
                Stmt::Expr(e @ (Expr::If(_) | Expr::Match(_)), None) if self.shape_of(e).is_none() => {
                    let r = crate::body::infer_block_shape(self, &b.block);
                    self.unbind(saved);
                    return r;
                }
                Stmt::Expr(e, None) => e.clone(),
                _ => {
                    self.unbind(saved);
                    return None;
                }
            },
            // A body with statements: a dry run of them finds its value's shape.
            Expr::Block(b) => {
                let r = crate::body::infer_block_shape(self, &b.block);
                self.unbind(saved);
                return r;
            }
            // An `if` or `match` body: its branches' values, by the same dry run.
            e @ (Expr::If(_) | Expr::Match(_)) if self.shape_of(e).is_none() => {
                let block: syn::Block = syn::parse_quote!({ #e });
                let r = crate::body::infer_block_shape(self, &block);
                self.unbind(saved);
                return r;
            }
            e => e.clone(),
        };
        let r = self.shape_of(&body);
        self.unbind(saved);
        r
    }

    fn chain(&mut self, mc: &syn::ExprMethodCall, want: &Shape) -> R<String> {
        // Collect the stages from the source outwards.
        let mut stages: Vec<Stage> = Vec::new();
        let mut e: &Expr = &mc.receiver;
        loop {
            match e {
                Expr::MethodCall(m) => {
                    match m.method.to_string().as_str() {
                        "iter" | "into_iter" | "copied" | "cloned" => stages.push(Stage::Pass),
                        "filter" => stages.push(Stage::Filter(Self::closure_of(m.args.first().ok_or("filter")?)?)),
                        "map" => stages.push(Stage::Map(Self::closure_of(m.args.first().ok_or("map")?)?)),
                        "filter_map" => stages.push(Stage::FilterMap(Self::closure_of(m.args.first().ok_or("filter_map")?)?)),
                        "enumerate" => stages.push(Stage::Enumerate),
                        "flat_map" => stages.push(Stage::FlatMap(Self::closure_of(m.args.first().ok_or("flat_map")?)?)),
                        // The source (see `chain_source`).
                        _ => break,
                    }
                    e = &m.receiver;
                }
                Expr::Paren(p) => e = &p.expr,
                _ => break,
            }
        }
        stages.reverse();
        let src_shape = self.shape_of(e).ok_or_else(|| match e {
            Expr::MethodCall(m) => format!("iterator over an untyped collection: method .{}()", m.method),
            Expr::Call(c) => format!("iterator over an untyped collection: call {}", quote::quote!(#c.func).to_string().replace(' ', "")),
            Expr::Field(f) => format!("iterator over an untyped collection: field {}", quote::quote!(#f.member)),
            _ => "iterator over an untyped collection".to_string(),
        })?;
        self.temps += 1;
        let n = self.temps;
        let item = format!("it{n}_");
        // The loop over the source.
        let (head, mut cur_shape) = match &src_shape {
            Shape::Vec(i) | Shape::Array(i, _) => {
                let src = self.expr(e, &src_shape)?;
                (format!("for {item} in {src}"), (**i).clone())
            }
            Shape::PVec(i) => {
                let src = self.expr(e, &src_shape)?;
                (format!("for i{n}_ in 0 ..< {src}.len {{ {item} := pvec_get({src}, i{n}_);"), (**i).clone())
            }
            // An Option: its value, if any, as the one item.
            Shape::Option(i) => {
                let src = self.expr(e, &src_shape)?;
                self.pre.push(format!("os{n}_ := {src}"));
                (format!("for _ in 0 ..< (1 if os{n}_ != nil else 0) {{ {item} := os{n}_.?;"), (**i).clone())
            }
            // A Vec behind a pointer (a Box, or a shared Vec); nil holds nothing.
            Shape::Ptr(p, _) if matches!(**p, Shape::Vec(_)) => {
                let Shape::Vec(i) = &**p else { unreachable!() };
                let src = self.expr(e, &src_shape)?;
                self.pre.push(format!("s{n}_: [dynamic]{}", self.e.odin(i)));
                self.pre.push(format!("if p{n}_ := {src}; p{n}_ != nil do s{n}_ = p{n}_^"));
                (format!("for {item} in s{n}_"), (**i).clone())
            }
            other => return Err(format!("iterator over a non-Vec: {}", crate::body::shape_kind(other))),
        };
        // Heads that bind the item inside the loop open one more block, closed after the step.
        let pvec = matches!(src_shape, Shape::PVec(_) | Shape::Option(_));
        // What the last stage must give, when the terminal fixes it: a collect's item, a find_map's Option. A map or
        // filter_map closure whose own result can't be inferred takes it from here.
        let last_hint: Option<Shape> = match (mc.method.to_string().as_str(), want) {
            ("collect", Shape::Vec(i)) => Some((**i).clone()),
            ("find_map", Shape::Option(i)) => Some((**i).clone()),
            _ => None,
        };
        let last_stage = stages.len().saturating_sub(1);
        // Each stage refines the current value (`cur`) or skips the item.
        let mut body: Vec<String> = Vec::new();
        let mut cur = item.clone();
        // Inner loops opened by flat_map, closed after the terminal's step; the terminals break out of the outer loop
        // by its label.
        let mut inner_loops = 0;
        let outer = format!("ch{n}_");
        for (k, st) in stages.iter().enumerate() {
            match st {
                Stage::Pass => {}
                Stage::Filter(c) => {
                    let cond = self.closure_in(&mut body, c, &cur, &cur_shape, &Shape::Bool)?;
                    body.push(format!("if !({cond}) do continue"));
                }
                Stage::Map(c) => {
                    let out_shape = self
                        .closure_shape(c, &cur, &cur_shape)
                        .or_else(|| if k == last_stage && mc.method != "find_map" { last_hint.clone() } else { None })
                        .ok_or("map closure of an untyped value")?;
                    let v = self.closure_in(&mut body, c, &cur, &cur_shape, &out_shape)?;
                    let next = format!("m{n}_{k}_");
                    body.push(format!("{next} := {v}"));
                    cur = next;
                    cur_shape = out_shape;
                }
                Stage::FilterMap(c) => {
                    let out_shape = self
                        .closure_shape(c, &cur, &cur_shape)
                        .or_else(|| if k == last_stage && mc.method != "find_map" { last_hint.clone().map(|i| Shape::Option(Box::new(i))) } else { None })
                        .ok_or("filter_map closure of an untyped value")?;
                    let Shape::Option(inner) = out_shape else { return Err("filter_map closure not returning Option".into()) };
                    let v = self.closure_in(&mut body, c, &cur, &cur_shape, &Shape::Option(inner.clone()))?;
                    let next = format!("m{n}_{k}_");
                    body.push(format!("{next}, {next}ok := ({v}).?"));
                    body.push(format!("if !{next}ok do continue"));
                    cur = next;
                    cur_shape = *inner;
                }
                Stage::Enumerate => {
                    let (count, next) = (format!("c{n}_{k}_"), format!("m{n}_{k}_"));
                    self.pre.push(format!("{count} := 0"));
                    let ty = self.e.odin(&cur_shape);
                    body.push(format!("{next} := Tuple2(int, {ty}){{{count}, {cur}}}"));
                    body.push(format!("{count} += 1"));
                    cur = next;
                    cur_shape = Shape::Tuple(vec![Shape::Int("int"), cur_shape]);
                }
                Stage::FlatMap(c) => {
                    let out_shape = self.closure_shape(c, &cur, &cur_shape).ok_or("flat_map closure of an untyped value")?;
                    let v = self.closure_in(&mut body, c, &cur, &cur_shape, &out_shape)?;
                    let next = format!("m{n}_{k}_");
                    match out_shape {
                        Shape::Vec(i) => {
                            body.push(format!("fv{n}_{k}_ := {v}"));
                            body.push(format!("for {next} in fv{n}_{k}_ {{"));
                            cur_shape = *i;
                        }
                        Shape::Option(i) => {
                            body.push(format!("if {next}, {next}ok := ({v}).?; {next}ok {{"));
                            cur_shape = *i;
                        }
                        _ => return Err("flat_map closure not returning a Vec or an Option".into()),
                    }
                    cur = next;
                    inner_loops += 1;
                }
            }
        }
        let res = format!("r{n}_");
        let args: Vec<&Expr> = mc.args.iter().collect();
        let (init, step, value) = match mc.method.to_string().as_str() {
            "collect" => {
                let ty = self.e.odin(want);
                // Where it lands: a set collects differently (sorted and deduplicated, or deduplicated) though the
                // model holds both as Vecs. The destination type comes from a turbofish or the context (a let's
                // annotation, the function's result); unseen in a function that uses sets, it is refused.
                let kind = match &mc.turbofish {
                    Some(tf) => set_kind_of(&quote::quote!(#tf).to_string()),
                    None => match COLLECT_INTO.with(|c| c.borrow().clone()) {
                        Some((at, k)) if at == mc as *const syn::ExprMethodCall as usize => k,
                        _ if MENTIONS_SET.with(|m| m.get()) => return Err("collect into a type the translator can't see, in a function using sets".into()),
                        _ => SetKind::NotSet,
                    },
                };
                match want {
                    Shape::Vec(i) => {
                        let i = (**i).clone();
                        match kind {
                            SetKind::NotSet => (format!("{res}: {ty}"), format!("append(&{res}, {cur})"), res.clone()),
                            SetKind::Hash if self.comparable(&i) => (format!("{res}: {ty}"), format!("if !vec_contains({res}[:], {cur}) do append(&{res}, {cur})"), res.clone()),
                            SetKind::Sorted if self.comparable(&i) && self.ordered(&i) => {
                                // Inserted in order, duplicates dropped: what a BTreeSet holds.
                                let step = format!("if !vec_contains({res}[:], {cur}) {{ at{n}_ := len({res}); for e{n}_, k{n}_ in {res} {{ if {cur} < e{n}_ {{ at{n}_ = k{n}_; break }} }}; inject_at(&{res}, at{n}_, {cur}) }}");
                                (format!("{res}: {ty}"), step, res.clone())
                            }
                            _ => return Err("collect into a set of a type Odin can't compare or order".into()),
                        }
                    }
                    _ => return Err("collect into something other than a Vec".into()),
                }
            }
            "any" => {
                let c = Self::closure_of(args.first().ok_or("any")?)?;
                let cond = self.closure_in(&mut body, &c, &cur, &cur_shape, &Shape::Bool)?;
                (format!("{res} := false"), format!("if {cond} {{ {res} = true; break {outer} }}"), res.clone())
            }
            "all" => {
                let c = Self::closure_of(args.first().ok_or("all")?)?;
                let cond = self.closure_in(&mut body, &c, &cur, &cur_shape, &Shape::Bool)?;
                (format!("{res} := true"), format!("if !({cond}) {{ {res} = false; break {outer} }}"), res.clone())
            }
            "find" => {
                let c = Self::closure_of(args.first().ok_or("find")?)?;
                let cond = self.closure_in(&mut body, &c, &cur, &cur_shape, &Shape::Bool)?;
                let ty = self.e.odin(&cur_shape);
                (format!("{res}: Maybe({ty})"), format!("if {cond} {{ {res} = {cur}; break {outer} }}"), res.clone())
            }
            "find_map" => {
                let c = Self::closure_of(args.first().ok_or("find_map")?)?;
                let out_shape = self
                    .closure_shape(&c, &cur, &cur_shape)
                    .or_else(|| last_hint.clone().map(|i| Shape::Option(Box::new(i))))
                    .ok_or("find_map closure of an untyped value")?;
                let v = self.closure_in(&mut body, &c, &cur, &cur_shape, &out_shape)?;
                let ty = self.e.odin(&out_shape);
                (format!("{res}: {ty}"), format!("if fm_ := {v}; fm_ != nil {{ {res} = fm_; break {outer} }}"), res.clone())
            }
            "position" => {
                let c = Self::closure_of(args.first().ok_or("position")?)?;
                let cond = self.closure_in(&mut body, &c, &cur, &cur_shape, &Shape::Bool)?;
                (format!("{res}: Maybe(int); p{n}_ := 0"), format!("if {cond} {{ {res} = p{n}_; break {outer} }}; p{n}_ += 1"), res.clone())
            }
            "count" if args.is_empty() => (format!("{res} := 0"), format!("{res} += 1"), res.clone()),
            "sum" if args.is_empty() => {
                let ty = self.e.odin(&cur_shape);
                (format!("{res}: {ty}"), format!("{res} += {cur}"), res.clone())
            }
            _ => return Err("iterator terminal".into()),
        };
        self.pre.push(init);
        let close = if pvec { "}}" } else { "}" };
        let _ = close;
        let mut lines = vec![format!("{outer}: {head} {{")];
        lines.extend(body);
        lines.push(step);
        for _ in 0..inner_loops {
            lines.push("}".into());
        }
        if pvec {
            lines.push("}}".into());
        } else {
            lines.push("}".into());
        }
        self.pre.push(lines.join("\n"));
        Ok(value)
    }

    /// Types a pending local (see PENDING) from a use that fixes its element type: `push`, `insert`, `contains`,
    /// `extend` on a sequence, a two-argument `insert` on a map.
    fn resolve_pending(&mut self, mc: &syn::ExprMethodCall) {
        let mut recv = &*mc.receiver;
        loop {
            match recv {
                Expr::Reference(r) => recv = &r.expr,
                Expr::Paren(p) => recv = &p.expr,
                _ => break,
            }
        }
        let Expr::Path(p) = recv else { return };
        if p.path.segments.len() != 1 {
            return;
        }
        let name = p.path.segments[0].ident.to_string();
        let Some((odin, Shape::Unknown(u))) = self.vars.get(&name).cloned() else { return };
        let Some(key) = u.strip_prefix(PENDING_TAG).map(str::to_string) else { return };
        let Some((is_map, None)) = PENDING.with(|m| m.borrow().get(&key).cloned()) else { return };
        let args: Vec<&Expr> = mc.args.iter().collect();
        let m = mc.method.to_string();
        let found = match (is_map, m.as_str(), args.len()) {
            (false, "push" | "push_back" | "insert" | "contains", 1) => self.shape_of(args[0]).map(|s| Shape::Vec(Box::new(s))),
            (false, "insert", 2) => self.shape_of(args[1]).map(|s| Shape::Vec(Box::new(s))),
            (false, "extend", 1) => self.chain_item_shape(args[0]).or_else(|| match self.shape_of(args[0]) {
                Some(Shape::Vec(i)) => Some(*i),
                _ => None,
            }).map(|s| Shape::Vec(Box::new(s))),
            (true, "insert", 2) => match (self.shape_of(args[0]), self.shape_of(args[1])) {
                (Some(k), Some(v)) => Some(Shape::Map(Box::new(k), Box::new(v))),
                _ => None,
            },
            _ => None,
        };
        let Some(sh) = found.filter(|s| !shape_has_unknown(s)) else { return };
        PENDING.with(|m| m.borrow_mut().insert(key, (is_map, Some(sh.clone()))));
        let _ = odin;
        if let Some(v) = self.vars.get_mut(&name) {
            v.1 = sh;
        }
    }

    /// Library methods on collections and options, by receiver shape. None when the method isn't one of them.
    fn library_method(&mut self, mc: &syn::ExprMethodCall) -> Option<R<String>> {
        self.resolve_pending(mc);
        let m = mc.method.to_string();
        let recv_shape = self.shape_of(&mc.receiver)?;
        let args: Vec<&Expr> = mc.args.iter().collect();
        let base = match &recv_shape {
            Shape::Ptr(i, _) => (**i).clone(),
            s => s.clone(),
        };
        let deref = if matches!(recv_shape, Shape::Ptr(..)) { "^" } else { "" };
        let (pre_len, temps) = (self.pre.len(), self.temps);
        let r = (|| -> R<String> {
            let recv = self.expr(&mc.receiver, &recv_shape)?;
            Ok(match (m.as_str(), &base, args.len()) {
                ("len", Shape::Vec(_) | Shape::Str | Shape::Map(..), 0) if deref.is_empty() => format!("len({recv})"),
                ("len", Shape::Vec(_) | Shape::Map(..), 0) => format!("(0 if {recv} == nil else len({recv}^))"),
                ("len", Shape::PVec(_), 0) => format!("{recv}.len"),
                ("is_empty", Shape::PVec(_), 0) => format!("({recv}.len == 0)"),
                ("is_empty", Shape::Vec(_) | Shape::Map(..), 0) if !deref.is_empty() => format!("({recv} == nil || len({recv}^) == 0)"),
                ("push", Shape::Vec(i), 1) if deref.is_empty() => {
                    let v = self.expr(args[0], i)?;
                    format!("append(&{recv}, {v})")
                }
                ("contains", Shape::Vec(i), 1) if deref.is_empty() && self.comparable(&i.clone()) => {
                    let v = self.expr(args[0], i)?;
                    format!("vec_contains({recv}[:], {v})")
                }
                // Through a pointer that may be nil (an empty Vec behind a Box): nil holds nothing.
                ("contains", Shape::Vec(i), 1) if self.comparable(&i.clone()) => {
                    let v = self.expr(args[0], i)?;
                    format!("({recv} != nil && vec_contains({recv}^[:], {v}))")
                }
                ("first", Shape::Vec(_), 0) if deref.is_empty() => format!("vec_first({recv}[:])"),
                ("last", Shape::Vec(_), 0) if deref.is_empty() => format!("vec_last({recv}[:])"),
                ("unwrap" | "expect", Shape::Option(_), _) => format!("{recv}.?"),
                ("unwrap_or", Shape::Option(i), 1) => {
                    let d = self.expr(args[0], i)?;
                    format!("({recv}.? or_else {d})")
                }
                ("unwrap_or_default", Shape::Option(i), 0) => {
                    if matches!(**i, Shape::Ptr(..)) && self.e.default_expr(i).is_none() {
                        return Err("default of a shared or boxed value".into());
                    }
                    let d = self.e.default_expr(i).unwrap_or_else(|| format!("{}{{}}", self.e.odin(i)));
                    format!("({recv}.? or_else {d})")
                }
                ("as_ref" | "as_deref" | "copied" | "cloned" | "as_mut", Shape::Option(_), 0) => recv,
                // Option combinators: the closure runs only when there is a value (its statements inside the `if`).
                ("map" | "and_then" | "filter" | "map_or", Shape::Option(i), _) if deref.is_empty() => {
                    let c = Self::closure_of(args[args.len() - 1])?;
                    let out = match m.as_str() {
                        "filter" => recv_shape.clone(),
                        _ => self.shape_of_pub_mc(mc).ok_or("combinator of an untyped value")?,
                    };
                    let n = self.next_temp();
                    let (t, r, v) = (format!("o{n}_"), format!("r{n}_"), format!("v{n}_"));
                    let mut body = Vec::new();
                    let inner_want = match m.as_str() {
                        "map" => match &out {
                            Shape::Option(o) => (**o).clone(),
                            _ => return Err("map result".into()),
                        },
                        "filter" => Shape::Bool,
                        _ => out.clone(),
                    };
                    let val = self.closure_in(&mut body, &c, &v, i, &inner_want)?;
                    let init = if m == "map_or" {
                        let d = self.expr(args[0], &out)?;
                        format!("{r}: {} = {d}", self.e.odin(&out))
                    } else {
                        format!("{r}: {}", self.e.odin(&out))
                    };
                    let set = if m == "filter" { format!("if {val} do {r} = {v}") } else { format!("{r} = {val}") };
                    self.pre.push(format!("{t} := {recv}"));
                    self.pre.push(init);
                    self.pre.push(format!("if {v}, ok{n}_ := {t}.?; ok{n}_ {{\n{}\n{set}\n}}", body.join("\n")));
                    r
                }
                ("ok_or" | "ok_or_else", Shape::Option(i), 1) => {
                    let out = self.shape_of_pub_mc(mc).ok_or("ok_or of an untyped error")?;
                    let Shape::Result(_, err) = &out else { return Err("ok_or result".into()) };
                    let err = (**err).clone();
                    let n = self.next_temp();
                    let (t, r, v) = (format!("o{n}_"), format!("r{n}_"), format!("v{n}_"));
                    let outer = std::mem::take(&mut self.pre);
                    let e = if m == "ok_or" {
                        self.expr(args[0], &err)
                    } else {
                        match args[0] {
                            Expr::Closure(c) if c.inputs.is_empty() && !has_try(&c.body) => self.expr(&c.body, &err),
                            _ => Err("ok_or_else without a closure".into()),
                        }
                    };
                    let body = std::mem::replace(&mut self.pre, outer);
                    let e = e?;
                    let _ = i;
                    self.pre.push(format!("{t} := {recv}"));
                    self.pre.push(format!("{r}: {}", self.e.odin(&out)));
                    self.pre.push(format!("if {v}, ok{n}_ := {t}.?; ok{n}_ {{ {r}.ok = {v} }} else {{\n{}\n{r}.err = {e}\n}}", body.join("\n")));
                    r
                }
                ("map_err", Shape::Result(v, e), 1) => {
                    let c = Self::closure_of(args[0])?;
                    let out = self.shape_of_pub_mc(mc).ok_or("map_err of an untyped error")?;
                    let Shape::Result(_, e2) = &out else { return Err("map_err result".into()) };
                    let (e2, _v) = ((**e2).clone(), v);
                    let n = self.next_temp();
                    let (t, r, x) = (format!("o{n}_"), format!("r{n}_"), format!("e{n}_"));
                    let mut body = Vec::new();
                    let val = self.closure_in(&mut body, &c, &x, e, &e2)?;
                    self.pre.push(format!("{t} := {recv}"));
                    self.pre.push(format!("{r}: {}", self.e.odin(&out)));
                    self.pre.push(format!("{r}.ok = {t}.ok"));
                    self.pre.push(format!("if {x}, f{n}_ := {t}.err.?; f{n}_ {{\n{}\n{r}.err = {val}\n}}", body.join("\n")));
                    r
                }
                ("ok", Shape::Result(_, _), 0) => {
                    let n = self.next_temp();
                    self.pre.push(format!("o{n}_ := {recv}"));
                    format!("(Maybe({})(o{n}_.ok) if o{n}_.err == nil else nil)", self.e.odin(&match &base { Shape::Result(v, _) => (**v).clone(), _ => unreachable!() }))
                }
                ("is_ok", Shape::Result(_, _), 0) => format!("({recv}.err == nil)"),
                ("is_err", Shape::Result(_, _), 0) => format!("({recv}.err != nil)"),
                ("or", Shape::Option(_), 1) => {
                    let d = self.expr(args[0], &base)?;
                    let n = self.next_temp();
                    self.pre.push(format!("r{n}_ := {recv}"));
                    self.pre.push(format!("if r{n}_ == nil do r{n}_ = {d}"));
                    format!("r{n}_")
                }
                ("take", Shape::Option(_), 0) if deref.is_empty() => {
                    let n = self.next_temp();
                    self.pre.push(format!("r{n}_ := {recv}"));
                    self.pre.push(format!("{recv} = nil"));
                    format!("r{n}_")
                }
                ("min" | "max", Shape::Int(_), 1) => {
                    let b = self.expr(args[0], &base)?;
                    format!("{m}({recv}, {b})")
                }
                // Unsigned only: a signed saturating subtraction clamps at the type's minimum instead.
                ("saturating_sub", Shape::Int(t), 1) if t.starts_with('u') || *t == "int" => {
                    let b = self.expr(args[0], &base)?;
                    let n = self.next_temp();
                    self.pre.push(format!("a{n}_, b{n}_ := {recv}, {b}"));
                    format!("(a{n}_ - b{n}_ if a{n}_ > b{n}_ else 0)")
                }
                ("abs", Shape::Int(t), 0) if t.starts_with('i') => format!("abs({recv})"),
                ("to_vec", Shape::Vec(_), 0) => match self.e.cloner(&base) {
                    Some(c) => format!("{c}({recv})"),
                    None => recv,
                },
                // A set (a Vec in the model) removes by value and says whether it held it; a Vec removes by index.
                ("remove", Shape::Vec(i), 1) if deref.is_empty() && self.set_kind(&mc.receiver).is_some_and(|k| k != SetKind::NotSet) => {
                    if !self.comparable(&i.clone()) {
                        return Err("set of a type Odin can't compare".into());
                    }
                    let v = self.expr(args[0], i)?;
                    let n = self.next_temp();
                    self.pre.push(format!("sv{n}_ := {v}"));
                    self.pre.push(format!("sr{n}_ := false"));
                    self.pre.push(format!("for e{n}_, k{n}_ in {recv} {{ if e{n}_ == sv{n}_ {{ ordered_remove(&{recv}, k{n}_); sr{n}_ = true; break }} }}"));
                    format!("sr{n}_")
                }
                ("remove", Shape::Vec(_), 1) if deref.is_empty() => {
                    if self.set_kind(&mc.receiver) != Some(SetKind::NotSet) {
                        return Err("remove on a collection that may be a set".into());
                    }
                    let ix = self.expr(args[0], &Shape::Int("int"))?;
                    let n = self.next_temp();
                    self.pre.push(format!("i{n}_ := {ix}"));
                    self.pre.push(format!("r{n}_ := {recv}[i{n}_]"));
                    self.pre.push(format!("ordered_remove(&{recv}, i{n}_)"));
                    format!("r{n}_")
                }
                ("pop", Shape::Vec(i), 0) if deref.is_empty() => {
                    let n = self.next_temp();
                    self.pre.push(format!("r{n}_: Maybe({})", self.e.odin(i)));
                    self.pre.push(format!("if x{n}_, ok{n}_ := pop_safe(&{recv}); ok{n}_ do r{n}_ = x{n}_"));
                    format!("r{n}_")
                }
                ("clear", Shape::Vec(_), 0) if deref.is_empty() => format!("clear(&{recv})"),
                // A pointer to an element, or nil: Option<&mut T>.
                ("get_mut", Shape::Vec(i), 1) => {
                    let ix = self.expr(args[0], &Shape::Int("int"))?;
                    let n = self.next_temp();
                    let v = format!("{recv}{deref}");
                    self.pre.push(format!("gm{n}_: Maybe(^{})", self.e.odin(i)));
                    self.pre.push(format!("if i{n}_ := {ix}; i{n}_ >= 0 && i{n}_ < len({v}) do gm{n}_ = &{v}[i{n}_]"));
                    format!("gm{n}_")
                }
                ("first_mut" | "last_mut", Shape::Vec(i), 0) => {
                    let n = self.next_temp();
                    let v = format!("{recv}{deref}");
                    let at = if m == "first_mut" { "0".to_string() } else { format!("len({v}) - 1") };
                    self.pre.push(format!("gm{n}_: Maybe(^{})", self.e.odin(i)));
                    self.pre.push(format!("if len({v}) > 0 do gm{n}_ = &{v}[{at}]"));
                    format!("gm{n}_")
                }
                // A map's insert returns the value it replaced.
                ("insert", Shape::Map(k, v), 2) if deref.is_empty() => {
                    let (key, val) = (self.expr(args[0], k)?, self.expr(args[1], v)?);
                    let n = self.next_temp();
                    self.pre.push(format!("mk{n}_, mv{n}_ := {key}, {val}"));
                    self.pre.push(format!("old{n}_: Maybe({})", self.e.odin(v)));
                    self.pre.push(format!("if x{n}_, ok{n}_ := {recv}[mk{n}_]; ok{n}_ do old{n}_ = x{n}_"));
                    self.pre.push(format!("{recv}[mk{n}_] = mv{n}_"));
                    format!("old{n}_")
                }
                ("remove", Shape::Map(k, v), 1) if deref.is_empty() => {
                    let key = self.expr(args[0], k)?;
                    let n = self.next_temp();
                    self.pre.push(format!("mk{n}_ := {key}"));
                    self.pre.push(format!("old{n}_: Maybe({})", self.e.odin(v)));
                    self.pre.push(format!("if x{n}_, ok{n}_ := {recv}[mk{n}_]; ok{n}_ do old{n}_ = x{n}_"));
                    self.pre.push(format!("delete_key(&{recv}, mk{n}_)"));
                    format!("old{n}_")
                }
                // A set (a Vec in the model) inserts only what it doesn't hold, and says whether it did.
                // A BTreeSet stays sorted (its iteration order is observable); a HashSet's order isn't (random hashing
                // in Rust), so insertion order stands in for it.
                ("insert", Shape::Vec(i), 1) if deref.is_empty() && self.comparable(&i.clone()) && self.set_kind(&mc.receiver) == Some(SetKind::Sorted) => {
                    if !self.ordered(&i.clone()) {
                        return Err("sorted set of a type Odin can't order".into());
                    }
                    let v = self.expr(args[0], i)?;
                    let n = self.next_temp();
                    self.pre.push(format!("sv{n}_ := {v}"));
                    self.pre.push(format!("si{n}_ := !vec_contains({recv}[:], sv{n}_)"));
                    self.pre.push(format!("if si{n}_ {{ at{n}_ := len({recv}); for e{n}_, k{n}_ in {recv} {{ if sv{n}_ < e{n}_ {{ at{n}_ = k{n}_; break }} }}; inject_at(&{recv}, at{n}_, sv{n}_) }}"));
                    format!("si{n}_")
                }
                ("insert", Shape::Vec(i), 1) if deref.is_empty() && self.comparable(&i.clone()) && self.set_kind(&mc.receiver) == Some(SetKind::Hash) => {
                    let v = self.expr(args[0], i)?;
                    let n = self.next_temp();
                    self.pre.push(format!("sv{n}_ := {v}"));
                    self.pre.push(format!("si{n}_ := !vec_contains({recv}[:], sv{n}_)"));
                    self.pre.push(format!("if si{n}_ do append(&{recv}, sv{n}_)"));
                    format!("si{n}_")
                }
                ("insert", Shape::Vec(i), 2) if deref.is_empty() => {
                    let ix = self.expr(args[0], &Shape::Int("int"))?;
                    let v = self.expr(args[1], i)?;
                    format!("inject_at(&{recv}, {ix}, {v})")
                }
                // `b.then_some(x)` evaluates x either way; `b.then(|| x)` only when b holds.
                ("then_some", Shape::Bool, 1) => {
                    let Some(Shape::Option(i)) = self.shape_of_pub_mc(mc) else { return Err("then_some of an untyped value".into()) };
                    let v = self.expr(args[0], &i)?;
                    let n = self.next_temp();
                    self.pre.push(format!("ts{n}_ := {v}"));
                    format!("(Maybe({})(ts{n}_) if {recv} else nil)", self.e.odin(&i))
                }
                ("then", Shape::Bool, 1) => {
                    let Some(Shape::Option(i)) = self.shape_of_pub_mc(mc) else { return Err("then of an untyped value".into()) };
                    let Expr::Closure(c) = args[0] else { return Err("then without a closure".into()) };
                    if has_try(&c.body) {
                        return Err("? inside a closure".into());
                    }
                    let n = self.next_temp();
                    let outer = std::mem::take(&mut self.pre);
                    let v = self.expr(&c.body, &i);
                    let inner = std::mem::replace(&mut self.pre, outer);
                    let v = v?;
                    self.pre.push(format!("tt{n}_: Maybe({})", self.e.odin(&i)));
                    self.pre.push(format!("if {recv} {{\n{}\ntt{n}_ = {v}\n}}", inner.join("\n")));
                    format!("tt{n}_")
                }
                // `v.retain(|x| keep)`: kept elements moved down in order, the rest cut off.
                ("retain", Shape::Vec(i), 1) if deref.is_empty() => {
                    let c = Self::closure_of(args[0])?;
                    let n = self.next_temp();
                    let (w, k, x) = (format!("w{n}_"), format!("k{n}_"), format!("x{n}_"));
                    let mut body = Vec::new();
                    let keep = self.closure_in(&mut body, &c, &x, i, &Shape::Bool)?;
                    self.pre.push(format!("{w} := 0"));
                    self.pre.push(format!("for {k} in 0 ..< len({recv}) {{\n{x} := {recv}[{k}]\n{}\nif {keep} {{ {recv}[{w}] = {recv}[{k}]; {w} += 1 }}\n}}", body.join("\n")));
                    format!("resize(&{recv}, {w})")
                }
                // `Definitions<T>` (`Arc<Vec<T>>`, a distinct `^[dynamic]T` in the model; nil reads as empty): its
                // definitions, ungated, for reading.
                ("iter_all" | "iter_unchecked" | "as_slice", Shape::Named(dn, _), 0) if self.definitions_item(dn).is_some() => {
                    let item = self.definitions_item(dn).unwrap_or(Shape::Unit);
                    let n = self.next_temp();
                    self.pre.push(format!("d{n}_: [dynamic]{}", self.e.odin(&item)));
                    self.pre.push(format!("if p{n}_ := {recv}{deref}; p{n}_ != nil do d{n}_ = p{n}_^"));
                    format!("d{n}_")
                }
                // An iterator over a Vec, taken whole: the Vec (translated logic materializes iterators).
                ("iter" | "into_iter", Shape::Vec(_), 0) if deref.is_empty() => recv,
                ("as_deref" | "as_ref", Shape::OptPtr(..), 0) => recv,
                ("extend", Shape::Vec(i), 1) if deref.is_empty() && self.set_kind(&mc.receiver) == Some(SetKind::NotSet) => {
                    let items = self.expr(args[0], &Shape::Vec(i.clone()))?;
                    let n = self.next_temp();
                    self.pre.push(format!("x{n}_ := {items}"));
                    format!("append(&{recv}, ..x{n}_[:])")
                }
                ("get", Shape::Vec(i), 1) => {
                    let ix = self.expr(args[0], &Shape::Int("int"))?;
                    let n = self.next_temp();
                    let v = format!("{recv}{deref}");
                    self.pre.push(format!("g{n}_: Maybe({})", self.e.odin(i)));
                    let nil_check = if deref.is_empty() { String::new() } else { format!("{recv} != nil && ") };
                    self.pre.push(format!("if i{n}_ := {ix}; {nil_check}i{n}_ >= 0 && i{n}_ < len({v}) do g{n}_ = {v}[i{n}_]"));
                    format!("g{n}_")
                }
                ("get", Shape::Map(k, v), 1) => {
                    let key = self.expr(args[0], k)?;
                    let n = self.next_temp();
                    let m = format!("{recv}{deref}");
                    self.pre.push(format!("g{n}_: Maybe({})", self.e.odin(v)));
                    let lookup = format!("if x{n}_, ok{n}_ := {m}[{key}]; ok{n}_ do g{n}_ = x{n}_");
                    self.pre.push(if deref.is_empty() { lookup } else { format!("if {recv} != nil {{\n{lookup}\n}}") });
                    format!("g{n}_")
                }
                // The closure runs only when the value is absent; its statements go inside the `if`.
                ("unwrap_or_else", Shape::Option(i), 1) => {
                    let Expr::Closure(c) = args[0] else { return Err("unwrap_or_else without a closure".into()) };
                    if !c.inputs.is_empty() {
                        return Err("unwrap_or_else closure with arguments".into());
                    }
                    if has_try(&c.body) || crate::closures::has_return(&c.body) {
                        return Err("? or return inside a closure".into());
                    }
                    let n = self.next_temp();
                    let ty = self.e.odin(i);
                    let outer = std::mem::take(&mut self.pre);
                    let d = self.expr(&c.body, i);
                    let inner = std::mem::replace(&mut self.pre, outer);
                    let d = d?;
                    self.pre.push(format!("r{n}_: {ty}"));
                    self.pre.push(format!("if v{n}_, ok{n}_ := {recv}.?; ok{n}_ {{\nr{n}_ = v{n}_\n}} else {{\n{}\nr{n}_ = {d}\n}}", inner.join("\n")));
                    format!("r{n}_")
                }
                ("or_else", Shape::Option(_), 1) => {
                    let Expr::Closure(c) = args[0] else { return Err("or_else without a closure".into()) };
                    if !c.inputs.is_empty() {
                        return Err("or_else closure with arguments".into());
                    }
                    if has_try(&c.body) {
                        return Err("? inside a closure".into());
                    }
                    let n = self.next_temp();
                    let outer = std::mem::take(&mut self.pre);
                    let d = self.expr(&c.body, &base);
                    let inner = std::mem::replace(&mut self.pre, outer);
                    let d = d?;
                    self.pre.push(format!("r{n}_ := {recv}"));
                    self.pre.push(format!("if r{n}_ == nil {{\n{}\nr{n}_ = {d}\n}}", inner.join("\n")));
                    format!("r{n}_")
                }
                // A slice of a Vec reads like the Vec itself here (len, indexing, iteration).
                ("as_slice", Shape::Vec(_), 0) => recv,
                // The closure runs only on a present value; its statements go inside the `if`.
                ("is_some_and", Shape::Option(i), 1) | ("is_none_or", Shape::Option(i), 1) => {
                    let c = Self::closure_of(args[0])?;
                    let n = self.next_temp();
                    let (t, v, r) = (format!("o{n}_"), format!("v{n}_"), format!("r{n}_"));
                    let mut body = Vec::new();
                    let cond = self.closure_in(&mut body, &c, &v, i, &Shape::Bool)?;
                    self.pre.push(format!("{t} := {recv}"));
                    self.pre.push(format!("{r} := {}", if m == "is_some_and" { "false" } else { "true" }));
                    self.pre.push(format!("if {v}, ok{n}_ := {t}.?; ok{n}_ {{\n{}\n{r} = {cond}\n}}", body.join("\n")));
                    r
                }
                _ => return Err(String::new()),
            })
        })();
        match r {
            Err(e) if e.is_empty() => {
                // Not a library method: undo whatever translating the receiver hoisted.
                self.pre.truncate(pre_len);
                self.temps = temps;
                None
            }
            other => Some(other),
        }
    }
}

/// The prefix of a pending local's placeholder shape (`Shape::Unknown("pending:<odin name>")`).
pub const PENDING_TAG: &str = "pending:";

fn shape_has_unknown(s: &Shape) -> bool {
    match s {
        Shape::Unknown(_) | Shape::Param(_) => true,
        Shape::Option(i) | Shape::OptPtr(i, _) | Shape::Ptr(i, _) | Shape::Vec(i) | Shape::PVec(i) | Shape::Array(i, _) | Shape::MutRef(i) => shape_has_unknown(i),
        Shape::Result(a, b) | Shape::Map(a, b) => shape_has_unknown(a) || shape_has_unknown(b),
        Shape::Tuple(v) | Shape::Named(_, v) => v.iter().any(shape_has_unknown),
        _ => false,
    }
}

/// Whether a shape involves a type parameter.
fn shape_mentions_param(s: &Shape) -> bool {
    match s {
        Shape::Param(_) => true,
        Shape::Option(i) | Shape::OptPtr(i, _) | Shape::Ptr(i, _) | Shape::Vec(i) | Shape::PVec(i) | Shape::Array(i, _) => shape_mentions_param(i),
        Shape::Result(a, b) | Shape::Map(a, b) => shape_mentions_param(a) || shape_mentions_param(b),
        Shape::Tuple(v) => v.iter().any(shape_mentions_param),
        Shape::Named(_, a) => a.iter().any(shape_mentions_param),
        _ => false,
    }
}

/// A shape with `Self` replaced by the impl's type (None without an owner to replace it with).
fn subst_self(s: Shape, owner: Option<&str>) -> Option<Shape> {
    let b = |s: Box<Shape>| -> Option<Box<Shape>> { Some(Box::new(subst_self(*s, owner)?)) };
    Some(match s {
        Shape::Named(n, _) | Shape::Unknown(n) if n == "Self" => Shape::Named(owner?.to_string(), vec![]),
        Shape::Option(i) => Shape::Option(b(i)?),
        Shape::Vec(i) => Shape::Vec(b(i)?),
        Shape::PVec(i) => Shape::PVec(b(i)?),
        Shape::Ptr(i, sh) => Shape::Ptr(b(i)?, sh),
        Shape::OptPtr(i, sh) => Shape::OptPtr(b(i)?, sh),
        Shape::Result(a, e) => Shape::Result(b(a)?, b(e)?),
        Shape::Map(k, v) => Shape::Map(b(k)?, b(v)?),
        Shape::Tuple(v) => Shape::Tuple(v.into_iter().map(|x| subst_self(x, owner)).collect::<Option<Vec<_>>>()?),
        s => s,
    })
}

/// Whether an expression uses `?` outside any nested closure.
fn has_try(e: &Expr) -> bool {
    struct V(bool);
    impl<'ast> syn::visit::Visit<'ast> for V {
        fn visit_expr_try(&mut self, _: &'ast syn::ExprTry) {
            self.0 = true;
        }
        fn visit_expr_closure(&mut self, _: &'ast syn::ExprClosure) {}
    }
    let mut v = V(false);
    syn::visit::visit_expr(&mut v, e);
    v.0
}

/// Binds the type parameters a Rust type mentions to the parts of a shape at the same place (`&[T]` against a Vec
/// of X binds T = X).
fn unify(ty: &syn::Type, sh: &Shape, tparams: &[String], out: &mut BTreeMap<String, Shape>) {
    match ty {
        syn::Type::Reference(r) => unify(&r.elem, sh, tparams, out),
        syn::Type::Paren(p) => unify(&p.elem, sh, tparams, out),
        syn::Type::Slice(s) => {
            if let Shape::Vec(i) | Shape::PVec(i) = sh {
                unify(&s.elem, i, tparams, out);
            }
        }
        syn::Type::Tuple(t) => {
            if let Shape::Tuple(es) = sh {
                for (e, s) in t.elems.iter().zip(es) {
                    unify(e, s, tparams, out);
                }
            }
        }
        syn::Type::Path(p) => {
            let Some(seg) = p.path.segments.last() else { return };
            let name = seg.ident.to_string();
            if p.path.segments.len() == 1 && tparams.contains(&name) && seg.arguments.is_empty() {
                if !matches!(sh, Shape::Unit) {
                    out.entry(name).or_insert_with(|| sh.clone());
                }
                return;
            }
            let syn::PathArguments::AngleBracketed(a) = &seg.arguments else { return };
            let inner: Vec<&syn::Type> = a.args.iter().filter_map(|g| if let syn::GenericArgument::Type(t) = g { Some(t) } else { None }).collect();
            match (name.as_str(), sh, inner.as_slice()) {
                ("Vec" | "VecDeque", Shape::Vec(i), [t]) | ("Vector", Shape::PVec(i), [t]) | ("Option", Shape::Option(i), [t]) => unify(t, i, tparams, out),
                ("Box" | "Arc" | "Rc", Shape::Ptr(i, _), [t]) => unify(t, i, tparams, out),
                ("Result", Shape::Result(v, e), [t, u]) => {
                    unify(t, v, tparams, out);
                    unify(u, e, tparams, out);
                }
                ("HashMap" | "BTreeMap" | "FxHashMap", Shape::Map(k, v), [t, u]) => {
                    unify(t, k, tparams, out);
                    unify(u, v, tparams, out);
                }
                _ => {}
            }
        }
        _ => {}
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum SetKind {
    NotSet,
    Sorted,
    Hash,
}

/// The set kind a Rust type's text names (a sequence type is NotSet).
pub fn set_kind_of(ty: &str) -> SetKind {
    if ty.contains("BTreeSet") || ty.contains("OrdSet") {
        SetKind::Sorted
    } else if ty.contains("HashSet") || ty.contains("IndexSet") {
        SetKind::Hash
    } else {
        SetKind::NotSet
    }
}

/// Runs `f` with the destination of a collect that is exactly `e` known (a let's annotation, a function's result).
pub fn with_collect_target<T>(e: &Expr, rust_ty: Option<&str>, f: impl FnOnce() -> T) -> T {
    let target = match (e, rust_ty) {
        (Expr::MethodCall(mc), Some(t)) if mc.method == "collect" => Some((mc as *const syn::ExprMethodCall as usize, set_kind_of(t))),
        _ => None,
    };
    let saved = COLLECT_INTO.with(|c| std::mem::replace(&mut *c.borrow_mut(), target));
    let r = f();
    COLLECT_INTO.with(|c| *c.borrow_mut() = saved);
    r
}
