//! Whole-function translation (docs/odin-port.md, "The translator's next layer"): a Rust function becomes an Odin
//! procedure, statement by statement, on top of the expression translator (translate.rs, in call mode). Anything it
//! doesn't handle is refused with the construct that stopped it, which `odingen translate-report` ranks; nothing is
//! guessed.

use std::collections::{BTreeMap, BTreeSet};

use quote::ToTokens;
use std::fmt::Write;

use syn::{Block, Expr, FnArg, Pat, ReturnType, Stmt};

use crate::emit::{Emitter, Shape};
use crate::model::{Fields, FnDef};
use crate::translate::{proc_name, proc_name_for, Tx};

type R<T> = Result<T, String>;

pub struct Translated {
    pub name: String,
    pub code: String,
    /// Reads or writes a field the Rust engine doesn't serialize (directly; callees are checked on their own).
    pub touches_unlogged: bool,
}

/// The Odin signature of a function (`(params) -> ret`), and the Rust `mut` parameters needing a local copy.
fn signature(tx: &mut Tx, owner: Option<&str>, f: &FnDef) -> R<(String, Shape, Vec<String>)> {
    signature_with(tx, owner, f, &[])
}

/// The signature with extra parameters at the end (a closure instance's captures).
fn signature_with(tx: &mut Tx, owner: Option<&str>, f: &FnDef, extra: &[String]) -> R<(String, Shape, Vec<String>)> {
    let mut params = Vec::new();
    let mut mut_params = Vec::new();
    for input in &f.sig.inputs {
        match input {
            FnArg::Receiver(rc) => {
                let o = owner.ok_or("self outside an impl")?;
                if !tx.e.emitted.contains(o) {
                    return Err(format!("type outside the model ({o})"));
                }
                let sh = Shape::Named(o.to_string(), vec![]);
                let mut_ref = rc.reference.is_some() && rc.mutability.is_some();
                let ty = tx.e.odin(&sh);
                params.push(format!("self_: {}{ty}", if mut_ref { "^" } else { "" }));
                if rc.reference.is_none() && rc.mutability.is_some() {
                    mut_params.push("self_".to_string());
                }
                // `&mut self` is `^T`: its uses go through it, like a `&mut` parameter's.
                tx.vars.insert("self".into(), (if mut_ref { "self_^".into() } else { "self_".into() }, sh));
            }
            FnArg::Typed(pt) => {
                let Pat::Ident(pi) = &*pt.pat else { return Err("parameter pattern".into()) };
                let pname = pi.ident.to_string();
                let sh = self_shape(tx, &pt.ty, owner).map_err(|e| format!("parameter: {e}"))?;
                let mut_ref = matches!(&*pt.ty, syn::Type::Reference(r) if r.mutability.is_some());
                let ident = local_ident(&pname);
                params.push(format!("{ident}: {}{}", if mut_ref { "^" } else { "" }, tx.e.odin(&sh)));
                if pi.mutability.is_some() {
                    mut_params.push(ident.clone());
                }
                // A `&mut T` parameter is `^T`; its uses read and write through it (`*p = v` is `p^ = v`).
                let use_expr = if mut_ref { format!("{ident}^") } else { ident };
                tx.vars.insert(pname, (use_expr, sh));
            }
        }
    }
    // `&mut T` / `Option<&mut T>` results are pointers into the caller's data (MutRef); other borrowed-mutable
    // results (in tuples, iterators) aren't handled.
    let mut_ret = match &f.sig.output {
        ReturnType::Type(_, t) => tx.mut_ref_result(t, owner),
        ReturnType::Default => None,
    };
    if mut_ret.is_none() && matches!(&f.sig.output, ReturnType::Type(_, t) if returns_mut_ref(t)) {
        return Err("returns a mutable reference".into());
    }
    let ret = match &f.sig.output {
        _ if mut_ret.is_some() => mut_ret.clone().unwrap(),
        ReturnType::Default => Shape::Unit,
        ReturnType::Type(_, t) => self_shape(tx, t, owner).map_err(|e| format!("return {e}"))?,
    };
    params.extend(extra.iter().cloned());
    let ret_ty = if matches!(ret, Shape::Unit) { String::new() } else { format!(" -> {}", tx.e.odin(&ret)) };
    Ok((format!("({}){ret_ty}", params.join(", ")), ret, mut_params))
}

/// A stand-in for a function not translated yet, with its real signature, so translated callers type-check;
/// calling it stops the program, naming the function.
pub fn stub_fn(e: &mut Emitter, owner: Option<&str>, name: &str, f: &FnDef, why: &str) -> R<Translated> {
    if generic_kind(&f.sig).is_some() || owner.and_then(|o| e.def(o)).is_some_and(|d| !d.generics.is_empty()) {
        return Err("generic function".into());
    }
    let mut tx = Tx { e, vars: BTreeMap::new(), self_ty: owner.map(str::to_string), depth: 0, calls: true, pre: Vec::new(), fn_ret: Shape::Unit, temps: 0 };
    let (sig, ret, _) = signature(&mut tx, owner, f)?;
    let pname = proc_name_for(owner, name, f);
    let msg = crate::translate::odin_string(&format!("not translated yet: {pname} ({why})"));
    let zero = if matches!(ret, Shape::Unit) { "return".to_string() } else { format!("z_: {}; return z_", tx.e.odin(&ret)) };
    Ok(Translated {
        touches_unlogged: false,
        name: pname.clone(),
        code: format!("{pname} :: proc{sig} {{\n\twhen VECTOR {{\n\t\tvector_stub_hit = {:?}\n\t\tif vector_on_stub != nil do vector_on_stub(vector_stub_hit)\n\t\t{zero}\n\t}}\n\tpanic({msg})\n}}\n", pname),
    })
}

struct Body<'t, 'a, 'b> {
    tx: &'t mut Tx<'a, 'b>,
    out: String,
    indent: usize,
    ret: Shape,
    /// Odin names declared in this procedure: a Rust shadowing `let` gets a fresh one (`x_2`).
    declared: std::collections::BTreeSet<String>,
    /// Where tail values go: None is the function's result (`return v`); Some is a local that a value-position
    /// `if`/`match`/block initializes (`let x = match ..`), each branch assigning it.
    target: Option<Target>,
    /// The enclosing loops, innermost last: (Rust label, Odin label). Every loop is labelled and every `break` and
    /// `continue` names its loop, because in Odin an unlabelled `break` inside a `switch` leaves only the switch.
    loops: Vec<(Option<String>, String)>,
}

struct Target {
    ident: String,
    /// The local's shape; None while a dry run (`infer`) is still looking for it.
    shape: Option<Shape>,
    /// The shape came from an unsuffixed integer literal, which another branch's typed value overrides.
    weak: bool,
    /// A dry run: branches emit nothing and the first typed tail value sets `shape`.
    infer: bool,
}

thread_local! {
    /// The Rust result type of the function being translated (a collect in a result lands there).
    static RET_TEXT: std::cell::RefCell<Option<String>> = const { std::cell::RefCell::new(None) };
    /// Procedures whose translation Odin rejected (ODINGEN_DENY, a file of names, one per line): stubbed instead,
    /// until the translator handles what tripped them (odin/tools/translate-loop.sh).
    static DENY: std::collections::BTreeSet<String> = std::env::var("ODINGEN_DENY")
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
        .unwrap_or_default();
}

pub fn translate_fn(e: &mut Emitter, owner: Option<&str>, name: &str, f: &FnDef) -> R<Translated> {
    // A fresh procedure: no closures in scope, no instances being made around it.
    let saved = crate::closures::CLOSURES.with(|c| std::mem::take(&mut *c.borrow_mut()));
    let r = translate_fn_with(e, owner, name, f, None, &[]);
    crate::closures::CLOSURES.with(|c| *c.borrow_mut() = saved);
    r
}

/// A function translated under another procedure name (a closure instance), with extra parameters at the end.
/// Its own `?` returns from it, even when an instance is made from inside a closure body elsewhere.
fn translate_fn_with(e: &mut Emitter, owner: Option<&str>, name: &str, f: &FnDef, pname_override: Option<&str>, extra: &[String]) -> R<Translated> {
    // Performance counters (game/perf_counters.rs) are thread-local diagnostics only tests read: recording into
    // one changes no game. Their unit-returning procedures are translated with empty bodies.
    let emptied;
    let f = if f.file.to_string_lossy().ends_with("game/perf_counters.rs") && matches!(f.sig.output, ReturnType::Default) {
        let mut g = f.clone();
        g.block = syn::parse_quote!({});
        emptied = g;
        &emptied
    } else {
        f
    };
    let saved_exit = crate::translate::TRY_EXIT.with(|t| t.replace(None));
    let saved_return = crate::translate::RETURN_EXIT.with(|t| t.replace(None));
    let saved_pending = crate::translate::PENDING.with(|p| std::mem::take(&mut *p.borrow_mut()));
    let saved_names = PROC_NAMES.with(|p| std::mem::take(&mut *p.borrow_mut()));
    let r = translate_fn_inner(e, owner, name, f, pname_override, extra);
    crate::translate::TRY_EXIT.with(|t| t.replace(saved_exit));
    crate::translate::RETURN_EXIT.with(|t| t.replace(saved_return));
    crate::translate::PENDING.with(|p| *p.borrow_mut() = saved_pending);
    PROC_NAMES.with(|p| *p.borrow_mut() = saved_names);
    r
}

fn translate_fn_inner(e: &mut Emitter, owner: Option<&str>, name: &str, f: &FnDef, pname_override: Option<&str>, extra: &[String]) -> R<Translated> {
    if pname_override.is_some_and(|p| DENY.with(|d| d.contains(p))) {
        return Err("translation rejected by the Odin type check".into());
    }
    if DENY.with(|d| d.contains(&proc_name_for(owner, name, f))) && pname_override.is_none() {
        return Err("translation rejected by the Odin type check".into());
    }
    if crate::translate::COLLIDING.with(|c| c.borrow().contains(&proc_name_for(owner, name, f))) {
        return Err("procedure name shared by two functions".into());
    }
    crate::translate::CURRENT_FILE.with(|c| *c.borrow_mut() = Some(f.file.clone()));
    crate::translate::TOUCHES_UNLOGGED.with(|t| t.set(false));
    // Lifetime parameters don't exist in Odin; type and const parameters need monomorphizing (not done yet).
    if let Some(k) = generic_kind(&f.sig) {
        return Err(format!("generic function: {k}"));
    }
    if owner.and_then(|o| e.def(o)).is_some_and(|d| !d.generics.is_empty()) {
        return Err("method of a generic type".into());
    }
    if f.sig.asyncness.is_some() || f.sig.unsafety.is_some() {
        return Err("async or unsafe function".into());
    }
    // The model holds sets as Vecs: a collect could land in a set (needing sorting or deduplication) through a
    // type the translator doesn't see; refused rather than guessed.
    let body_text = f.block.to_token_stream().to_string();
    let sig_text = f.sig.to_token_stream().to_string();
    let names_a_set = |t: &str| t.split(|c: char| !c.is_alphanumeric() && c != '_').any(|w| matches!(w, "BTreeSet" | "HashSet" | "IndexSet" | "OrdSet" | "FxHashSet"));
    let saved_mentions = crate::translate::MENTIONS_SET.with(|m| m.replace(names_a_set(&body_text) || names_a_set(&sig_text)));
    let saved_ret_text = RET_TEXT.with(|r| r.replace(match &f.sig.output {
        ReturnType::Type(_, t) => Some(t.to_token_stream().to_string()),
        ReturnType::Default => None,
    }));
    let mut rust_types = BTreeMap::new();
    for input in &f.sig.inputs {
        if let FnArg::Typed(pt) = input {
            if let Pat::Ident(pi) = &*pt.pat {
                rust_types.insert(pi.ident.to_string(), pt.ty.to_token_stream().to_string());
            }
        }
    }
    let saved_types = crate::translate::RUST_TYPES.with(|t| std::mem::replace(&mut *t.borrow_mut(), rust_types));
    let mut tx = Tx { e, vars: BTreeMap::new(), self_ty: owner.map(str::to_string), depth: 0, calls: true, pre: Vec::new(), fn_ret: Shape::Unit, temps: 0 };
    let sig_r = signature_with(&mut tx, owner, f, extra);
    let (sig, ret, mut_params) = match sig_r {
        Ok(x) => x,
        Err(e) => {
            crate::translate::RUST_TYPES.with(|t| *t.borrow_mut() = saved_types);
            crate::translate::MENTIONS_SET.with(|m| m.set(saved_mentions));
            RET_TEXT.with(|r| r.replace(saved_ret_text));
            return Err(e);
        }
    };
    tx.fn_ret = ret.clone();
    // Immutable parameters can't be pointed to: closures capture them by value (closures.rs).
    let by_value: BTreeSet<String> = tx
        .vars
        .values()
        .map(|(o, _)| o.clone())
        .filter(|o| !o.ends_with('^') && !mut_params.contains(o))
        .chain(extra.iter().filter(|p| !p.contains(": ^")).filter_map(|p| p.split(':').next().map(|x| x.trim().to_string())))
        .collect();
    let saved_by_value = crate::closures::BY_VALUE.with(|b| std::mem::replace(&mut *b.borrow_mut(), by_value));
    // `Self` in the body's types (`let x: Self`, `Vec<Self>`) is the impl's type.
    let saved_subst = tx.e.subst.clone();
    if let Some(o) = owner {
        tx.e.subst.insert("Self".into(), Shape::Named(o.to_string(), vec![]));
    }
    let pname = pname_override.map(str::to_string).unwrap_or_else(|| proc_name_for(owner, name, f));
    let mut b = Body { tx: &mut tx, out: String::new(), indent: 1, ret, declared: Default::default(), target: None, loops: Vec::new() };
    for (_, (odin, _)) in b.tx.vars.clone() {
        b.declared.insert(odin.trim_end_matches('^').to_string());
        PROC_NAMES.with(|p| p.borrow_mut().insert(odin.trim_end_matches('^').to_string()));
    }
    // Odin parameters can't be assigned; a Rust `mut` parameter is a local copy.
    for p in &mut_params {
        b.line(&format!("{p} := {p}"));
    }
    let r = b.block(&f.block, true);
    let out = std::mem::take(&mut b.out);
    tx.e.subst = saved_subst;
    crate::closures::BY_VALUE.with(|b| *b.borrow_mut() = saved_by_value);
    crate::translate::RUST_TYPES.with(|t| *t.borrow_mut() = saved_types);
    crate::translate::MENTIONS_SET.with(|m| m.set(saved_mentions));
    RET_TEXT.with(|r| r.replace(saved_ret_text));
    r?;
    // Pending locals (translate.rs, PENDING) get the type a use gave them; one no use typed is refused.
    let mut out = out;
    for (ident, (_, sh)) in crate::translate::PENDING.with(|p| p.borrow().clone()) {
        let marker = pending_marker(&ident);
        if !out.contains(&marker) {
            continue;
        }
        match sh {
            Some(sh) => out = out.replace(&marker, &tx.e.odin(&sh)),
            None => return Err("let of an empty collection no use types".into()),
        }
    }
    let code = format!("{pname} :: proc{sig} {{\n{out}}}\n");
    let touches_unlogged = crate::translate::TOUCHES_UNLOGGED.with(|t| t.get());
    Ok(Translated { name: pname, code, touches_unlogged })
}

