//! Whole-function translation (docs/odin-port.md, "The translator's next layer"): a Rust function becomes an Odin
//! procedure, statement by statement, on top of the expression translator (translate.rs, in call mode). Anything it
//! doesn't handle is refused with the construct that stopped it, which `odingen translate-report` ranks; nothing is
//! guessed.

use std::collections::BTreeMap;
use std::fmt::Write;

use syn::{Block, Expr, FnArg, Pat, ReturnType, Stmt};

use crate::emit::{Emitter, Shape};
use crate::model::{Fields, FnDef};
use crate::translate::{proc_name, Tx};

type R<T> = Result<T, String>;

pub struct Translated {
    pub name: String,
    pub code: String,
}

/// The Odin signature of a function (`(params) -> ret`), and the Rust `mut` parameters needing a local copy.
fn signature(tx: &mut Tx, owner: Option<&str>, f: &FnDef) -> R<(String, Shape, Vec<String>)> {
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
                tx.vars.insert("self".into(), ("self_".into(), sh));
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
    let ret = match &f.sig.output {
        ReturnType::Default => Shape::Unit,
        ReturnType::Type(_, t) => self_shape(tx, t, owner).map_err(|e| format!("return {e}"))?,
    };
    let ret_ty = if matches!(ret, Shape::Unit) { String::new() } else { format!(" -> {}", tx.e.odin(&ret)) };
    Ok((format!("({}){ret_ty}", params.join(", ")), ret, mut_params))
}

/// A stand-in for a function not translated yet, with its real signature, so translated callers type-check;
/// calling it stops the program, naming the function.
pub fn stub_fn(e: &mut Emitter, owner: Option<&str>, name: &str, f: &FnDef, why: &str) -> R<Translated> {
    if !f.sig.generics.params.is_empty() || owner.and_then(|o| e.def(o)).is_some_and(|d| !d.generics.is_empty()) {
        return Err("generic function".into());
    }
    let mut tx = Tx { e, vars: BTreeMap::new(), self_ty: owner.map(str::to_string), depth: 0, calls: true, pre: Vec::new(), fn_ret: Shape::Unit, temps: 0 };
    let (sig, _, _) = signature(&mut tx, owner, f)?;
    let pname = proc_name(owner, name);
    let msg = crate::translate::odin_string(&format!("not translated yet: {pname} ({why})"));
    Ok(Translated { name: pname.clone(), code: format!("{pname} :: proc{sig} {{\n\tpanic({msg})\n}}\n") })
}

struct Body<'t, 'a, 'b> {
    tx: &'t mut Tx<'a, 'b>,
    out: String,
    indent: usize,
    ret: Shape,
    /// Odin names declared in this procedure: a Rust shadowing `let` gets a fresh one (`x_2`).
    declared: std::collections::BTreeSet<String>,
}

