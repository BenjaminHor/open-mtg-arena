//! Closures (docs/odin-port.md, "The translator's next layer"). Odin procedures can't capture, so a closure is never
//! a value in the translation:
//! - a local closure (`let f = |x| ..;`) is remembered, and each call `f(a)` inlines its body with its captures
//!   bound to the variables they name;
//! - a call passing a closure to an engine function (`any_object(state, |o| o.tapped)`) calls an *instance* of that
//!   function made for that closure: its closure parameter is gone, the closure's captures are extra parameters, and
//!   each call of the parameter inside inlines the closure. Captured locals pass by pointer (writes through an FnMut
//!   closure land in place), immutable parameters and loop variables by value. A closure handed on to another
//!   closure-taking function makes an instance of that one in turn.
//! Bodies with `return` or `?` (which would leave the wrong procedure once inlined) and `move` closures are refused.

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};

use quote::ToTokens;
use syn::{Expr, FnArg, Pat};

use crate::emit::Shape;
use crate::model::FnDef;
use crate::translate::Tx;

type R<T> = Result<T, String>;

#[derive(Clone)]
pub struct ClosureInfo {
    pub closure: syn::ExprClosure,
    /// The captured names as the procedure inlining it reaches them: (Rust name, Odin expression, shape).
    pub env: Vec<(String, String, Shape)>,
    /// The argument and result shapes, when a callee's bound gives them (`impl Fn(&GameObject) -> bool`).
    pub args: Option<Vec<Shape>>,
    pub ret: Option<Shape>,
    /// The closures visible where it was written: a name in its body means those, not the inlining site's
    /// (`|n| f(n)` passed as a callee's own `f` would otherwise call itself).
    pub scope: std::rc::Rc<BTreeMap<String, ClosureInfo>>,
}

/// The closures in scope now, for a closure written here.
pub fn scope_now() -> std::rc::Rc<BTreeMap<String, ClosureInfo>> {
    std::rc::Rc::new(CLOSURES.with(|c| c.borrow().clone()))
}

/// Runs `f` with a closure's own scope in place of the current one.
pub fn in_scope<T>(info: &ClosureInfo, f: impl FnOnce() -> T) -> T {
    let depth = INLINE_DEPTH.with(|d| d.get());
    let saved = CLOSURES.with(|c| std::mem::replace(&mut *c.borrow_mut(), (*info.scope).clone()));
    INLINE_DEPTH.with(|d| d.set(depth + 1));
    let r = f();
    INLINE_DEPTH.with(|d| d.set(depth));
    CLOSURES.with(|c| *c.borrow_mut() = saved);
    r
}

pub fn inline_depth() -> u32 {
    INLINE_DEPTH.with(|d| d.get())
}

thread_local! {
    /// Closures in scope by name: local closures, or an instance's closure parameters.
    pub static CLOSURES: RefCell<BTreeMap<String, ClosureInfo>> = RefCell::new(BTreeMap::new());
    /// Odin names that can't be pointed to: immutable parameters and loop variables (captured by value).
    pub static BY_VALUE: RefCell<BTreeSet<String>> = RefCell::new(BTreeSet::new());
    /// How many closure bodies are being inlined inside one another.
    pub static INLINE_DEPTH: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
    /// How many instances are being made inside one another.
    pub static DEPTH: std::cell::Cell<u32> = const { std::cell::Cell::new(0) };
    /// Instances made so far: key → procedure name, and their code.
    pub static INSTANCES: RefCell<(BTreeMap<String, String>, Vec<(String, String)>)> = RefCell::new((BTreeMap::new(), Vec::new()));
}

pub fn lookup(name: &str) -> Option<ClosureInfo> {
    CLOSURES.with(|c| c.borrow().get(name).cloned())
}

pub fn register(name: &str, info: ClosureInfo) {
    CLOSURES.with(|c| c.borrow_mut().insert(name.to_string(), info));
}

/// Names a closure body refers to that are variables of the enclosing procedure.
pub fn captures(tx: &Tx, c: &syn::ExprClosure) -> Vec<(String, String, Shape)> {
    struct V(BTreeSet<String>);
    impl<'ast> syn::visit::Visit<'ast> for V {
        fn visit_expr_path(&mut self, p: &'ast syn::ExprPath) {
            if p.path.segments.len() == 1 {
                self.0.insert(p.path.segments[0].ident.to_string());
            }
        }
    }
    let mut v = V(BTreeSet::new());
    syn::visit::visit_expr(&mut v, &c.body);
    v.0.into_iter().filter_map(|n| tx.vars.get(&n).map(|(o, s)| (n.clone(), o.clone(), s.clone()))).collect()
}