/// A type's shape, with `Self` (also `&Self`, `Option<Self>`, `Vec<Self>`) as the impl's type.
fn self_shape(tx: &mut Tx, t: &syn::Type, owner: Option<&str>) -> R<Shape> {
    let saved = tx.e.subst.clone();
    if let Some(o) = owner {
        tx.e.subst.insert("Self".into(), Shape::Named(o.to_string(), vec![]));
    }
    let s = tx.e.shape(t, &[]);
    tx.e.subst = saved;
    match s {
        Shape::Unknown(u) => Err(format!("type {u}")),
        s => {
            // Types outside the model (never saved, so odingen didn't emit them) aren't declared in Odin yet.
            let mut names = Vec::new();
            crate::emit::shape_names_pub(&s, &mut names);
            if let Some(n) = names.iter().find(|n| !tx.e.emitted.contains(*n)) {
                return Err(format!("type outside the model ({n})"));
            }
            if let Some(n) = names.iter().find(|n| tx.e.def(n).is_some_and(|d| !d.generics.is_empty())) {
                return Err(format!("generic type ({n})"));
            }
            Ok(s)
        }
    }
}

/// Rust names that are Odin keywords get a trailing underscore.
fn local_ident(n: &str) -> String {
    crate::emit::field_ident(n)
}

