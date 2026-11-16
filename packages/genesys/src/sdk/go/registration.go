package main

import (
	"fmt"
	"go/ast"
	"go/types"
	"sort"
	"strings"

	"golang.org/x/tools/go/packages"
)

func (a *analyzer) generatedCall(p *packages.Package, call *ast.CallExpr, sel *ast.SelectorExpr, all map[types.Object]candidate, handlers map[types.Object]bool) bool {
	if !strings.HasPrefix(sel.Sel.Name, "RegisterGenesys") {
		return false
	}
	id, ok := sel.X.(*ast.Ident)
	if !ok {
		return false
	}
	pkg, ok := p.TypesInfo.ObjectOf(id).(*types.PkgName)
	if !ok {
		return false
	}
	for _, c := range all {
		if handlers[c.Object] {
			continue
		}
		if c.Object.Pkg() == nil || c.Object.Pkg().Path() != pkg.Imported().Path() || groupName(c) != sel.Sel.Name {
			continue
		}
		d := c.Definition
		d.Source = a.loc(p.Fset, call.Pos())
		d.ID += fmt.Sprintf(":generated:%s:%d", d.Source.Path, d.Source.Line)
		if scope := object(p.TypesInfo, call.Args[0]); scope != nil {
			position := a.loc(p.Fset, scope.Pos())
			d.RegistrationScope = fmt.Sprintf("go:%s:%s:%s:%d", p.PkgPath, scope.Name(), position.Path, position.Line)
		}
		a.output.Analysis.Definitions = append(a.output.Analysis.Definitions, d)
	}
	return true
}

func (a *analyzer) nativeRegistrations(p *packages.Package, all map[types.Object]candidate, handlers map[types.Object]bool) {
	for _, file := range p.Syntax {
		if strings.HasSuffix(a.loc(p.Fset, file.Pos()).Path, "zz_genesys_registration.go") || strings.HasSuffix(a.loc(p.Fset, file.Pos()).Path, "/gsysregistration/registration.go") {
			continue
		}
		ast.Inspect(file, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok || len(call.Args) == 0 {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if ok && a.generatedCall(p, call, sel, all, handlers) {
				return true
			}
			if !ok || !nativeMethod(p.TypesInfo, sel) {
				return true
			}
			name := sel.Sel.Name
			if !strings.HasPrefix(name, "Register") || (!strings.Contains(name, "Workflow") && !strings.Contains(name, "Activity") && !strings.Contains(name, "NexusService")) {
				return true
			}
			c, ok := all[object(p.TypesInfo, call.Args[0])]
			if !ok && (name == "RegisterActivity" || name == "RegisterActivityWithOptions") {
				actual := p.TypesInfo.TypeOf(call.Args[0])
				group := []candidate{}
				for _, item := range all {
					if item.Definition.Kind == "activity" && item.Receiver != nil && actual != nil && types.AssignableTo(actual, item.Receiver) {
						group = append(group, item)
					}
				}
				if len(group) > 0 {
					sort.Slice(group, func(i, j int) bool { return group[i].Definition.Symbol < group[j].Definition.Symbol })
					for _, item := range group {
						a.recordRegistration(p, call, sel, name, item, true)
					}
					return true
				}
			}
			if !ok {
				a.report("go.explicit-registration-unresolved", "warning", "Native "+name+" uses a dynamic, grouped, or external value. Scope and names need explicit native assembly; no default is inferred.", a.loc(p.Fset, call.Pos()))
				return true
			}
			a.recordRegistration(p, call, sel, name, c, false)
			return true
		})
	}
}

func (a *analyzer) recordRegistration(p *packages.Package, call *ast.CallExpr, sel *ast.SelectorExpr, name string, c candidate, grouped bool) {
	d := c.Definition
	d.Source = a.loc(p.Fset, call.Pos())
	d.ID += fmt.Sprintf(":registration:%s:%d", d.Source.Path, d.Source.Line)
	if scope := object(p.TypesInfo, sel.X); scope != nil {
		d.RegistrationScope = fmt.Sprintf("go:%s:%s:%s:%d", p.PkgPath, scope.Name(), a.loc(p.Fset, scope.Pos()).Path, a.loc(p.Fset, scope.Pos()).Line)
	}
	if strings.HasSuffix(name, "WithOptions") && len(call.Args) > 1 {
		lit, ok := call.Args[1].(*ast.CompositeLit)
		if !ok {
			d.Identity = identity{State: "dynamic", Reason: "Registration options are not a static literal."}
		} else {
			for _, elt := range lit.Elts {
				kv, ok := elt.(*ast.KeyValueExpr)
				if !ok {
					continue
				}
				key, ok := kv.Key.(*ast.Ident)
				if !ok || key.Name != "Name" {
					continue
				}
				if value, ok := stringValue(p.TypesInfo, kv.Value); ok {
					if value != "" {
						if grouped {
							value += c.Definition.Identity.Name
						}
						d.Identity = identity{Name: value, State: "resolved"}
					}
				} else {
					d.Identity = identity{State: "dynamic", Reason: "Registration name is not a compile-time string."}
				}
			}
		}
	}
	a.output.Analysis.Definitions = append(a.output.Analysis.Definitions, d)
}

func (a *analyzer) detectCollisions() {
	seen := map[string]definition{}
	for _, d := range a.output.Analysis.Definitions {
		if d.RegistrationScope == "" || d.Identity.State != "resolved" {
			continue
		}
		key := d.RegistrationScope + ":" + d.Kind + ":" + d.Identity.Name
		if previous, ok := seen[key]; ok {
			a.report("go.native-name-collision", "warning", fmt.Sprintf("Native registration repeats %s; first at %s:%d. Control flow and disable-check options remain native decisions.", d.Identity.Name, previous.Source.Path, previous.Source.Line), d.Source)
		}
		seen[key] = d
	}
}
