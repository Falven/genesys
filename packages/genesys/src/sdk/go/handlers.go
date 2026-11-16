package main

import (
	"go/ast"
	"go/types"

	"golang.org/x/tools/go/packages"
)

func (a *analyzer) messageHandlers(pkgs []*packages.Package) map[types.Object]bool {
	type expression struct {
		p    *packages.Package
		node ast.Expr
	}
	bindings := map[types.Object][]expression{}
	for _, p := range pkgs {
		for _, file := range p.Syntax {
			ast.Inspect(file, func(node ast.Node) bool {
				switch n := node.(type) {
				case *ast.ValueSpec:
					for i, name := range n.Names {
						if i < len(n.Values) {
							obj := p.TypesInfo.Defs[name]
							bindings[obj] = append(bindings[obj], expression{p, n.Values[i]})
						}
					}
				case *ast.AssignStmt:
					for i, lhs := range n.Lhs {
						if i < len(n.Rhs) {
							obj := object(p.TypesInfo, lhs)
							if obj != nil {
								bindings[obj] = append(bindings[obj], expression{p, n.Rhs[i]})
							}
						}
					}
				}
				return true
			})
		}
	}
	var values func(expression, map[types.Object]bool) []expression
	values = func(e expression, seen map[types.Object]bool) []expression {
		if paren, ok := e.node.(*ast.ParenExpr); ok {
			return values(expression{e.p, paren.X}, seen)
		}
		obj := object(e.p.TypesInfo, e.node)
		if obj == nil || len(bindings[obj]) == 0 || seen[obj] {
			return []expression{e}
		}
		seen[obj] = true
		resolved := []expression{}
		for _, value := range bindings[obj] {
			resolved = append(resolved, values(value, seen)...)
		}
		delete(seen, obj)
		return resolved
	}
	handlers := map[types.Object]bool{}
	mark := func(p *packages.Package, node ast.Expr) {
		if obj := object(p.TypesInfo, node); obj != nil {
			handlers[obj] = true
		}
		resolved := values(expression{p, node}, map[types.Object]bool{})
		ambiguous := len(resolved) != 1
		for _, value := range resolved {
			obj := object(value.p.TypesInfo, value.node)
			if _, ok := obj.(*types.Func); ok {
				handlers[obj] = true
			} else if _, literal := value.node.(*ast.FuncLit); !literal {
				ambiguous = true
			}
		}
		if ambiguous {
			a.report("go.message-handler-unresolved", "warning", "Native message handler or validator is not a unique static function. Resolved candidates are excluded from automatic registration; retain explicit native assembly.", a.loc(p.Fset, node.Pos()))
		}
	}
	for _, p := range pkgs {
		for _, file := range p.Syntax {
			ast.Inspect(file, func(node ast.Node) bool {
				if assignment, ok := node.(*ast.AssignStmt); ok {
					for i, lhs := range assignment.Lhs {
						if selector, ok := lhs.(*ast.SelectorExpr); ok && i < len(assignment.Rhs) && selector.Sel.Name == "Validator" && qualified(p.TypesInfo.TypeOf(selector.X), "go.temporal.io/sdk/internal", "UpdateHandlerOptions") {
							mark(p, assignment.Rhs[i])
						}
					}
				}
				call, ok := node.(*ast.CallExpr)
				if !ok || len(call.Args) < 3 {
					return true
				}
				for _, callee := range values(expression{p, call.Fun}, map[types.Object]bool{}) {
					obj := object(callee.p.TypesInfo, callee.node)
					if obj == nil || obj.Pkg() == nil || obj.Pkg().Path() != "go.temporal.io/sdk/workflow" {
						continue
					}
					switch obj.Name() {
					case "SetQueryHandler", "SetQueryHandlerWithOptions", "SetUpdateHandler", "SetUpdateHandlerWithOptions":
						mark(p, call.Args[2])
						if obj.Name() != "SetUpdateHandlerWithOptions" || len(call.Args) < 4 {
							continue
						}
						for _, options := range values(expression{p, call.Args[3]}, map[types.Object]bool{}) {
							lit, ok := options.node.(*ast.CompositeLit)
							if !ok {
								a.report("go.message-options-unresolved", "warning", "Native Update options are dynamic; validator references require explicit native assembly.", a.loc(p.Fset, call.Args[3].Pos()))
								continue
							}
							for _, field := range lit.Elts {
								if kv, ok := field.(*ast.KeyValueExpr); ok {
									if key, ok := kv.Key.(*ast.Ident); ok && key.Name == "Validator" {
										mark(options.p, kv.Value)
									}
								}
							}
						}
					}
				}
				return true
			})
		}
	}
	for obj, assigned := range bindings {
		for _, e := range assigned {
			for _, value := range values(e, map[types.Object]bool{}) {
				if handlers[object(value.p.TypesInfo, value.node)] {
					handlers[obj] = true
				}
			}
		}
	}
	return handlers
}