impl Body<'_, '_, '_> {
    fn line(&mut self, s: &str) {
        // Statements an expression on this line needed first (`?`).
        for p in std::mem::take(&mut self.tx.pre) {
            let _ = writeln!(self.out, "{}{p}", "\t".repeat(self.indent));
        }
        let _ = writeln!(self.out, "{}{s}", "\t".repeat(self.indent));
    }

    /// A block's statements; with `tail`, its last expression is the function's result.
    fn block(&mut self, blk: &Block, tail: bool) -> R<()> {
        let n = blk.stmts.len();
        for (i, st) in blk.stmts.iter().enumerate() {
            let last = i + 1 == n;
            match st {
                Stmt::Local(l) => self.local(l, &blk.stmts[i + 1..], tail)?,
                Stmt::Expr(e, None) if last && tail && (self.target.is_some() || !matches!(self.ret, Shape::Unit)) => {
                    self.tail_expr(e)?
                }
                Stmt::Expr(e, _) => self.stmt_expr(e)?,
                // A `use` inside a body changes nothing here: calls resolve by module path or file on their own.
                Stmt::Item(syn::Item::Use(_)) => {}
                Stmt::Item(it) => {
                    let kind = match it {
                        syn::Item::Fn(_) => "fn",
                        syn::Item::Const(_) => "const",
                        syn::Item::Struct(_) | syn::Item::Enum(_) => "type",
                        syn::Item::Impl(_) => "impl",
                        syn::Item::Static(_) => "static",
                        syn::Item::Macro(_) => "macro",
                        _ => "other",
                    };
                    return Err(format!("item inside a function: {kind}"));
                }
                Stmt::Macro(m) => self.stmt_macro(&m.mac)?,
            }
        }
        Ok(())
    }

    /// The function's result: `return <expr>`, or for `if`/`match`, a return in each branch.
    fn tail_expr(&mut self, e: &Expr) -> R<()> {
        match e {
            Expr::If(i) => self.if_expr(i, true),
            Expr::Match(m) => self.match_expr(m, true),
            Expr::Block(b) => {
                self.line("{");
                self.indent += 1;
                self.block(&b.block, true)?;
                self.indent -= 1;
                self.line("}");
                Ok(())
            }
            // A branch that leaves (`return`, `continue`, `break`, a panic) has no value.
            Expr::Return(_) | Expr::Continue(_) | Expr::Break(_) => self.stmt_expr(e),
            Expr::Macro(m) if is_panic_macro(m) => self.stmt_expr(e),
            _ if self.target.is_none() => {
                let ret = self.ret.clone();
                let rt = RET_TEXT.with(|r| r.borrow().clone());
                let v = crate::translate::with_collect_target(e, rt.as_deref(), || self.tx.expr(e, &ret))?;
                self.line(&format!("return {v}"));
                Ok(())
            }
            _ => {
                if let Some(t) = &self.target {
                    if t.infer {
                        if t.shape.is_none() || t.weak {
                            let weak = is_unsuffixed_int(e);
                            if let Some(s) = self.shape_of(e) {
                                let t = self.target.as_mut().unwrap();
                                if t.shape.is_none() || !weak {
                                    t.shape = Some(s);
                                    t.weak = weak;
                                }
                            }
                        }
                        return Ok(());
                    }
                    let (ident, sh) = (t.ident.clone(), t.shape.clone().ok_or("value of an unknown shape")?);
                    let v = self.tx.expr(e, &sh)?;
                    self.line(&format!("{ident} = {v}"));
                    return Ok(());
                }
                let ret = self.ret.clone();
                let v = self.tx.expr(e, &ret)?;
                self.line(&format!("return {v}"));
                Ok(())
            }
        }
    }

    /// The shape of a value-position `if`/`match`/block: a dry run over its branches, keeping the first typed tail
    /// (pattern bindings and the branches' own locals are in scope there, unlike for `shape_of` on the whole).
    fn infer_tail_shape(&mut self, e: &Expr) -> Option<Shape> {
        let snap = (self.out.len(), self.tx.vars.clone(), self.declared.clone(), self.tx.pre.clone(), self.tx.temps, self.indent);
        let names = PROC_NAMES.with(|p| p.borrow().clone());
        let loops = self.loops.clone();
        let saved = self.target.replace(Target { ident: String::new(), shape: None, weak: false, infer: true });
        let _ = self.tail_expr(e);
        let t = std::mem::replace(&mut self.target, saved).expect("target");
        self.out.truncate(snap.0);
        (self.tx.vars, self.declared, self.tx.pre, self.tx.temps, self.indent) = (snap.1, snap.2, snap.3, snap.4, snap.5);
        PROC_NAMES.with(|p| *p.borrow_mut() = names);
        self.loops = loops;
        t.shape
    }

    /// The shape of a local initialized empty (`Vec::new()`, `HashMap::new()`, `vec![]`, `Default::default()`), from
    /// its first later use that fixes it: returned as the result, pushed or inserted into, or a struct field's value.
    fn forward_shape(&mut self, name: &str, init: &Expr, rest: &[Stmt], tail: bool) -> Option<Shape> {
        let ctor = empty_ctor(init)?;
        let result = if tail {
            match &self.target {
                Some(t) => t.shape.clone(),
                None => Some(self.ret.clone()),
            }
        } else {
            None
        };
        let fn_ret = self.ret.clone();
        let mut found: Option<Shape> = None;
        let mut uses = Uses { name, out: Vec::new() };
        for (i, st) in rest.iter().enumerate() {
            match st {
                // The block's own value.
                Stmt::Expr(e, None) if i + 1 == rest.len() => {
                    if let (Some(r), Some(sh)) = (&result, value_of(e, name, result.as_ref())) {
                        let _ = r;
                        found.get_or_insert(sh);
                    }
                    syn::visit::visit_stmt(&mut uses, st);
                }
                _ => syn::visit::visit_stmt(&mut uses, st),
            }
        }
        for u in uses.out {
            if found.is_some() {
                break;
            }
            found = match u {
                Use::Returned(e) => value_of(&e, name, Some(&fn_ret)),
                Use::Push(arg) => self.shape_of(&arg).map(|s| Shape::Vec(Box::new(s))),
                Use::Insert1(arg) => self.shape_of(&arg).map(|s| Shape::Vec(Box::new(s))),
                Use::Insert2(k, v) => match (self.shape_of(&k), self.shape_of(&v)) {
                    (Some(k), Some(v)) => Some(Shape::Map(Box::new(k), Box::new(v))),
                    _ => None,
                },
                Use::Field(ty, variant, field) => {
                    let ty = if ty == "Self" { self.tx.self_ty.clone()? } else { ty };
                    match self.tx.named_fields_pub(&ty, variant.as_deref()) {
                        Some(Fields::Named(fs)) => fs.iter().find(|f| f.name.as_deref() == Some(&field)).map(|f| self.tx.e.shape(&f.ty, &[])),
                        _ => None,
                    }
                }
            };
        }
        let sh = found?;
        // The use must agree with the constructor's kind (a `Vec::new()` is a Vec, never a map).
        let ok = match (ctor, &sh) {
            (Ctor::Seq, Shape::Vec(_)) | (Ctor::Map, Shape::Map(..)) | (Ctor::Str, Shape::Str) | (Ctor::Any, _) => true,
            _ => false,
        };
        (ok && !matches!(sh, Shape::Unknown(_) | Shape::Unit)).then_some(sh)
    }

    fn local(&mut self, l: &syn::Local, rest: &[Stmt], tail: bool) -> R<()> {
        if let Some(init) = l.init.as_ref() {
            if let Some((_, els)) = &init.diverge {
                return self.let_else(&l.pat, &init.expr, els);
            }
        }
        let (pat, ty) = match &l.pat {
            Pat::Type(pt) => (&*pt.pat, Some(&*pt.ty)),
            p => (p, None),
        };
        let Pat::Ident(pi) = pat else {
            let init = l.init.as_ref().ok_or("let without a value")?;
            return self.let_pattern(pat, ty, &init.expr);
        };
        let name = pi.ident.to_string();
        let init = l.init.as_ref().ok_or("let without a value")?;
        // `let f = |x| ..;`: remembered, not emitted; calls of f inline it (closures.rs). Without `move`, Rust's
        // borrows keep its captures unchanged while it lives, so reading them at each call is exact.
        if let (None, Expr::Closure(c)) = (ty, &*init.expr) {
            if c.capture.is_some() {
                return Err("move closure in a let".into());
            }
            let env = crate::closures::captures(self.tx, c);
            crate::closures::register(&name, crate::closures::ClosureInfo { closure: c.clone(), env, args: None, ret: None, scope: crate::closures::scope_now() });
            return Ok(());
        }
        if pi.by_ref.is_some() || self.mut_ref_source(&init.expr) {
            return Err("binding to a mutable reference".into());
        }
        // The Rust type, where the let shows it: an annotation, or a constructor (`Vec::new()`, `BTreeSet::new()`).
        let rust_ty = match (ty, &*init.expr) {
            (Some(t), _) => Some(t.to_token_stream().to_string()),
            (None, Expr::Call(c)) => match &*c.func {
                Expr::Path(p) if p.path.segments.len() >= 2 => Some(p.path.segments[p.path.segments.len() - 2].ident.to_string()),
                _ => None,
            },
            (None, Expr::Macro(m)) if m.mac.path.is_ident("vec") => Some("Vec".to_string()),
            _ => None,
        };
        crate::translate::RUST_TYPES.with(|t| match rust_ty {
            Some(rt) => {
                t.borrow_mut().insert(name.clone(), rt);
            }
            None => {
                t.borrow_mut().remove(&name);
            }
        });
        let control = matches!(&*init.expr, Expr::If(_) | Expr::Match(_) | Expr::Block(_));
        let check = |tx: &mut Tx, sh: Shape| -> R<Shape> {
            // A local's type must be one Odin knows (not a lifetime-generic or out-of-model type).
            if shape_unknown(&sh) {
                return Err(format!("let of a type outside the model: {sh:?}").chars().take(90).collect());
            }
            let mut names = Vec::new();
            crate::emit::shape_names_pub(&sh, &mut names);
            match names.iter().find(|n| !tx.e.emitted.contains(*n)) {
                Some(n) => Err(format!("let of a type outside the model ({n})")),
                None => Ok(sh),
            }
        };
        let sh = match ty {
            Some(t) if !shape_unknown(&self.tx.e.shape(t, &[])) => self.tx.e.shape(t, &[]),
            // A partial annotation (`Vec<_>`): the value's own shape.
            Some(_) => self.shape_of(&init.expr).ok_or("let with a partial type of an untyped value")?,
            None => match self.shape_of(&init.expr) {
                Some(s) => Some(s),
                None if control => self.infer_tail_shape(&init.expr),
                None => self.forward_shape(&name, &init.expr, rest, tail),
            }
            .map_or_else(
                || match empty_ctor(&init.expr) {
                    // An empty collection typed by a later use: declared with a placeholder (translate.rs, PENDING).
                    Some(Ctor::Seq | Ctor::Map) => Ok(Shape::Unknown(crate::translate::PENDING_TAG.to_string())),
                    _ => Err(format!("let of an untyped value: {}", expr_kind(&init.expr))),
                },
                Ok,
            )?,
        };
        if let Shape::Unknown(u) = &sh {
            if u.starts_with(crate::translate::PENDING_TAG) {
                let is_map = matches!(empty_ctor(&init.expr), Some(Ctor::Map));
                let ident = self.fresh(&local_ident(&name));
                self.line(&format!("{ident}: {}", pending_marker(&ident)));
                crate::translate::PENDING.with(|p| p.borrow_mut().insert(ident.clone(), (is_map, None)));
                self.tx.vars.insert(name, (ident.clone(), Shape::Unknown(format!("{}{ident}", crate::translate::PENDING_TAG))));
                return Ok(());
            }
        }
        let sh = check(self.tx, sh)?;
        // A `&mut` result (`let o = state.objects.get_mut(&id).unwrap()`): a pointer, used through as `o^`, like a
        // `&mut` parameter, so writes land in place and matches through it bind pointers.
        if let Shape::MutRef(inner) = &sh {
            if !control {
                let v = self.tx.expr(&init.expr, &sh)?;
                let ident = self.fresh(&local_ident(&name));
                self.line(&format!("{ident}: {} = {v}", self.tx.e.odin(&sh)));
                self.tx.vars.insert(name, (format!("{ident}^"), (**inner).clone()));
                return Ok(());
            }
        }
        if control {
            // `let x = if/match/{..}`: declare x, then each branch's value assigns it.
            let ident = self.fresh(&local_ident(&name));
            self.line(&format!("{ident}: {}", self.tx.e.odin(&sh)));
            let saved = self.target.replace(Target { ident: ident.clone(), shape: Some(sh.clone()), weak: false, infer: false });
            let r = self.tail_expr(&init.expr);
            self.target = saved;
            r?;
            self.tx.vars.insert(name, (ident, sh));
            return Ok(());
        }
        let ann = ty.map(|t| t.to_token_stream().to_string());
        let v = crate::translate::with_collect_target(&init.expr, ann.as_deref(), || self.tx.expr(&init.expr, &sh))?;
        let ident = self.fresh(&local_ident(&name));
        self.line(&format!("{ident}: {} = {v}", self.tx.e.odin(&sh)));
        self.tx.vars.insert(name, (ident, sh));
        Ok(())
    }

    /// `let PAT = e else { .. };` (the else block diverges): the bindings are declared first, assigned when the
    /// pattern matches, and live on after.
    fn let_else(&mut self, pat: &Pat, e: &Expr, els: &Expr) -> R<()> {
        let (subj, sh, mode) = self.subject(e)?;
        let code = crate::pattern::compile(self.tx, pat, &subj, &sh, mode)?;
        let ok = self.fresh("le_ok");
        let label = self.fresh("le");
        let mut decls = Vec::new();
        for (name, init, bsh, ptr) in &code.binds {
            let ident = self.fresh(&local_ident(name));
            let ty = self.tx.e.odin(bsh);
            self.line(&format!("{ident}: {}{ty}", if *ptr { "^" } else { "" }));
            decls.push((name.clone(), ident, init.clone(), bsh.clone(), *ptr));
        }
        self.line(&format!("{ok} := false"));
        self.line(&format!("{label}: {{"));
        self.indent += 1;
        for st in &code.stmts {
            self.line(&st.replace(crate::pattern::FAIL, &format!("break {label}")));
        }
        for (_, ident, init, _, _) in &decls {
            self.line(&format!("{ident} = {init}"));
        }
        self.line(&format!("{ok} = true"));
        self.indent -= 1;
        self.line("}");
        self.line(&format!("if !{ok} {{"));
        self.indent += 1;
        match els {
            Expr::Block(b) => self.block(&b.block, false)?,
            _ => return Err("let else block".into()),
        }
        self.indent -= 1;
        self.line("}");
        for (name, ident, _, bsh, ptr) in decls {
            let use_expr = if ptr { format!("{ident}^") } else { ident };
            self.tx.vars.insert(name, (use_expr, bsh));
        }
        Ok(())
    }

    /// `let (a, b) = e;` and other irrefutable patterns.
    fn let_pattern(&mut self, pat: &Pat, ty: Option<&syn::Type>, e: &Expr) -> R<()> {
        let (subj, sh, mode) = match ty {
            Some(t) => {
                let sh = self.tx.e.shape(t, &[]);
                let v = self.tx.expr(e, &sh)?;
                let tmp = self.fresh("lp");
                self.line(&format!("{tmp}: {} = {v}", self.tx.e.odin(&sh)));
                (tmp, sh, crate::pattern::Mode::Value)
            }
            None => self.subject(e)?,
        };
        let code = crate::pattern::compile(self.tx, pat, &subj, &sh, mode)?;
        if code.refutable() {
            return Err("refutable pattern in let".into());
        }
        for st in &code.stmts {
            self.line(st);
        }
        self.bind_all(&code.binds);
        Ok(())
    }

    /// The subject a pattern is matched against: a place is used where it is (no copy); anything else is computed
    /// once into a temporary. Through a mutable reference (`&mut e`, `e.as_mut()`, a `&mut` parameter), the place is
    /// matched in Mut mode, binding pointers into it.
    fn subject(&mut self, e: &Expr) -> R<(String, Shape, crate::pattern::Mode)> {
        use crate::pattern::Mode;
        let mut e = e;
        let mut mode = Mode::Value;
        loop {
            match e {
                Expr::Paren(p) => e = &p.expr,
                Expr::Group(g) => e = &g.expr,
                Expr::Reference(r) => {
                    if r.mutability.is_some() {
                        mode = Mode::Mut;
                    }
                    e = &r.expr
                }
                Expr::MethodCall(mc) if mc.args.is_empty() && matches!(mc.method.to_string().as_str(), "as_mut" | "as_deref_mut") => {
                    mode = Mode::Mut;
                    e = &mc.receiver
                }
                Expr::MethodCall(mc) if mc.args.is_empty() && matches!(mc.method.to_string().as_str(), "as_ref" | "as_deref") => e = &mc.receiver,
                _ => break,
            }
        }
        // A pointer-valued subject (`get_mut(..)`, a `&mut`-returning call): the pointer goes in a temporary and the
        // pattern compiler matches through it (MutRef), binding pointers.
        let pointer_valued = matches!(self.shape_of(e), Some(Shape::MutRef(_))) || matches!(self.shape_of(e), Some(Shape::Option(ref i)) if matches!(**i, Shape::MutRef(_)));
        if self.mut_ref_source(e) && !pointer_valued {
            if !is_place(e) {
                return Err("pattern on a mutable reference that isn't a place".into());
            }
            mode = Mode::Mut;
        }
        // An `if`/`match`/block subject: computed into a temporary, each branch assigning it.
        if matches!(e, Expr::If(_) | Expr::Match(_) | Expr::Block(_)) {
            let sh = self.infer_tail_shape(e).ok_or("pattern on an untyped if/match")?;
            let tmp = self.fresh("ms");
            self.line(&format!("{tmp}: {}", self.tx.e.odin(&sh)));
            let saved = self.target.replace(Target { ident: tmp.clone(), shape: Some(sh.clone()), weak: false, infer: false });
            let r = self.tail_expr(e);
            self.target = saved;
            r?;
            return Ok((tmp, sh, mode));
        }
        let sh = self.shape_of(e).ok_or_else(|| format!("pattern on an untyped value: {}", expr_kind(e)))?;
        let v = self.tx.expr(e, &sh)?;
        if is_place(e) {
            return Ok((v, sh, mode));
        }
        if mode == Mode::Mut {
            return Err("pattern on a mutable reference that isn't a place".into());
        }
        let tmp = self.fresh("ms");
        self.line(&format!("{tmp} := {v}"));
        // A pattern that binds and tests nothing (`Some(_)` aside, `_`) leaves it unread, which Odin rejects.
        self.line(&format!("_ = {tmp}"));
        Ok((tmp, sh, mode))
    }

    /// Declares a pattern's bindings in the current scope (pointer bindings are used as `x^`); returns what they shadow.
    fn bind_all(&mut self, binds: &[(String, String, Shape, bool)]) -> Vec<(String, Option<(String, Shape)>)> {
        let mut saved = Vec::new();
        for (name, init, bsh, ptr) in binds {
            let ident = self.fresh(&local_ident(name));
            self.line(&format!("{ident} := {init}"));
            let use_expr = if *ptr { format!("{ident}^") } else { ident };
            saved.push((name.clone(), self.tx.vars.insert(name.clone(), (use_expr, bsh.clone()))));
        }
        saved
    }

    fn unbind_all(&mut self, saved: Vec<(String, Option<(String, Shape)>)>) {
        for (n, old) in saved.into_iter().rev() {
            restore(&mut self.tx.vars, n, old);
        }
    }

    /// Runs an emitter and undoes everything it did if it fails (for trying a faster form first).
    fn attempt(&mut self, f: impl FnOnce(&mut Self) -> R<()>) -> R<()> {
        let snap = (self.out.len(), self.tx.vars.clone(), self.declared.clone(), self.tx.pre.clone(), self.tx.temps, self.indent, self.loops.clone());
        let names = PROC_NAMES.with(|p| p.borrow().clone());
        let r = f(self);
        if r.is_err() {
            self.out.truncate(snap.0);
            (self.tx.vars, self.declared, self.tx.pre, self.tx.temps, self.indent, self.loops) = (snap.1, snap.2, snap.3, snap.4, snap.5, snap.6);
            PROC_NAMES.with(|p| *p.borrow_mut() = names);
        }
        r
    }

    /// A general `match`: each arm (each alternative of an or-pattern) is a labelled block whose failed tests break to
    /// the next; a match arm's guard is one more test.
    fn match_general(&mut self, m: &syn::ExprMatch, tail: bool) -> R<()> {
        let (subj, sh, mode) = self.subject(&m.expr)?;
        let outer = self.fresh("match");
        self.line(&format!("{outer}: {{"));
        self.indent += 1;
        for arm in &m.arms {
            let alts: Vec<&Pat> = match &arm.pat {
                Pat::Or(o) => o.cases.iter().collect(),
                p => vec![p],
            };
            for alt in alts {
                let code = crate::pattern::compile(self.tx, alt, &subj, &sh, mode)?;
                let label = self.fresh("arm");
                self.line(&format!("{label}: {{"));
                self.indent += 1;
                for st in &code.stmts {
                    self.line(&st.replace(crate::pattern::FAIL, &format!("break {label}")));
                }
                let saved = self.bind_all(&code.binds);
                if let Some((_, g)) = &arm.guard {
                    let c = self.tx.expr(g, &Shape::Bool)?;
                    self.line(&format!("if !({c}) do break {label}"));
                }
                match &*arm.body {
                    Expr::Block(b) => self.block(&b.block, tail)?,
                    e if tail => self.tail_expr(e)?,
                    e => self.stmt_expr(e)?,
                }
                if !self.ends_in_jump() {
                    self.line(&format!("break {outer}"));
                }
                self.unbind_all(saved);
                self.indent -= 1;
                self.line("}");
            }
        }
        // Rust's match is exhaustive: falling past every arm can't happen.
        self.line("unreachable()");
        self.indent -= 1;
        self.line("}");
        self.close_tail(tail);
        Ok(())
    }

    /// Whether the last line written leaves the block (Odin rejects statements after one).
    fn ends_in_jump(&self) -> bool {
        let last = self.out.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
        last.starts_with("return") || last.starts_with("break") || last.starts_with("continue") || last == "unreachable()" || last.starts_with("panic(")
    }

    /// After a construct that returns from every branch but that Odin can't see terminate (a labelled block, an `if`
    /// on a flag): the end of the procedure is unreachable.
    fn close_tail(&mut self, tail: bool) {
        if tail && self.target.is_none() && !matches!(self.ret, Shape::Unit) {
            self.line("unreachable()");
        }
    }

    /// An Odin name not yet declared in this procedure.
    fn fresh(&mut self, base: &str) -> String {
        let mut n = base.to_string();
        let mut i = 2;
        while self.declared.contains(&n) || PROC_NAMES.with(|p| p.borrow().contains(&n)) {
            n = format!("{base}_{i}");
            i += 1;
        }
        self.declared.insert(n.clone());
        PROC_NAMES.with(|p| p.borrow_mut().insert(n.clone()));
        n
    }

    fn shape_of(&mut self, e: &Expr) -> Option<Shape> {
        self.tx.shape_of_pub(e)
    }

    fn stmt_expr(&mut self, e: &Expr) -> R<()> {
        match e {
            Expr::If(i) => self.if_expr(i, false),
            Expr::Match(m) => self.match_expr(m, false),
            // Inside an inlined closure body, `return` gives the closure's value and leaves its block.
            Expr::Return(r) if crate::translate::RETURN_EXIT.with(|t| t.borrow().is_some()) => {
                let Some((label, res, shape)) = crate::translate::RETURN_EXIT.with(|t| t.borrow().clone()) else { unreachable!() };
                if label.is_empty() {
                    // A dry run (infer_block_shape): nothing to emit.
                    return Ok(());
                }
                match (&r.expr, res.is_empty()) {
                    (Some(_), true) => return Err("return with a value from a closure without one".into()),
                    (Some(v), false) => {
                        let v = self.tx.expr(v, &shape)?;
                        self.line(&format!("{res} = {v}"));
                    }
                    (None, _) => {}
                }
                self.line(&format!("break {label}"));
                Ok(())
            }
            Expr::Return(r) => {
                match &r.expr {
                    Some(v) => {
                        let ret = self.ret.clone();
                        let rt = RET_TEXT.with(|r| r.borrow().clone());
                        let v = crate::translate::with_collect_target(v, rt.as_deref(), || self.tx.expr(v, &ret))?;
                        self.line(&format!("return {v}"));
                    }
                    None => self.line("return"),
                }
                Ok(())
            }
            Expr::Assign(a) => {
                let sh = self.shape_of(&a.left).ok_or("assignment to an untyped place")?;
                let l = self.tx.expr(&a.left, &sh)?;
                let r = self.tx.expr(&a.right, &sh)?;
                self.line(&format!("{l} = {r}"));
                Ok(())
            }
            Expr::Binary(bin) if is_compound(&bin.op) => {
                let sh = self.shape_of(&bin.left).ok_or("compound assignment to an untyped place")?;
                let l = self.tx.expr(&bin.left, &sh)?;
                let r = self.tx.expr(&bin.right, &sh)?;
                let op = quote::quote!(#bin.op).to_string();
                let _ = op;
                let sym = compound_symbol(&bin.op).ok_or("compound operator")?;
                self.line(&format!("{l} {sym} {r}"));
                Ok(())
            }
            Expr::ForLoop(fl) => self.for_loop(fl),
            Expr::While(w) => {
                // `while let PAT = e { .. }`: each time round, the subject is evaluated and matched; a mismatch
                // leaves the loop.
                if let Expr::Let(l) = &*w.cond {
                    let label = self.open_loop(w.label.as_ref());
                    self.line(&format!("{label}: for {{"));
                    self.indent += 1;
                    let r = (|| -> R<()> {
                        let (subj, sh, mode) = self.subject(&l.expr)?;
                        let code = crate::pattern::compile(self.tx, &l.pat, &subj, &sh, mode)?;
                        for st in &code.stmts {
                            self.line(&st.replace(crate::pattern::FAIL, &format!("break {label}")));
                        }
                        let saved = self.bind_all(&code.binds);
                        let r = self.block(&w.body, false);
                        self.unbind_all(saved);
                        r
                    })();
                    self.indent -= 1;
                    self.line("}");
                    self.loops.pop();
                    return r;
                }
                // The condition is evaluated each time round, so statements it needs go inside the loop.
                let label = self.open_loop(w.label.as_ref());
                self.line(&format!("{label}: for {{"));
                self.indent += 1;
                let c = self.tx.expr(&w.cond, &Shape::Bool)?;
                self.line(&format!("if !({c}) do break {label}"));
                self.block(&w.body, false)?;
                self.indent -= 1;
                self.line("}");
                self.loops.pop();
                Ok(())
            }
            Expr::Loop(lp) => {
                let label = self.open_loop(lp.label.as_ref());
                self.line(&format!("{label}: for {{"));
                self.indent += 1;
                self.block(&lp.body, false)?;
                self.indent -= 1;
                self.line("}");
                self.loops.pop();
                Ok(())
            }
            Expr::Break(b) if b.expr.is_none() => {
                let l = self.loop_label(b.label.as_ref())?;
                self.line(&format!("break {l}"));
                Ok(())
            }
            Expr::Continue(c) => {
                let l = self.loop_label(c.label.as_ref())?;
                self.line(&format!("continue {l}"));
                Ok(())
            }
            Expr::Block(b) => {
                self.line("{");
                self.indent += 1;
                self.block(&b.block, false)?;
                self.indent -= 1;
                self.line("}");
                Ok(())
            }
            Expr::MethodCall(_) | Expr::Call(_) => {
                let v = self.tx.expr(e, &Shape::Unit)?;
                if v.is_empty() {
                    return Ok(());
                }
                // A value left by a library method (`set.insert(x)` → a temporary) or a translated call whose result
                // Rust drops: Odin wants it used.
                let is_value = v.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') || v.starts_with('(');
                let returns_value = match e {
                    Expr::MethodCall(_) | Expr::Call(_) => self.shape_of(e).is_some_and(|s| !matches!(s, Shape::Unit)),
                    _ => false,
                };
                if is_value || (returns_value && !v.starts_with("_ =")) {
                    self.line(&format!("_ = {v}"));
                } else {
                    self.line(&v);
                }
                Ok(())
            }
            Expr::Macro(m) => self.stmt_macro(&m.mac),
            // `f()?;`: the check and early return happen; the value is dropped.
            Expr::Try(_) => {
                let sh = self.shape_of(e).ok_or("? statement on an untyped value")?;
                let v = self.tx.expr(e, &sh)?;
                if matches!(sh, Shape::Unit) {
                    self.line(&format!("_ = {v}"));
                } else {
                    self.line(&format!("_ = {v}"));
                }
                Ok(())
            }
            other => Err(format!("statement {}", kind(other))),
        }
    }

    fn if_expr(&mut self, i: &syn::ExprIf, tail: bool) -> R<()> {
        if let Expr::Let(l) = &*i.cond {
            let simple = matches!(&*l.pat, Pat::TupleStruct(ts) if ts.path.segments.last().is_some_and(|s| s.ident == "Some")
                && ts.elems.len() == 1 && matches!(&ts.elems[0], Pat::Ident(pi) if pi.by_ref.is_none() && pi.subpat.is_none()))
                && !self.mut_ref_source(&l.expr)
                && !matches!(&*l.expr, Expr::Reference(r) if r.mutability.is_some())
                && !matches!(&*l.expr, Expr::MethodCall(mc) if mc.method == "as_mut");
            if !simple {
                return self.if_let_general(i, l, tail);
            }
            // `if let Some(x) = opt` → `if x, ok := opt.?; ok`.
            let Pat::TupleStruct(ts) = &*l.pat else { return Err("if let pattern".into()) };
            let segs: Vec<String> = ts.path.segments.iter().map(|s| s.ident.to_string()).collect();
            if segs.last().map(String::as_str) != Some("Some") || ts.elems.len() != 1 {
                return Err("if let on something other than Some".into());
            }
            let Pat::Ident(pi) = &ts.elems[0] else { return Err("if let Some binding".into()) };
            if pi.by_ref.is_some() || self.mut_ref_source(&l.expr) {
                return Err("binding to a mutable reference".into());
            }
            let sh = self.shape_of(&l.expr).ok_or_else(|| format!("if let on an untyped value: {}", source_kind(&l.expr)))?;
            let inner = match &sh {
                Shape::Option(i) => (**i).clone(),
                Shape::OptPtr(i, s) => Shape::Ptr(i.clone(), *s),
                _ => return Err("if let Some on a non-option".into()),
            };
            let v = self.tx.expr(&l.expr, &sh)?;
            let name = pi.ident.to_string();
            let ident = local_ident(&name);
            if matches!(sh, Shape::OptPtr(..)) {
                self.line(&format!("if {ident} := {v}; {ident} != nil {{"));
            } else {
                self.line(&format!("if {ident}, ok := {v}.?; ok {{"));
            }
            let saved = self.tx.vars.insert(name.clone(), (ident, inner));
            self.indent += 1;
            self.block(&i.then_branch, tail)?;
            self.indent -= 1;
            match saved {
                Some(s) => {
                    self.tx.vars.insert(name, s);
                }
                None => {
                    self.tx.vars.remove(&name);
                }
            }
        } else {
            let c = self.tx.expr(&i.cond, &Shape::Bool)?;
            self.line(&format!("if {c} {{"));
            self.indent += 1;
            self.block(&i.then_branch, tail)?;
            self.indent -= 1;
        }
        match &i.else_branch {
            None => {
                if tail {
                    return Err("if without else as the result".into());
                }
                self.line("}");
            }
            Some((_, els)) => {
                self.line("} else {");
                self.indent += 1;
                match &**els {
                    Expr::Block(b) => self.block(&b.block, tail)?,
                    Expr::If(ei) => self.if_expr(ei, tail)?,
                    _ => return Err("else branch".into()),
                }
                self.indent -= 1;
                self.line("}");
            }
        }
        Ok(())
    }

    /// `if let PAT = e { A } else { B }` for any pattern: A runs in a labelled block the failed tests leave.
    fn if_let_general(&mut self, i: &syn::ExprIf, l: &syn::ExprLet, tail: bool) -> R<()> {
        let (subj, sh, mode) = self.subject(&l.expr)?;
        let code = crate::pattern::compile(self.tx, &l.pat, &subj, &sh, mode)?;
        let ok = self.fresh("il_ok");
        let label = self.fresh("il");
        self.line(&format!("{ok} := false"));
        self.line(&format!("{label}: {{"));
        self.indent += 1;
        for st in &code.stmts {
            self.line(&st.replace(crate::pattern::FAIL, &format!("break {label}")));
        }
        self.line(&format!("{ok} = true"));
        let saved = self.bind_all(&code.binds);
        self.block(&i.then_branch, tail)?;
        self.unbind_all(saved);
        self.indent -= 1;
        self.line("}");
        match &i.else_branch {
            None => {
                if tail {
                    return Err("if without else as the result".into());
                }
            }
            Some((_, els)) => {
                self.line(&format!("if !{ok} {{"));
                self.indent += 1;
                match &**els {
                    Expr::Block(b) => self.block(&b.block, tail)?,
                    Expr::If(ei) => self.if_expr(ei, tail)?,
                    _ => return Err("else branch".into()),
                }
                self.indent -= 1;
                self.line("}");
                self.close_tail(tail);
            }
        }
        Ok(())
    }

    fn match_expr(&mut self, m: &syn::ExprMatch, tail: bool) -> R<()> {
        let simple_ok = self.attempt(|b| b.match_switch(m, tail));
        match simple_ok {
            Ok(()) => Ok(()),
            Err(_) => self.match_general(m, tail),
        }
    }

    /// A `match` on an enum whose arms are plain variant patterns: an Odin `#partial switch`.
    fn match_switch(&mut self, m: &syn::ExprMatch, tail: bool) -> R<()> {
        if (self.mut_ref_source(&m.expr) && m.arms.iter().any(|a| pat_binds(&a.pat))) || m.arms.iter().any(|a| pat_ref_mut(&a.pat)) {
            return Err("binding to a mutable reference".into());
        }
        let sh = self.shape_of(&m.expr).ok_or("match on an untyped value")?;
        let Shape::Named(en, _) = &sh else { return Err("match on a non-enum".into()) };
        let en = en.clone();
        let Some((unit, _)) = self.tx.enum_variants_pub(&en) else { return Err("match on a non-enum".into()) };
        let subject = self.tx.expr(&m.expr, &sh)?;
        if unit {
            self.line(&format!("#partial switch {} {{", header_safe(&subject)));
        } else {
            self.line(&format!("#partial switch v_ in {} {{", header_safe(&subject)));
        }
        let mut has_default = false;
        let mut default_emitted = false;
        for arm in &m.arms {
            if arm.guard.is_some() {
                return Err("match guard".into());
            }
            let mut binds: Vec<(String, String, Shape)> = Vec::new();
            let mut labels = Vec::new();
            let alts: Vec<&Pat> = match &arm.pat {
                Pat::Or(o) => o.cases.iter().collect(),
                p => vec![p],
            };
            for p in alts {
                match p {
                    Pat::Wild(_) => {
                        has_default = true;
                    }
                    Pat::Path(pp) => {
                        let v = pp.path.segments.last().unwrap().ident.to_string();
                        labels.push(if unit { format!(".{v}") } else { format!("{en}_{v}") });
                    }
                    Pat::TupleStruct(ts) => {
                        let v = ts.path.segments.last().unwrap().ident.to_string();
                        labels.push(format!("{en}_{v}"));
                        let fields = self.tx.named_fields_pub(&en, Some(&v)).ok_or("match variant fields")?;
                        let Fields::Tuple(fs) = fields else { return Err("tuple pattern on a struct variant".into()) };
                        for (i, (pe, f)) in ts.elems.iter().zip(fs.iter()).enumerate() {
                            match pe {
                                Pat::Ident(pi) => {
                                    let s = self.tx.e.shape(&f.ty, &[]);
                                    binds.push((pi.ident.to_string(), format!("v_._{i}"), s));
                                }
                                Pat::Wild(_) => {}
                                _ => return Err("nested pattern".into()),
                            }
                        }
                    }
                    Pat::Struct(ps) => {
                        let v = ps.path.segments.last().unwrap().ident.to_string();
                        labels.push(format!("{en}_{v}"));
                        let fields = self.tx.named_fields_pub(&en, Some(&v)).ok_or("match variant fields")?;
                        let Fields::Named(fs) = fields else { return Err("struct pattern on a tuple variant".into()) };
                        for fp in &ps.fields {
                            let syn::Member::Named(fid) = &fp.member else { return Err("pattern member".into()) };
                            let fname = fid.to_string();
                            let f = fs.iter().find(|f| f.name.as_deref() == Some(fname.as_str())).ok_or("pattern field")?;
                            match &*fp.pat {
                                Pat::Ident(pi) => {
                                    let s = self.tx.e.shape(&f.ty, &[]);
                                    binds.push((pi.ident.to_string(), format!("v_.{}", crate::emit::field_ident(&fname)), s));
                                }
                                Pat::Wild(_) => {}
                                _ => return Err("nested pattern".into()),
                            }
                        }
                    }
                    Pat::Ident(pi) if pi.subpat.is_none() => {
                        // A binding of the whole value: the default case.
                        has_default = true;
                        binds.push((pi.ident.to_string(), subject.clone(), sh.clone()));
                    }
                    _ => return Err("match pattern".into()),
                }
            }
            if !labels.is_empty() && binds.iter().any(|(_, src, _)| src.starts_with("v_")) && labels.len() > 1 {
                return Err("or-pattern with bindings".into());
            }
            if labels.is_empty() {
                if default_emitted {
                    // A second catch-all (a binding after a wildcard) can never be reached.
                    continue;
                }
                default_emitted = true;
                self.line("case:");
            } else {
                self.line(&format!("case {}:", labels.join(", ")));
            }
            self.indent += 1;
            let mut saved = Vec::new();
            for (n, src, s) in &binds {
                let ident = local_ident(n);
                self.line(&format!("{ident} := {src}"));
                saved.push((n.clone(), self.tx.vars.insert(n.clone(), (ident, s.clone()))));
            }
            match &*arm.body {
                Expr::Block(b) => self.block(&b.block, tail)?,
                e if tail => self.tail_expr(e)?,
                e => self.stmt_expr(e)?,
            }
            for (n, old) in saved {
                match old {
                    Some(o) => {
                        self.tx.vars.insert(n, o);
                    }
                    None => {
                        self.tx.vars.remove(&n);
                    }
                }
            }
            self.indent -= 1;
        }
        if tail && !has_default {
            // Odin can't see that the switch covers every case; Rust did.
            self.line("case:");
            self.indent += 1;
            self.line("unreachable()");
            self.indent -= 1;
        }
        self.line("}");
        Ok(())
    }

    /// Whether an expression is a mutable reference (`&mut e`, a `&mut` parameter, `as_mut()`, `get_mut(..)`,
    /// `iter_mut()`, any `*_mut` method, possibly unwrapped). Bindings from one alias the place they point into, but
    /// translated bindings are copies, so writes through them would be lost: refused until patterns bind pointers.
    fn mut_ref_source(&self, e: &Expr) -> bool {
        match e {
            Expr::Reference(r) => r.mutability.is_some(),
            Expr::Paren(p) => self.mut_ref_source(&p.expr),
            Expr::Group(g) => self.mut_ref_source(&g.expr),
            Expr::Path(p) if p.path.segments.len() == 1 => {
                self.tx.vars.get(&p.path.segments[0].ident.to_string()).is_some_and(|v| v.0.ends_with('^'))
            }
            Expr::MethodCall(mc) => {
                let m = mc.method.to_string();
                m.ends_with("_mut")
                    || matches!(m.as_str(), "entry" | "or_insert" | "or_insert_with" | "or_default")
                    || (matches!(m.as_str(), "unwrap" | "expect" | "unwrap_or_else") && self.mut_ref_source(&mc.receiver))
            }
            Expr::Try(t) => self.mut_ref_source(&t.expr),
            _ => false,
        }
    }

    /// `for PAT in coll` over a Vec, with `.iter()`, `.iter_mut()`, `&v`, `&mut v` and `.enumerate()`: the loop
    /// variable is matched against the pattern; through `iter_mut`/`&mut` it binds pointers into the elements.
    fn for_general(&mut self, fl: &syn::ExprForLoop) -> R<()> {
        use crate::pattern::Mode;
        let mut e: &Expr = &fl.expr;
        let mut enumerate = false;
        if let Expr::MethodCall(mc) = e {
            if mc.method == "enumerate" && mc.args.is_empty() {
                enumerate = true;
                e = &mc.receiver;
            }
        }
        let mut mode = Mode::Value;
        let coll: &Expr = match e {
            Expr::MethodCall(mc) if mc.args.is_empty() && mc.method == "iter" => &mc.receiver,
            Expr::MethodCall(mc) if mc.args.is_empty() && mc.method == "iter_mut" => {
                mode = Mode::Mut;
                &mc.receiver
            }
            Expr::Reference(r) => {
                if r.mutability.is_some() {
                    mode = Mode::Mut;
                }
                &r.expr
            }
            e if self.mut_ref_source(e) => {
                mode = Mode::Mut;
                e
            }
            e => e,
        };
        let sh = self.shape_of(coll).ok_or_else(|| format!("for over an untyped collection: {}", source_kind(coll)))?;
        let (elem, src) = match &sh {
            Shape::Vec(i) => ((**i).clone(), LoopSource::Vec),
            Shape::PVec(i) if mode == Mode::Value => ((**i).clone(), LoopSource::PVec),
            Shape::Ptr(p, _) if mode == Mode::Value && matches!(**p, Shape::Vec(_)) => {
                let Shape::Vec(i) = &**p else { unreachable!() };
                ((**i).clone(), LoopSource::VecPtr)
            }
            other => return Err(format!("for over a non-Vec collection: {}", shape_kind(other))),
        };
        if mode == Mode::Mut && !is_place(coll) {
            return Err("mutable iteration over something that isn't a place".into());
        }
        let c = self.tx.expr(coll, &sh)?;
        let c = self.hoist_pvec(c, src);
        let item = self.fresh("it");
        let idx = self.fresh("ix");
        let label = self.open_loop(fl.label.as_ref());
        crate::closures::BY_VALUE.with(|bv| {
            bv.borrow_mut().insert(item.clone());
            bv.borrow_mut().insert(idx.clone());
        });
        let amp = if mode == Mode::Mut { "&" } else { "" };
        self.loop_head(&label, &format!("{amp}{item}"), Some(&idx), &c, &elem, src);
        self.indent += 1;
        if src == LoopSource::PVec {
            self.line(&format!("{item} := pvec_get({c}, {idx})"));
        }
        let (elem_pat, idx_pat): (&Pat, Option<&Pat>) = if enumerate {
            let Pat::Tuple(t) = &*fl.pat else { return Err("enumerate without a tuple pattern".into()) };
            if t.elems.len() != 2 {
                return Err("enumerate pattern".into());
            }
            (&t.elems[1], Some(&t.elems[0]))
        } else {
            (&*fl.pat, None)
        };
        let mut code = crate::pattern::compile(self.tx, elem_pat, &item, &elem, mode)?;
        if let Some(ip) = idx_pat {
            let ic = crate::pattern::compile(self.tx, ip, &idx, &Shape::Int("int"), Mode::Value)?;
            code.stmts.extend(ic.stmts);
            code.binds.extend(ic.binds);
        }
        if code.refutable() {
            return Err("refutable pattern in for".into());
        }
        for st in &code.stmts {
            self.line(st);
        }
        let saved = self.bind_all(&code.binds);
        self.line(&format!("_ = {idx}"));
        self.block(&fl.body, false)?;
        self.unbind_all(saved);
        self.indent -= 1;
        self.line("}");
        self.loops.pop();
        Ok(())
    }

    /// A macro used as a statement. Logging and debug assertions are left out (they don't change the game; the
    /// shipped Rust build compiles debug assertions out too); `assert!` is an Odin assert; `panic!`-like macros panic.
    fn stmt_macro(&mut self, mac: &syn::Macro) -> R<()> {
        let name = mac.path.segments.last().map(|s| s.ident.to_string()).unwrap_or_default();
        match name.as_str() {
            "debug_assert" | "debug_assert_eq" | "debug_assert_ne" | "trace" | "debug" | "info" | "warn" | "error"
            | "eprintln" | "println" | "eprint" | "print" | "dbg" => Ok(()),
            "assert" => {
                let args = mac.parse_body_with(syn::punctuated::Punctuated::<Expr, syn::Token![,]>::parse_terminated).map_err(|_| "assert! arguments")?;
                let cond = args.first().ok_or("assert! without a condition")?;
                let c = self.tx.expr(cond, &Shape::Bool)?;
                self.line(&format!("assert({c})"));
                Ok(())
            }
            "assert_eq" | "assert_ne" => {
                let args = mac.parse_body_with(syn::punctuated::Punctuated::<Expr, syn::Token![,]>::parse_terminated).map_err(|_| "assert_eq! arguments")?;
                let (a, b) = (args.get(0).ok_or("assert_eq!")?, args.get(1).ok_or("assert_eq!")?);
                let sh = self.shape_of(a).or_else(|| self.shape_of(b)).ok_or("assert_eq! of untyped values")?;
                if !self.tx.comparable_pub(&sh) {
                    return Err("assert_eq! on a type Odin can't compare".into());
                }
                let (x, y) = (self.tx.expr(a, &sh)?, self.tx.expr(b, &sh)?);
                let op = if name == "assert_eq" { "==" } else { "!=" };
                self.line(&format!("assert({x} {op} {y})"));
                Ok(())
            }
            "panic" | "unreachable" | "todo" | "unimplemented" => {
                let msg = crate::translate::odin_string(&format!("{name}! in translated code"));
                self.line(&format!("panic({msg})"));
                Ok(())
            }
            other => Err(format!("statement macro {other}!")),
        }
    }

    /// An im::Vector loop source, read once into a local (a PVec value shares its chunks, so the copy is cheap).
    fn hoist_pvec(&mut self, c: String, src: LoopSource) -> String {
        if src != LoopSource::PVec {
            return c;
        }
        let v = self.fresh("pv");
        self.line(&format!("{v} := {c}"));
        v
    }

    /// A `for` loop's head over a collection, the item named `item` (and the index `idx`). An im::Vector is walked by
    /// index (the caller binds the item with `pvec_get` from the local `hoist_pvec` made); a Vec behind a nil-able
    /// pointer reads as empty when nil.
    fn loop_head(&mut self, label: &str, item: &str, idx: Option<&str>, c: &str, elem: &Shape, src: LoopSource) {
        let ix = idx.map(|i| format!(", {i}")).unwrap_or_default();
        match src {
            LoopSource::Vec => self.line(&format!("{label}: for {item}{ix} in {} {{", header_safe(c))),
            LoopSource::PVec => {
                let i = idx.unwrap_or("_");
                self.line(&format!("{label}: for {i} in 0 ..< {c}.len {{"));
            }
            LoopSource::VecPtr => {
                let v = self.fresh("pv");
                self.line(&format!("{v}: [dynamic]{}", self.tx.e.odin(elem)));
                self.line(&format!("if p_ := {c}; p_ != nil do {v} = p_^"));
                self.line(&format!("{label}: for {item}{ix} in {v} {{"));
            }
        }
    }

    /// A new loop: its Odin label, pushed on the loop stack (the caller pops it).
    fn open_loop(&mut self, rust: Option<&syn::Label>) -> String {
        let label = self.fresh("loop");
        self.loops.push((rust.map(|l| l.name.ident.to_string()), label.clone()));
        label
    }

    /// The Odin label of the loop a `break`/`continue` leaves: the innermost, or the one its Rust label names.
    fn loop_label(&self, rust: Option<&syn::Lifetime>) -> R<String> {
        match rust {
            None => self.loops.last().map(|l| l.1.clone()).ok_or_else(|| "break outside a loop".into()),
            Some(lt) => {
                let n = lt.ident.to_string();
                self.loops.iter().rev().find(|l| l.0.as_deref() == Some(n.as_str())).map(|l| l.1.clone()).ok_or_else(|| "break to an unknown label".into())
            }
        }
    }

    fn for_loop(&mut self, fl: &syn::ExprForLoop) -> R<()> {
        let plain = matches!(&*fl.pat, Pat::Ident(pi) if pi.by_ref.is_none() && pi.subpat.is_none());
        if !plain || self.mut_ref_source(&fl.expr) || matches!(&*fl.expr, Expr::MethodCall(mc) if mc.method == "enumerate") {
            return self.for_general(fl);
        }
        let Pat::Ident(pi) = &*fl.pat else { return Err("for pattern".into()) };
        let name = pi.ident.to_string();
        let ident = local_ident(&name);
        // `a..b` ranges.
        if let Expr::Range(rg) = &*fl.expr {
            let (Some(a), Some(b)) = (&rg.start, &rg.end) else { return Err("open range".into()) };
            let sh = self.shape_of(a).or_else(|| self.shape_of(b)).unwrap_or(Shape::Int("int"));
            let (a, b) = (self.tx.expr(a, &sh)?, self.tx.expr(b, &sh)?);
            let op = if matches!(rg.limits, syn::RangeLimits::Closed(_)) { "..=" } else { "..<" };
            let label = self.open_loop(fl.label.as_ref());
            crate::closures::BY_VALUE.with(|bv| bv.borrow_mut().insert(ident.clone()));
            self.line(&format!("{label}: for {ident} in {a} {op} {b} {{"));
            let saved = self.tx.vars.insert(name.clone(), (ident, sh));
            self.indent += 1;
            self.block(&fl.body, false)?;
            self.indent -= 1;
            self.line("}");
            self.loops.pop();
            restore(&mut self.tx.vars, name, saved);
            return Ok(());
        }
        if self.mut_ref_source(&fl.expr) {
            return Err("binding to a mutable reference".into());
        }
        // `for x in &v`, `for x in v.iter()`.
        let coll = match &*fl.expr {
            Expr::MethodCall(mc) if mc.method == "iter" && mc.args.is_empty() => &*mc.receiver,
            Expr::Reference(r) => &*r.expr,
            e => e,
        };
        let sh = self.shape_of(coll).ok_or_else(|| format!("for over an untyped collection: {}", source_kind(coll)))?;
        let (elem, src) = match &sh {
            Shape::Vec(i) => ((**i).clone(), LoopSource::Vec),
            Shape::PVec(i) => ((**i).clone(), LoopSource::PVec),
            Shape::Ptr(p, _) if matches!(**p, Shape::Vec(_)) => {
                let Shape::Vec(i) = &**p else { unreachable!() };
                ((**i).clone(), LoopSource::VecPtr)
            }
            other => return Err(format!("for over a non-Vec collection: {}", shape_kind(other))),
        };
        let c = self.tx.expr(coll, &sh)?;
        let c = self.hoist_pvec(c, src);
        let label = self.open_loop(fl.label.as_ref());
        crate::closures::BY_VALUE.with(|bv| bv.borrow_mut().insert(ident.clone()));
        let idx = self.fresh("ix");
        self.loop_head(&label, &ident, Some(&idx), &c, &elem, src);
        let saved = self.tx.vars.insert(name.clone(), (ident.clone(), elem));
        self.indent += 1;
        if src == LoopSource::PVec {
            self.line(&format!("{ident} := pvec_get({c}, {idx})"));
        }
        self.block(&fl.body, false)?;
        self.indent -= 1;
        self.line("}");
        self.loops.pop();
        restore(&mut self.tx.vars, name, saved);
        Ok(())
    }
}

fn restore(vars: &mut BTreeMap<String, (String, Shape)>, name: String, saved: Option<(String, Shape)>) {
    match saved {
        Some(s) => {
            vars.insert(name, s);
        }
        None => {
            vars.remove(&name);
        }
    }
}

fn is_compound(op: &syn::BinOp) -> bool {
    compound_symbol(op).is_some()
}

fn compound_symbol(op: &syn::BinOp) -> Option<&'static str> {
    use syn::BinOp::*;
    Some(match op {
        AddAssign(_) => "+=",
        SubAssign(_) => "-=",
        MulAssign(_) => "*=",
        DivAssign(_) => "/=",
        RemAssign(_) => "%=",
        BitOrAssign(_) => "|=",
        BitAndAssign(_) => "&=",
        BitXorAssign(_) => "~=",
        _ => return None,
    })
}