/// Whether a closure body has a `return` (outside nested closures).
pub fn has_return(e: &Expr) -> bool {
    struct V(bool);
    impl<'ast> syn::visit::Visit<'ast> for V {
        fn visit_expr_return(&mut self, _: &'ast syn::ExprReturn) {
            self.0 = true;
        }
        fn visit_expr_closure(&mut self, _: &'ast syn::ExprClosure) {}
    }
    let mut v = V(false);
    syn::visit::visit_expr(&mut v, e);
    v.0
}

/// A closure's argument and result types from an `Fn(A, B) -> R` bound.
fn fn_bound(bounds: &syn::punctuated::Punctuated<syn::TypeParamBound, syn::Token![+]>) -> Option<(Vec<syn::Type>, Option<syn::Type>)> {
    for b in bounds {
        let syn::TypeParamBound::Trait(t) = b else { continue };
        let seg = t.path.segments.last()?;
        if !matches!(seg.ident.to_string().as_str(), "Fn" | "FnMut" | "FnOnce") {
            continue;
        }
        let syn::PathArguments::Parenthesized(p) = &seg.arguments else { return None };
        let out = match &p.output {
            syn::ReturnType::Default => None,
            syn::ReturnType::Type(_, t) => Some((**t).clone()),
        };
        return Some((p.inputs.iter().cloned().collect(), out));
    }
    None
}

/// The closure parameters of a function: (parameter index among typed inputs, argument types, result type).
pub fn closure_params(f: &FnDef) -> Vec<(usize, Vec<syn::Type>, Option<syn::Type>)> {
    let mut out = Vec::new();
    let mut i = 0;
    for input in &f.sig.inputs {
        let FnArg::Typed(pt) = input else { continue };
        let mut ty = &*pt.ty;
        while let syn::Type::Reference(r) = ty {
            ty = &r.elem;
        }
        let bound = match ty {
            syn::Type::ImplTrait(it) => fn_bound(&it.bounds),
            syn::Type::TraitObject(to) => fn_bound(&to.bounds),
            syn::Type::Path(p) if p.path.segments.len() == 1 => {
                let name = p.path.segments[0].ident.to_string();
                let mut found = None;
                for gp in f.sig.generics.type_params() {
                    if gp.ident == name {
                        found = fn_bound(&gp.bounds);
                    }
                }
                if found.is_none() {
                    if let Some(w) = &f.sig.generics.where_clause {
                        for pred in &w.predicates {
                            if let syn::WherePredicate::Type(pt) = pred {
                                if pt.bounded_ty.to_token_stream().to_string() == name {
                                    found = fn_bound(&pt.bounds);
                                }
                            }
                        }
                    }
                }
                found
            }
            _ => None,
        };
        if let Some((args, ret)) = bound {
            out.push((i, args, ret));
        }
        i += 1;
    }
    out
}

/// A key naming an instance: the callee, the closures' text, and how each capture is passed.
pub fn instance_key(callee: &str, parts: &[String]) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    parts.hash(&mut h);
    format!("{callee}__cl{:08x}", h.finish() as u32)
}

/// A closure argument at a call site: the closure, or a function path as the closure `|a, ..| f(a, ..)`.
pub fn closure_arg(a: &Expr, arity: usize) -> Option<ClosureOrName> {
    match a {
        Expr::Closure(c) => Some(ClosureOrName::Closure(c.clone())),
        Expr::Reference(r) => closure_arg(&r.expr, arity),
        Expr::Paren(p) => closure_arg(&p.expr, arity),
        Expr::Path(p) if p.path.segments.len() == 1 && lookup(&p.path.segments[0].ident.to_string()).is_some() => {
            Some(ClosureOrName::Named(p.path.segments[0].ident.to_string()))
        }
        Expr::Path(p) if p.qself.is_none() => {
            let names: Vec<syn::Ident> = (0..arity).map(|i| syn::Ident::new(&format!("fa{i}_"), proc_macro2::Span::call_site())).collect();
            Some(ClosureOrName::Closure(syn::parse_quote!(|#(#names),*| #p(#(#names),*))))
        }
        _ => None,
    }
}

pub enum ClosureOrName {
    Closure(syn::ExprClosure),
    Named(String),
}

/// Whether a pattern list (closure parameters) is plain enough to bind: identifiers, references, tuples, wildcards.
pub fn simple_params(c: &syn::ExprClosure) -> bool {
    fn ok(p: &Pat) -> bool {
        match p {
            Pat::Ident(pi) => pi.subpat.is_none(),
            Pat::Wild(_) => true,
            Pat::Reference(r) => ok(&r.pat),
            Pat::Type(t) => ok(&t.pat),
            Pat::Tuple(t) => t.elems.iter().all(ok),
            _ => false,
        }
    }
    c.inputs.iter().all(ok)
}

/// Whether a closure's body calls any of these closures.
pub fn uses_any(c: &syn::ExprClosure, scope: &BTreeMap<String, ClosureInfo>) -> bool {
    struct V<'s>(&'s BTreeMap<String, ClosureInfo>, bool);
    impl<'ast> syn::visit::Visit<'ast> for V<'_> {
        fn visit_expr_path(&mut self, p: &'ast syn::ExprPath) {
            if p.path.segments.len() == 1 && self.0.contains_key(&p.path.segments[0].ident.to_string()) {
                self.1 = true;
            }
        }
    }
    let mut v = V(scope, false);
    syn::visit::visit_expr(&mut v, &c.body);
    v.1
}