pub fn translate_fn(e: &mut Emitter, owner: Option<&str>, name: &str, f: &FnDef) -> R<Translated> {
    if !f.sig.generics.params.is_empty() {
        return Err("generic function".into());
    }
    if owner.and_then(|o| e.def(o)).is_some_and(|d| !d.generics.is_empty()) {
        return Err("method of a generic type".into());
    }
    if f.sig.asyncness.is_some() || f.sig.unsafety.is_some() {
        return Err("async or unsafe function".into());
    }
    let mut tx = Tx { e, vars: BTreeMap::new(), self_ty: owner.map(str::to_string), depth: 0, calls: true, pre: Vec::new(), fn_ret: Shape::Unit, temps: 0 };
    let (sig, ret, mut_params) = signature(&mut tx, owner, f)?;
    tx.fn_ret = ret.clone();
    let pname = proc_name(owner, name);
    let mut b = Body { tx: &mut tx, out: String::new(), indent: 1, ret, declared: Default::default() };
    for (_, (odin, _)) in b.tx.vars.clone() {
        b.declared.insert(odin.trim_end_matches('^').to_string());
    }
    // Odin parameters can't be assigned; a Rust `mut` parameter is a local copy.
    for p in &mut_params {
        b.line(&format!("{p} := {p}"));
    }
    b.block(&f.block, true)?;
    let code = format!("{pname} :: proc{sig} {{\n{}}}\n", b.out);
    Ok(Translated { name: pname, code })
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
                Stmt::Local(l) => self.local(l)?,
                Stmt::Expr(e, None) if last && tail && !matches!(self.ret, Shape::Unit) => self.tail_expr(e)?,
                Stmt::Expr(e, _) => self.stmt_expr(e)?,
                Stmt::Item(_) => return Err("item inside a function".into()),
                Stmt::Macro(_) => return Err("statement macro".into()),
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
            _ => {
                let ret = self.ret.clone();
                let v = self.tx.expr(e, &ret)?;
                self.line(&format!("return {v}"));
                Ok(())
            }
        }
    }

    fn local(&mut self, l: &syn::Local) -> R<()> {
        if l.init.as_ref().is_some_and(|i| i.diverge.is_some()) {
            return Err("let else".into());
        }
        let (pat, ty) = match &l.pat {
            Pat::Type(pt) => (&*pt.pat, Some(&*pt.ty)),
            p => (p, None),
        };
        let Pat::Ident(pi) = pat else { return Err("let pattern".into()) };
        let name = pi.ident.to_string();
        let init = l.init.as_ref().ok_or("let without a value")?;
        let sh = match ty {
            Some(t) => self.tx.e.shape(t, &[]),
            None => self.shape_of(&init.expr).ok_or("let of an untyped value")?,
        };
        let v = self.tx.expr(&init.expr, &sh)?;
        let ident = self.fresh(&local_ident(&name));
        self.line(&format!("{ident}: {} = {v}", self.tx.e.odin(&sh)));
        self.tx.vars.insert(name, (ident, sh));
        Ok(())
    }

    /// An Odin name not yet declared in this procedure.
    fn fresh(&mut self, base: &str) -> String {
        let mut n = base.to_string();
        let mut i = 2;
        while self.declared.contains(&n) {
            n = format!("{base}_{i}");
            i += 1;
        }
        self.declared.insert(n.clone());
        n
    }

    fn shape_of(&mut self, e: &Expr) -> Option<Shape> {
        self.tx.shape_of_pub(e)
    }

    fn stmt_expr(&mut self, e: &Expr) -> R<()> {
        match e {
            Expr::If(i) => self.if_expr(i, false),
            Expr::Match(m) => self.match_expr(m, false),
            Expr::Return(r) => {
                match &r.expr {
                    Some(v) => {
                        let ret = self.ret.clone();
                        let v = self.tx.expr(v, &ret)?;
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
                let c = self.tx.expr(&w.cond, &Shape::Bool)?;
                self.line(&format!("for {c} {{"));
                self.indent += 1;
                self.block(&w.body, false)?;
                self.indent -= 1;
                self.line("}");
                Ok(())
            }
            Expr::Loop(lp) => {
                self.line("for {");
                self.indent += 1;
                self.block(&lp.body, false)?;
                self.indent -= 1;
                self.line("}");
                Ok(())
            }
            Expr::Break(b) if b.expr.is_none() && b.label.is_none() => {
                self.line("break");
                Ok(())
            }
            Expr::Continue(c) if c.label.is_none() => {
                self.line("continue");
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
                self.line(&v);
                Ok(())
            }
            other => Err(format!("statement {}", kind(other))),
        }
    }

    fn if_expr(&mut self, i: &syn::ExprIf, tail: bool) -> R<()> {
        if let Expr::Let(l) = &*i.cond {
            // `if let Some(x) = opt` → `if x, ok := opt.?; ok`.
            let Pat::TupleStruct(ts) = &*l.pat else { return Err("if let pattern".into()) };
            let segs: Vec<String> = ts.path.segments.iter().map(|s| s.ident.to_string()).collect();
            if segs.last().map(String::as_str) != Some("Some") || ts.elems.len() != 1 {
                return Err("if let on something other than Some".into());
            }
            let Pat::Ident(pi) = &ts.elems[0] else { return Err("if let Some binding".into()) };
            let sh = self.shape_of(&l.expr).ok_or("if let on an untyped value")?;
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

    fn match_expr(&mut self, m: &syn::ExprMatch, tail: bool) -> R<()> {
        let sh = self.shape_of(&m.expr).ok_or("match on an untyped value")?;
        let Shape::Named(en, _) = &sh else { return Err("match on a non-enum".into()) };
        let en = en.clone();
        let Some((unit, _)) = self.tx.enum_variants_pub(&en) else { return Err("match on a non-enum".into()) };
        let subject = self.tx.expr(&m.expr, &sh)?;
        if unit {
            self.line(&format!("#partial switch {subject} {{"));
        } else {
            self.line(&format!("#partial switch v_ in {subject} {{"));
        }
        let mut has_default = false;
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
        self.line("}");
        if tail && !has_default {
            // Odin can't see that the switch covers every case; Rust did.
            self.line("unreachable()");
        }
        Ok(())
    }

    fn for_loop(&mut self, fl: &syn::ExprForLoop) -> R<()> {
        let Pat::Ident(pi) = &*fl.pat else { return Err("for pattern".into()) };
        let name = pi.ident.to_string();
        let ident = local_ident(&name);
        // `a..b` ranges.
        if let Expr::Range(rg) = &*fl.expr {
            let (Some(a), Some(b)) = (&rg.start, &rg.end) else { return Err("open range".into()) };
            let sh = self.shape_of(a).or_else(|| self.shape_of(b)).unwrap_or(Shape::Int("int"));
            let (a, b) = (self.tx.expr(a, &sh)?, self.tx.expr(b, &sh)?);
            let op = if matches!(rg.limits, syn::RangeLimits::Closed(_)) { "..=" } else { "..<" };
            self.line(&format!("for {ident} in {a} {op} {b} {{"));
            let saved = self.tx.vars.insert(name.clone(), (ident, sh));
            self.indent += 1;
            self.block(&fl.body, false)?;
            self.indent -= 1;
            self.line("}");
            restore(&mut self.tx.vars, name, saved);
            return Ok(());
        }
        // `for x in &v`, `for x in v.iter()`.
        let coll = match &*fl.expr {
            Expr::MethodCall(mc) if mc.method == "iter" && mc.args.is_empty() => &*mc.receiver,
            Expr::Reference(r) => &*r.expr,
            e => e,
        };
        let sh = self.shape_of(coll).ok_or("for over an untyped collection")?;
        let elem = match &sh {
            Shape::Vec(i) => (**i).clone(),
            _ => return Err("for over a non-Vec collection".into()),
        };
        let c = self.tx.expr(coll, &sh)?;
        self.line(&format!("for {ident} in {c} {{"));
        let saved = self.tx.vars.insert(name.clone(), (ident, elem));
        self.indent += 1;
        self.block(&fl.body, false)?;
        self.indent -= 1;
        self.line("}");
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
pub fn report(e: &mut Emitter, only: Option<&str>, out_file: Option<&std::path::Path>) {
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
        for f in ["hand_codecs.odin", "codec_runtime.odin", "pvec.odin"] {
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
    let fns: Vec<_> = fns.into_iter().filter(|((o, n), _)| !hand.contains(&proc_name(o.as_deref(), n))).collect();
    let mut ok = Vec::new();
    let mut stubs = Vec::new();
    let mut reasons: BTreeMap<String, usize> = BTreeMap::new();
    for ((owner, name), d) in &fns {
        match translate_fn(e, owner.as_deref(), name, d) {
            Ok(t) => ok.push(t),
            Err(r) => {
                if let Ok(st) = stub_fn(e, owner.as_deref(), name, d, &r) {
                    stubs.push(st);
                }
                *reasons.entry(r).or_default() += 1
            }
        }
    }
    println!("functions {}: translated {} ({:.1}%)", fns.len(), ok.len(), 100.0 * ok.len() as f64 / fns.len().max(1) as f64);
    let mut rs: Vec<_> = reasons.into_iter().collect();
    rs.sort_by(|a, b| b.1.cmp(&a.1));
    for (r, n) in rs.iter().take(40) {
        println!("  {n:>6}  {r}");
    }
    if let Some(path) = out_file {
        let mut code = String::from("// GENERATED by odingen translate-report: translated engine functions (work in progress).\npackage types\n\nimport \"../json\"\n\n_ :: json\n\n");
        let mut seen = std::collections::BTreeSet::new();
        for t in ok.iter().chain(stubs.iter()) {
            if seen.insert(t.name.clone()) {
                code.push_str(&t.code);
                code.push('\n');
            }
        }
        std::fs::write(path, code).unwrap();
    }
}