fn kind(e: &Expr) -> &'static str {
    match e {
        Expr::Macro(_) => "macro",
        Expr::Closure(_) => "closure",
        Expr::Try(_) => "?",
        Expr::Let(_) => "let pattern",
        _ => "other",
    }
}

/// `odingen translate-report <crates-dir> [file filter]`: tries every function and ranks what stopped the rest.
pub fn report(e: &mut Emitter, only: Option<&str>, out_file: Option<&std::path::Path>, codecs: &std::collections::BTreeSet<String>) {
    let fns: Vec<((Option<String>, String), FnDef)> = e
        .reg
        .fns
        .iter()
        .filter(|(k, _)| k.1 != "__Default")
        .flat_map(|(k, v)| v.iter().map(move |d| (k.clone(), d.clone())))
        .filter(|(_, d)| only.map(|o| d.file.to_string_lossy().contains(o)).unwrap_or(true))
        .collect();
    // Procedures the hand-written Odin already defines (hand_codecs.odin and the runtime): theirs stand.
    let mut hand: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    if let Some(dir) = out_file.and_then(|p| p.parent()) {
        for f in ["hand_codecs.odin", "codec_runtime.odin", "pvec.odin", "hand_logic.odin"] {
            if let Ok(src) = std::fs::read_to_string(dir.join(f)) {
                for line in src.lines() {
                    if let Some((n, _)) = line.split_once(" :: ") {
                        if !n.starts_with(['\t', ' ', '/']) {
                            hand.insert(n.trim().to_string());
                        }
                    }
                }
            }
        }
    }
    crate::translate::HAND.with(|h| *h.borrow_mut() = hand.clone());
    let fns: Vec<_> = fns.into_iter().filter(|((o, n), d)| !hand.contains(&proc_name_for(o.as_deref(), n, d)) && !hand.contains(&proc_name(o.as_deref(), n))).collect();
    // Procedure names more than one function maps to (same-stem files in different directories, a type's methods
    // in two impls of same-named types): calls to them can't be resolved to one.
    let mut by_name: BTreeMap<String, usize> = BTreeMap::new();
    for ((owner, name), defs) in e.reg.fns.iter().filter(|(k, _)| k.1 != "__Default") {
        for d in defs {
            *by_name.entry(proc_name_for(owner.as_deref(), name, d)).or_default() += 1;
        }
    }
    crate::translate::COLLIDING.with(|c| *c.borrow_mut() = by_name.into_iter().filter(|(_, n)| *n > 1).map(|(k, _)| k).collect());
    crate::closures::INSTANCES.with(|i| *i.borrow_mut() = Default::default());
    let mut ok = Vec::new();
    let mut done: Vec<(String, Option<String>, String, FnDef, bool)> = Vec::new();
    let mut why_by_proc: BTreeMap<String, String> = BTreeMap::new();
    let mut stubs = Vec::new();
    let mut reasons: BTreeMap<String, usize> = BTreeMap::new();
    // ODINGEN_EXECUTED: "file:line" of each function a profiled run executed (from an lcov report): the blockers
    // are also ranked over just those, which is what the port needs first.
    let executed: Option<std::collections::BTreeSet<String>> = std::env::var("ODINGEN_EXECUTED")
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|t| t.lines().map(str::to_string).collect());
    let is_executed = |d: &FnDef| {
        executed.as_ref().is_some_and(|ex| {
            use syn::spanned::Spanned;
            let line = d.sig.fn_token.span().start().line;
            ex.contains(&format!("{}:{line}", d.file.to_string_lossy()))
        })
    };
    let mut ex_reasons: BTreeMap<String, usize> = BTreeMap::new();
    let (mut ex_total, mut ex_ok) = (0usize, 0usize);
    // Executed generic or closure-taking functions, refused alone (they exist only as per-call-site instances).
    let mut ex_generic: Vec<String> = Vec::new();
    for ((owner, name), d) in &fns {
        let ex = is_executed(d);
        ex_total += ex as usize;
        let tr = translate_fn(e, owner.as_deref(), name, d);
        if let Err(r) = &tr {
            why_by_proc.insert(proc_name_for(owner.as_deref(), name, d), r.clone());
        }
        match tr {
            Ok(t) => {
                ex_ok += ex as usize;
                done.push((t.name.clone(), owner.clone(), name.clone(), d.clone(), t.touches_unlogged));
                ok.push(t)
            }
            Err(r) => {
                if let Ok(st) = stub_fn(e, owner.as_deref(), name, d, &r) {
                    stubs.push(st);
                }
                if ex {
                    *ex_reasons.entry(r.clone()).or_default() += 1;
                    if r.starts_with("generic function") {
                        ex_generic.push(proc_name_for(owner.as_deref(), name, d));
                    }
                }
                // ODINGEN_WHY=<text>: name the functions refused for a reason containing it (debugging the translator).
                if let Ok(w) = std::env::var("ODINGEN_WHY") {
                    if r.contains(&w) {
                        eprintln!("why: {} ({}) {}", proc_name_for(owner.as_deref(), name, d), d.file.display(), r);
                    }
                }
                *reasons.entry(r).or_default() += 1
            }
        }
    }
    println!("functions {}: translated {} ({:.1}%)", fns.len(), ok.len(), 100.0 * ok.len() as f64 / fns.len().max(1) as f64);
    // ODINGEN_REACH=<procedure>: what that procedure can reach through calls (by name, so an over-approximation),
    // how much of it translates, and what blocks the rest — the distance to running it in Odin.
    if let Ok(root) = std::env::var("ODINGEN_REACH") {
        reach_report(&fns, &root, &done.iter().map(|d| d.0.clone()).collect(), &why_by_proc);
    }
    let mut rs: Vec<_> = reasons.into_iter().collect();
    rs.sort_by(|a, b| b.1.cmp(&a.1));
    let top: usize = std::env::var("ODINGEN_TOP").ok().and_then(|v| v.parse().ok()).unwrap_or(40);
    for (r, n) in rs.iter().take(top) {
        println!("  {n:>6}  {r}");
    }
    if executed.is_some() {
        println!("executed functions {ex_total}: translated {ex_ok} ({:.1}%)", 100.0 * ex_ok as f64 / ex_total.max(1) as f64);
        // Those with at least one instance made (and not rejected by the Odin type check): translated where the
        // translated callers use them, though other call sites may still lack instances.
        let instanced: std::collections::BTreeSet<String> = crate::closures::INSTANCES.with(|i| {
            i.borrow().1.iter().filter(|(n, _)| !DENY.with(|d| d.contains(n))).filter_map(|(n, _)| n.split("__cl").next().map(|b| b.split("__g").next().unwrap_or(b).to_string())).collect()
        });
        let via = ex_generic.iter().filter(|g| instanced.contains(*g)).count();
        println!(
            "  plus {via} of {} executed generic/closure-taking functions translated as instances ({:.1}% counting them)",
            ex_generic.len(),
            100.0 * (ex_ok + via) as f64 / ex_total.max(1) as f64
        );
        let mut rs: Vec<_> = ex_reasons.into_iter().collect();
        rs.sort_by(|a, b| b.1.cmp(&a.1));
        for (r, n) in rs.iter().take(top) {
            println!("  {n:>6}  {r}");
        }
    }
    if let Some(path) = out_file {
        let mut code = String::from("// GENERATED by odingen translate-report: translated engine functions (work in progress).\npackage types\n\nimport \"../json\"\nimport \"../rng\"\n\n_ :: json\n_ :: rng\n\n// The vector check's build (`-define:VECTOR=true`): a stub records that it was reached and returns a zero value,\n// so the call is reported as inconclusive instead of stopping the run.\nVECTOR :: #config(VECTOR, false)\nvector_stub_hit: string\n// Set by the vector check: called when a stub is reached, to end the call there (it doesn't return).\nvector_on_stub: proc(name: string)\n\n");
        let mut seen = std::collections::BTreeSet::new();
        for t in ok.iter().chain(stubs.iter()) {
            if seen.insert(t.name.clone()) {
                code.push_str(&t.code);
                code.push('\n');
            }
        }
        // Closure instances (closures.rs), made while translating their callers.
        let instances = crate::closures::INSTANCES.with(|i| std::mem::take(&mut i.borrow_mut().1));
        println!("closure instances: {}", instances.len());
        for (n, c) in instances {
            if seen.insert(n) {
                code.push_str(&c);
                code.push('\n');
            }
        }
        std::fs::write(path, code).unwrap();
        // The vector harness: a case per translated procedure whose parameters and result have codecs.
        let helpers_before = e.helpers_out.len();
        let mut cases = String::new();
        let mut procs = String::new();
        let mut named = std::collections::BTreeSet::new();
        let mut n_cases = 0;
        for (pname, owner, name, d, unlogged) in &done {
            if !named.insert(pname.clone()) {
                continue;
            }
            // One procedure per case: in a single procedure every case's locals (game states among them) would
            // share one stack frame, which overflows.
            if let Some(c) = harness_case(e, owner.as_deref(), name, d, pname, codecs, *unlogged) {
                cases.push_str(&format!("\tcase {pname:?}:\n\t\treturn vc_{pname}(file, args, ret, after, why)\n"));
                procs.push_str(&format!("vc_{pname} :: proc(file: string, args: []json.Value, ret: json.Value, after: []json.Value, why: ^strings.Builder) -> Vector_Outcome {{\n{c}}}\n\n"));
                n_cases += 1;
            }
        }
        let helpers = e.helpers_out[helpers_before..].to_string();
        let harness = format!(
            "// GENERATED by odingen translate-report: the vector check's dispatch (odin/tools/vector_check).\npackage types\n\nimport \"core:strings\"\nimport \"../json\"\n\n_ :: strings\n\n{VECTOR_RUNTIME}\nvector_call :: proc(name, file: string, args: []json.Value, ret: json.Value, after: []json.Value, why: ^strings.Builder) -> Vector_Outcome {{\n\tvector_stub_hit = \"\"\n\tswitch name {{\n{cases}\t}}\n\treturn .Unknown\n}}\n\n{procs}{helpers}"
        );
        std::fs::write(path.with_file_name("vector_harness.odin"), harness).unwrap();
        println!("vector harness: {n_cases} procedures");
    }
}

const VECTOR_RUNTIME: &str = r#"Vector_Outcome :: enum {
	Pass,
	PassNothingCompared, // nothing to compare: no result and no `&mut` argument
	PassUnloggedState,   // equal, but the procedure touches `#[serde(skip)]` state the log doesn't carry
	Fail,
	Stub,        // reached a procedure not translated yet
	Undecodable, // an argument the model can't decode
	Unlogged,    // an argument the Rust side couldn't serialize
	Unknown,     // no case for this name, or a different function of the same name
}

vector_unlogged :: proc(v: json.Value) -> bool {
	if v.kind != .Object do return false
	for m in v.members do if m.key == "$unlogged" do return true
	return false
}

vector_strip :: proc(v: ^json.Value, key: string) {
	#partial switch v.kind {
	case .Array:
		items := make([]json.Value, len(v.items))
		for item, i in v.items {
			items[i] = item
			vector_strip(&items[i], key)
		}
		v.items = items
	case .Object:
		kept := make([dynamic]json.Member, 0, len(v.members))
		for m in v.members {
			if m.key == key do continue
			m := m
			vector_strip(&m.value, key)
			append(&kept, m)
		}
		v.members = kept[:]
	}
}

// Whether an encoded Odin value equals the Rust one; the first difference's path goes to `why`.
vector_same :: proc(b: ^strings.Builder, want: json.Value, why: ^strings.Builder, what: string) -> bool {
	if vector_unlogged(want) do return true
	got, err := json.parse(transmute([]byte)strings.to_string(b^))
	if err != nil {
		strings.write_string(why, what)
		strings.write_string(why, ": unparsable encoding")
		return false
	}
	// Values the Rust engine computes when serializing and the Odin model leaves out (as in gamestate_roundtrip):
	// AbilityDefinition's `is_mana_ability` and the write-only fields.
	want := want
	vector_strip(&want, "is_mana_ability")
	for k in WRITE_ONLY_FIELDS {
		vector_strip(&want, k)
		vector_strip(&got, k)
	}
	path := strings.builder_make(context.temp_allocator)
	if json.equal(want, got, &path) do return true
	strings.write_string(why, what)
	strings.write_string(why, " differs at ")
	strings.write_string(why, strings.to_string(path))
	strings.write_string(why, "; ")
	return false
}
"#;

/// One case of the vector harness: decode the logged arguments, call the procedure, compare its result and its
/// `&mut` arguments afterwards with the logged ones. None when some parameter or the result has no codec.
fn harness_case(e: &mut Emitter, owner: Option<&str>, _name: &str, f: &FnDef, pname: &str, codecs: &std::collections::BTreeSet<String>, unlogged: bool) -> Option<String> {
    let mut tx = Tx { e, vars: BTreeMap::new(), self_ty: owner.map(str::to_string), depth: 0, calls: true, pre: Vec::new(), fn_ret: Shape::Unit, temps: 0 };
    let has_codec = |s: &Shape| {
        let mut names = Vec::new();
        crate::emit::shape_names_pub(s, &mut names);
        !shape_has_open(s) && names.iter().all(|n| codecs.contains(n))
    };
    let mut params: Vec<(Shape, bool)> = Vec::new();
    for input in &f.sig.inputs {
        match input {
            FnArg::Receiver(rc) => params.push((Shape::Named(owner?.to_string(), vec![]), rc.reference.is_some() && rc.mutability.is_some())),
            FnArg::Typed(pt) => {
                let sh = self_shape(&mut tx, &pt.ty, owner).ok()?;
                params.push((sh, matches!(&*pt.ty, syn::Type::Reference(r) if r.mutability.is_some())));
            }
        }
    }
    // A borrowed result (`&mut T`, a pointer here) is never logged by the Rust side.
    if matches!(&f.sig.output, ReturnType::Type(_, t) if t.to_token_stream().to_string().contains('&')) {
        return None;
    }
    let ret = match &f.sig.output {
        ReturnType::Default => Shape::Unit,
        ReturnType::Type(_, t) => self_shape(&mut tx, t, owner).ok()?,
    };
    if !params.iter().all(|(s, _)| has_codec(s)) || !(matches!(ret, Shape::Unit) || has_codec(&ret)) {
        return None;
    }
    let file = f.file.to_string_lossy().to_string();
    let file = file.split_once("crates/").map(|(_, r)| r.to_string()).unwrap_or(file);
    let mut c = format!("\t\tif file != {file:?} || len(args) != {} do return .Unknown\n", params.len());
    let mut call = Vec::new();
    for (i, (s, m)) in params.iter().enumerate() {
        let (dec, ty) = (tx.e.dec(s), tx.e.odin(s));
        c.push_str(&format!("\t\tif vector_unlogged(args[{i}]) do return .Unlogged\n\t\ta{i}: {ty}\n\t\tif !{dec}(args[{i}], &a{i}) do return .Undecodable\n"));
        call.push(if *m { format!("&a{i}") } else { format!("a{i}") });
    }
    let call = format!("{pname}({})", call.join(", "));
    if matches!(ret, Shape::Unit) {
        c.push_str(&format!("\t\t{call}\n"));
    } else {
        c.push_str(&format!("\t\tr := {call}\n"));
    }
    c.push_str("\t\tif vector_stub_hit != \"\" do return .Stub\n\t\tsame := true\n");
    if !matches!(ret, Shape::Unit) {
        let enc = tx.e.enc(&ret);
        c.push_str(&format!("\t\t{{\n\t\t\tb := strings.builder_make(context.temp_allocator)\n\t\t\t{enc}(&b, r)\n\t\t\tsame = vector_same(&b, ret, why, \"result\") && same\n\t\t}}\n"));
    }
    let mut k = 0;
    for (i, (s, m)) in params.iter().enumerate() {
        if !*m {
            continue;
        }
        let enc = tx.e.enc(s);
        c.push_str(&format!("\t\tif len(after) > {k} {{\n\t\t\tb := strings.builder_make(context.temp_allocator)\n\t\t\t{enc}(&b, a{i})\n\t\t\tsame = vector_same(&b, after[{k}], why, \"argument {i} after\") && same\n\t\t}}\n"));
        k += 1;
    }
    // A pass means less when nothing was compared (no result, no `&mut` argument) or when the procedure touches
    // state the log doesn't carry.
    let compared = !matches!(ret, Shape::Unit) || params.iter().any(|(_, m)| *m);
    let pass = if !compared { ".PassNothingCompared" } else if unlogged { ".PassUnloggedState" } else { ".Pass" };
    c.push_str(&format!("\t\treturn {pass} if same else .Fail\n"));
    Some(c)
}

/// Shapes the harness can't decode: type parameters, unknown and hand-defined external types.
fn shape_has_open(s: &Shape) -> bool {
    match s {
        Shape::Param(_) | Shape::Unknown(_) | Shape::Extern(_) => true,
        Shape::Option(i) | Shape::OptPtr(i, _) | Shape::Ptr(i, _) | Shape::Vec(i) | Shape::PVec(i) | Shape::Array(i, _) => shape_has_open(i),
        Shape::Result(..) => true,
        Shape::Map(a, b) => shape_has_open(a) || shape_has_open(b),
        Shape::Tuple(v) => v.iter().any(shape_has_open),
        // Generic instances encode through overloads the harness can't name; Result has no serde codec here.
        Shape::Named(_, a) => !a.is_empty(),
        _ => false,
    }
}

/// A short description of an expression's kind, for the translate report's blocker list.
fn expr_kind(e: &Expr) -> String {
    match e {
        Expr::MethodCall(mc) => format!("method .{}()", mc.method),
        Expr::Call(c) => match &*c.func {
            Expr::Path(p) => format!("call {}", p.path.segments.iter().map(|s| s.ident.to_string()).collect::<Vec<_>>().join("::")),
            _ => "call".into(),
        },
        Expr::Path(_) => "path".into(),
        Expr::Field(_) => "field".into(),
        Expr::If(_) => "if".into(),
        Expr::Match(_) => "match".into(),
        Expr::Block(_) => "block".into(),
        Expr::Closure(_) => "closure".into(),
        Expr::Macro(m) => format!("macro {}!", m.mac.path.segments.last().map(|s| s.ident.to_string()).unwrap_or_default()),
        Expr::Unary(u) => format!("unary {}", expr_kind(&u.expr)),
        Expr::Reference(r) => format!("ref {}", expr_kind(&r.expr)),
        Expr::Try(t) => format!("try {}", expr_kind(&t.expr)),
        Expr::Struct(_) => "struct".into(),
        Expr::Array(_) => "array".into(),
        Expr::Index(_) => "index".into(),
        Expr::Binary(_) => "binary".into(),
        Expr::Lit(_) => "lit".into(),
        Expr::Tuple(_) => "tuple".into(),
        Expr::Range(_) => "range".into(),
        _ => "other".into(),
    }
}

/// A `panic!`, `unreachable!`, `todo!` or `unimplemented!`: a branch with no value.
fn is_panic_macro(m: &syn::ExprMacro) -> bool {
    m.mac.path.segments.last().is_some_and(|s| matches!(s.ident.to_string().as_str(), "panic" | "unreachable" | "todo" | "unimplemented"))
}

fn is_unsuffixed_int(e: &Expr) -> bool {
    matches!(e, Expr::Lit(l) if matches!(&l.lit, syn::Lit::Int(i) if i.suffix().is_empty()))
}

#[derive(Clone, Copy)]
enum Ctor {
    Seq,
    Map,
    Str,
    Any,
}

/// An empty collection constructor, by the kind of shape it makes.
/// An expression made safe for a control statement's header: a composite literal there (`for x in [2]T{a, b} {`)
/// would have its `{` read as the body's, so one containing a brace is parenthesized.
pub fn header_safe(e: &str) -> String {
    if e.contains('{') { format!("({e})") } else { e.to_string() }
}

/// Where a `for` loop's items come from.
#[derive(Clone, Copy, PartialEq, Eq)]
enum LoopSource {
    Vec,
    PVec,
    VecPtr,
}

/// A short name for an expression's kind in refusal messages: the method or function it calls, or its form.
fn source_kind(e: &Expr) -> String {
    match e {
        Expr::MethodCall(m) => format!("method .{}()", m.method),
        Expr::Call(c) => match &*c.func {
            Expr::Path(p) => format!("call {}", p.path.segments.last().map(|s| s.ident.to_string()).unwrap_or_default()),
            _ => "call".into(),
        },
        Expr::Reference(r) => source_kind(&r.expr),
        Expr::Paren(p) => source_kind(&p.expr),
        Expr::Field(_) => "field".into(),
        Expr::Path(_) => "variable".into(),
        Expr::Range(_) => "range".into(),
        _ => "expression".into(),
    }
}

thread_local! {
    /// Every name declared in the procedure being translated, across the bodies inlined into it (closure blocks get
    /// a Body of their own): Odin labels are procedure-wide, and a closure's local must not shadow a name its
    /// captures are read through.
    static PROC_NAMES: std::cell::RefCell<BTreeSet<String>> = std::cell::RefCell::new(BTreeSet::new());
}

/// The placeholder type of a pending local's declaration, replaced when the function is finished.
fn pending_marker(ident: &str) -> String {
    format!("«pending:{ident}»")
}

fn empty_ctor(e: &Expr) -> Option<Ctor> {
    match e {
        Expr::Call(c) => {
            let Expr::Path(p) = &*c.func else { return None };
            let segs: Vec<String> = p.path.segments.iter().map(|s| s.ident.to_string()).collect();
            let last = segs.last()?.as_str();
            if segs.len() == 2 && segs[0] == "Default" && last == "default" && c.args.is_empty() {
                return Some(Ctor::Any);
            }
            if segs.len() != 2 || !matches!(last, "new" | "with_capacity" | "default") {
                return None;
            }
            match segs[0].as_str() {
                "Vec" | "VecDeque" | "HashSet" | "BTreeSet" | "IndexSet" | "SmallVec" => Some(Ctor::Seq),
                "HashMap" | "BTreeMap" | "IndexMap" | "FxHashMap" => Some(Ctor::Map),
                "String" => Some(Ctor::Str),
                _ => None,
            }
        }
        Expr::Macro(m) if m.mac.path.is_ident("vec") && m.mac.tokens.is_empty() => Some(Ctor::Seq),
        _ => None,
    }
}

/// The shape `name` has when `e` (a result of the given shape) is it, `Ok(it)` or `Some(it)`.
fn value_of(e: &Expr, name: &str, result: Option<&Shape>) -> Option<Shape> {
    let result = result?;
    match e {
        Expr::Path(p) if p.path.is_ident(name) => Some(result.clone()),
        Expr::Paren(p) => value_of(&p.expr, name, Some(result)),
        Expr::Call(c) if c.args.len() == 1 => {
            let Expr::Path(f) = &*c.func else { return None };
            match (f.path.segments.last()?.ident.to_string().as_str(), result) {
                ("Ok", Shape::Result(v, _)) => value_of(&c.args[0], name, Some(v)),
                ("Some", Shape::Option(v)) => value_of(&c.args[0], name, Some(v)),
                _ => None,
            }
        }
        _ => None,
    }
}

/// A later use of a local that fixes its shape (`forward_shape`).
enum Use {
    Returned(Expr),
    Push(Expr),
    Insert1(Expr),
    Insert2(Expr, Expr),
    /// `Type { field: name }` or `Enum::Variant { field: name }`: the type (or enum), the variant, the field.
    Field(String, Option<String>, String),
}

struct Uses<'n> {
    name: &'n str,
    out: Vec<Use>,
}

impl<'ast> syn::visit::Visit<'ast> for Uses<'_> {
    fn visit_expr_return(&mut self, r: &'ast syn::ExprReturn) {
        if let Some(e) = &r.expr {
            self.out.push(Use::Returned((**e).clone()));
        }
        syn::visit::visit_expr_return(self, r);
    }
    fn visit_expr_method_call(&mut self, mc: &'ast syn::ExprMethodCall) {
        if matches!(&*mc.receiver, Expr::Path(p) if p.path.is_ident(self.name)) {
            let args: Vec<Expr> = mc.args.iter().cloned().collect();
            match (mc.method.to_string().as_str(), args.len()) {
                ("push" | "push_back", 1) => self.out.push(Use::Push(args[0].clone())),
                ("insert", 1) => self.out.push(Use::Insert1(args[0].clone())),
                ("insert", 2) => self.out.push(Use::Insert2(args[0].clone(), args[1].clone())),
                _ => {}
            }
        }
        syn::visit::visit_expr_method_call(self, mc);
    }
    fn visit_expr_struct(&mut self, st: &'ast syn::ExprStruct) {
        let segs: Vec<String> = st.path.segments.iter().map(|s| s.ident.to_string()).collect();
        for fv in &st.fields {
            let syn::Member::Named(id) = &fv.member else { continue };
            if matches!(&fv.expr, Expr::Path(p) if p.path.is_ident(self.name)) {
                let (ty, variant) = match segs.len() {
                    1 => (segs[0].clone(), None),
                    n => (segs[n - 2].clone(), Some(segs[n - 1].clone())),
                };
                self.out.push(Use::Field(ty, variant, id.to_string()));
            }
        }
        syn::visit::visit_expr_struct(self, st);
    }
    // Closures and nested functions have their own `return`s.
    fn visit_expr_closure(&mut self, _: &'ast syn::ExprClosure) {}
    fn visit_item_fn(&mut self, _: &'ast syn::ItemFn) {}
}

/// Whether a pattern binds a name.
fn pat_binds(p: &Pat) -> bool {
    match p {
        Pat::Ident(_) => true,
        Pat::Or(o) => o.cases.iter().any(pat_binds),
        Pat::Paren(pp) => pat_binds(&pp.pat),
        Pat::Reference(r) => pat_binds(&r.pat),
        Pat::Struct(s) => s.fields.iter().any(|f| pat_binds(&f.pat)),
        Pat::Tuple(t) => t.elems.iter().any(pat_binds),
        Pat::TupleStruct(t) => t.elems.iter().any(pat_binds),
        Pat::Slice(s) => s.elems.iter().any(pat_binds),
        Pat::Type(t) => pat_binds(&t.pat),
        _ => false,
    }
}

/// `&mut T`, `Option<&mut T>` and the like: what the function returns aliases its argument.
fn returns_mut_ref(t: &syn::Type) -> bool {
    use quote::ToTokens;
    t.to_token_stream().to_string().contains("& mut")
}

/// Whether a pattern has a `ref mut` binding.
fn pat_ref_mut(p: &Pat) -> bool {
    match p {
        Pat::Ident(pi) => (pi.by_ref.is_some() && pi.mutability.is_some()) || pi.subpat.as_ref().is_some_and(|(_, sp)| pat_ref_mut(sp)),
        Pat::Or(o) => o.cases.iter().any(pat_ref_mut),
        Pat::Paren(pp) => pat_ref_mut(&pp.pat),
        Pat::Reference(r) => pat_ref_mut(&r.pat),
        Pat::Struct(s) => s.fields.iter().any(|f| pat_ref_mut(&f.pat)),
        Pat::Tuple(t) => t.elems.iter().any(pat_ref_mut),
        Pat::TupleStruct(t) => t.elems.iter().any(pat_ref_mut),
        Pat::Slice(s) => s.elems.iter().any(pat_ref_mut),
        Pat::Type(t) => pat_ref_mut(&t.pat),
        _ => false,
    }
}

/// A place expression: a variable, a field or an element of one (matching it needs no copy, and it can be pointed to).
fn is_place(e: &Expr) -> bool {
    match e {
        Expr::Path(p) => p.path.segments.len() == 1,
        Expr::Field(f) => is_place(&f.base),
        Expr::Index(i) => is_place(&i.expr),
        Expr::Paren(p) => is_place(&p.expr),
        Expr::Unary(u) if matches!(u.op, syn::UnOp::Deref(_)) => is_place(&u.expr),
        _ => false,
    }
}

/// Whether a shape holds a type parameter or a type odingen couldn't resolve.
fn shape_unknown(s: &Shape) -> bool {
    match s {
        Shape::Param(_) | Shape::Unknown(_) => true,
        Shape::Option(i) | Shape::OptPtr(i, _) | Shape::Ptr(i, _) | Shape::Vec(i) | Shape::PVec(i) | Shape::Array(i, _) => shape_unknown(i),
        Shape::Result(a, b) | Shape::Map(a, b) => shape_unknown(a) || shape_unknown(b),
        Shape::Tuple(v) => v.iter().any(shape_unknown),
        Shape::Named(_, a) => a.iter().any(shape_unknown),
        _ => false,
    }
}

/// A shape's kind in a few words, for the translate report.
pub fn shape_kind(s: &Shape) -> String {
    match s {
        Shape::Named(n, _) => format!("Named {n}"),
        Shape::Ptr(i, _) => format!("Ptr<{}>", shape_kind(i)),
        Shape::Map(..) => "Map".into(),
        Shape::PVec(_) => "PVec".into(),
        Shape::Option(_) => "Option".into(),
        Shape::Vec(_) => "Vec".into(),
        Shape::Array(..) => "Array".into(),
        Shape::Str => "Str".into(),
        other => format!("{other:?}").chars().take(20).collect(),
    }
}

/// What makes a signature generic beyond lifetimes: None when only lifetimes.
pub fn generic_kind(sig: &syn::Signature) -> Option<&'static str> {
    use quote::ToTokens;
    let mut kind = None;
    for p in &sig.generics.params {
        match p {
            syn::GenericParam::Lifetime(_) => {}
            syn::GenericParam::Const(_) => kind = Some("const parameter"),
            syn::GenericParam::Type(t) => {
                let b = t.bounds.to_token_stream().to_string();
                let w = sig.generics.where_clause.to_token_stream().to_string();
                kind = Some(if b.contains("Fn") || w.contains("Fn") { "closure parameter" } else { "type parameter" });
            }
        }
    }
    // `impl Iterator<Item = T>` / `impl IntoIterator<Item = T>` parameters are Vecs (translated logic materializes
    // iterators); other `impl Trait` parameters need monomorphizing.
    for i in &sig.inputs {
        let FnArg::Typed(t) = i else { continue };
        let ty = t.ty.to_token_stream().to_string();
        if !ty.contains("impl ") {
            continue;
        }
        let iterator = (ty.contains("Iterator <") || ty.contains("Iterator<")) && ty.contains("Item") && !ty.contains("Fn");
        if !iterator && kind.is_none() {
            kind = Some(if ty.contains("Fn") { "closure parameter" } else { "impl Trait argument" });
        }
    }
    kind
}

/// A closure instance of `f` (closures.rs): its closure parameters dropped (calls of them inline the closures),
/// generic closure types gone with them, the captures as extra parameters.
pub fn translate_instance(e: &mut Emitter, owner: Option<&str>, name: &str, f: &FnDef, iname: &str, closures: &[(usize, crate::closures::ClosureInfo)], cap_params: &[String]) -> R<String> {
    let skip: BTreeSet<usize> = closures.iter().map(|c| c.0).collect();
    let mut g = f.clone();
    let mut map = BTreeMap::new();
    let mut ti = 0;
    let mut closure_types = BTreeSet::new();
    g.sig.inputs = f
        .sig
        .inputs
        .iter()
        .filter(|inp| match inp {
            FnArg::Receiver(_) => true,
            FnArg::Typed(pt) => {
                let this = ti;
                ti += 1;
                if skip.contains(&this) {
                    if let Pat::Ident(pi) = &*pt.pat {
                        let info = closures.iter().find(|c| c.0 == this).map(|c| c.1.clone()).expect("closure");
                        map.insert(pi.ident.to_string(), info);
                    }
                    closure_types.insert(pt.ty.to_token_stream().to_string().trim_start_matches("& mut ").trim_start_matches("& ").to_string());
                    false
                } else {
                    true
                }
            }
        })
        .cloned()
        .collect();
    // Type parameters that were the closures' types go; any other makes it a generic function still.
    g.sig.generics.params = f.sig.generics.params.iter().filter(|p| !matches!(p, syn::GenericParam::Type(t) if closure_types.contains(&t.ident.to_string()))).cloned().collect();
    g.sig.generics.where_clause = None;
    let saved_closures = crate::closures::CLOSURES.with(|c| std::mem::replace(&mut *c.borrow_mut(), map));
    let saved_file = crate::translate::CURRENT_FILE.with(|c| c.borrow().clone());
    let saved_touch = crate::translate::TOUCHES_UNLOGGED.with(|t| t.get());
    let r = translate_fn_with(e, owner, name, &g, Some(iname), cap_params);
    crate::closures::CLOSURES.with(|c| *c.borrow_mut() = saved_closures);
    crate::translate::CURRENT_FILE.with(|c| *c.borrow_mut() = saved_file);
    crate::translate::TOUCHES_UNLOGGED.with(|t| t.set(saved_touch));
    r.map(|t| t.code)
}

/// A closure body with statements, inlined where its value is needed: a block assigning a result (none for unit).
pub fn inline_block(tx: &mut Tx, block: &Block, shape: &Shape) -> R<String> {
    let unit = matches!(shape, Shape::Unit);
    tx.temps += 1;
    let res = format!("cr{}_", tx.temps);
    let label = format!("cb{}_", tx.temps);
    let outer = std::mem::take(&mut tx.pre);
    // `?` inside leaves this block with None/Err as the value (translate.rs, Expr::Try).
    let saved_exit = crate::translate::TRY_EXIT.with(|t| t.replace(Some((label.clone(), res.clone(), shape.clone()))));
    let saved_return = crate::translate::RETURN_EXIT.with(|t| t.replace(Some((label.clone(), if unit { String::new() } else { res.clone() }, shape.clone()))));
    let target = if unit { None } else { Some(Target { ident: res.clone(), shape: Some(shape.clone()), weak: false, infer: false }) };
    let mut b = Body { tx, out: String::new(), indent: 1, ret: Shape::Unit, declared: Default::default(), target, loops: Vec::new() };
    let r = b.block(block, !unit);
    let code = std::mem::take(&mut b.out);
    let tx = b.tx;
    crate::translate::TRY_EXIT.with(|t| t.replace(saved_exit));
    crate::translate::RETURN_EXIT.with(|t| t.replace(saved_return));
    tx.pre = outer;
    r?;
    if !unit {
        tx.pre.push(format!("{res}: {}", tx.e.odin(shape)));
    }
    tx.pre.push(format!("{label}: {{\n{code}}}"));
    Ok(if unit { String::new() } else { res })
}

/// The shape of a block's value, by a dry run of its statements (nothing is kept).
pub fn infer_block_shape(tx: &mut Tx, block: &Block) -> Option<Shape> {
    let (vars, temps) = (tx.vars.clone(), tx.temps);
    let names = PROC_NAMES.with(|p| p.borrow().clone());
    let outer = std::mem::take(&mut tx.pre);
    let saved_exit = crate::translate::TRY_EXIT.with(|t| t.replace(Some((String::new(), String::new(), Shape::Unknown("dry run".into())))));
    let saved_return = crate::translate::RETURN_EXIT.with(|t| t.replace(Some((String::new(), String::new(), Shape::Unknown("dry run".into())))));
    let target = Some(Target { ident: String::new(), shape: None, weak: false, infer: true });
    let mut b = Body { tx, out: String::new(), indent: 1, ret: Shape::Unit, declared: Default::default(), target, loops: Vec::new() };
    let _ = b.block(block, true);
    let shape = b.target.take().and_then(|t| t.shape);
    let tx = b.tx;
    crate::translate::TRY_EXIT.with(|t| t.replace(saved_exit));
    crate::translate::RETURN_EXIT.with(|t| t.replace(saved_return));
    tx.vars = vars;
    tx.temps = temps;
    tx.pre = outer;
    PROC_NAMES.with(|p| *p.borrow_mut() = names);
    shape
}

/// A generic function translated for concrete types (monomorphized): its type parameters substituted.
pub fn translate_generic_instance(e: &mut Emitter, owner: Option<&str>, name: &str, f: &FnDef, iname: &str, binding: &BTreeMap<String, Shape>) -> R<String> {
    let mut g = f.clone();
    g.sig.generics.params = f.sig.generics.params.iter().filter(|p| !matches!(p, syn::GenericParam::Type(t) if binding.contains_key(&t.ident.to_string()))).cloned().collect();
    g.sig.generics.where_clause = None;
    let saved_subst = e.subst.clone();
    for (k, v) in binding {
        e.subst.insert(k.clone(), v.clone());
    }
    let saved_closures = crate::closures::CLOSURES.with(|c| std::mem::take(&mut *c.borrow_mut()));
    let saved_file = crate::translate::CURRENT_FILE.with(|c| c.borrow().clone());
    let saved_touch = crate::translate::TOUCHES_UNLOGGED.with(|t| t.get());
    let r = translate_fn_with(e, owner, name, &g, Some(iname), &[]);
    crate::closures::CLOSURES.with(|c| *c.borrow_mut() = saved_closures);
    crate::translate::CURRENT_FILE.with(|c| *c.borrow_mut() = saved_file);
    crate::translate::TOUCHES_UNLOGGED.with(|t| t.set(saved_touch));
    e.subst = saved_subst;
    r.map(|t| t.code)
}

/// The call graph from a root (calls and method calls matched by name to every function of that name) and, over
/// what it reaches, how much translates and what blocks the rest.
fn reach_report(fns: &[((Option<String>, String), FnDef)], root: &str, translated: &BTreeSet<String>, why: &BTreeMap<String, String>) {
    struct Calls(BTreeSet<String>);
    impl<'ast> syn::visit::Visit<'ast> for Calls {
        fn visit_expr_call(&mut self, c: &'ast syn::ExprCall) {
            if let Expr::Path(p) = &*c.func {
                if let Some(l) = p.path.segments.last() {
                    self.0.insert(l.ident.to_string());
                }
            }
            syn::visit::visit_expr_call(self, c);
        }
        fn visit_expr_method_call(&mut self, m: &'ast syn::ExprMethodCall) {
            self.0.insert(m.method.to_string());
            syn::visit::visit_expr_method_call(self, m);
        }
        fn visit_expr_path(&mut self, p: &'ast syn::ExprPath) {
            // A function passed by name (`.map(helper)`).
            if let Some(l) = p.path.segments.last() {
                self.0.insert(l.ident.to_string());
            }
        }
    }
    let mut by_name: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut calls: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for ((owner, name), d) in fns {
        let p = proc_name_for(owner.as_deref(), name, d);
        by_name.entry(name.clone()).or_default().push(p.clone());
        let mut v = Calls(BTreeSet::new());
        syn::visit::visit_block(&mut v, &d.block);
        calls.entry(p).or_default().extend(v.0);
    }
    let mut seen = BTreeSet::new();
    let mut queue = vec![root.to_string()];
    while let Some(p) = queue.pop() {
        if !seen.insert(p.clone()) {
            continue;
        }
        for n in calls.get(&p).into_iter().flatten() {
            for q in by_name.get(n).into_iter().flatten() {
                if !seen.contains(q) {
                    queue.push(q.clone());
                }
            }
        }
    }
    let reached: Vec<&String> = seen.iter().filter(|p| calls.contains_key(*p)).collect();
    let ok = reached.iter().filter(|p| translated.contains(**p)).count();
    println!("reach from {root}: {} functions, translated {ok} ({:.1}%)", reached.len(), 100.0 * ok as f64 / reached.len().max(1) as f64);
    let mut reasons: BTreeMap<&str, usize> = BTreeMap::new();
    for p in &reached {
        if let Some(r) = why.get(*p) {
            *reasons.entry(r.as_str()).or_default() += 1;
        }
    }
    let mut rs: Vec<_> = reasons.into_iter().collect();
    rs.sort_by(|a, b| b.1.cmp(&a.1));
    for (r, n) in rs.iter().take(25) {
        println!("  {n:>6}  {r}");
    }
}
