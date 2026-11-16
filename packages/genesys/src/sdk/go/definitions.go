package main

import (
	"go/ast"
	"go/types"
	"strings"

	"golang.org/x/tools/go/packages"
)

type definitionIndex struct {
	byObject      map[types.Object]candidate
	byPackage     map[*packages.Package][]candidate
	selectedPaths map[string]bool
}

func (a *analyzer) collectDefinitions(pkgs []*packages.Package, pkgroot string, byPath map[string]entry) definitionIndex {
	seenEntries := map[string]bool{}
	all := map[types.Object]candidate{}
	perPackage := map[*packages.Package][]candidate{}
	for _, p := range pkgs {
		for _, e := range p.Errors {
			severity := "error"
			if strings.Contains(e.Error(), "RegisterGenesys") || strings.Contains(e.Error(), "zz_genesys_registration.go") || strings.Contains(e.Error(), "/gsysregistration") {
				severity = "warning"
			}
			a.report("go.package-diagnostic", severity, e.Error(), location{Path: relative(a.root, pkgroot)})
		}
		for _, file := range p.Syntax {
			path := a.loc(p.Fset, file.Pos()).Path
			e, found := byPath[path]
			if !found {
				continue
			}
			seenEntries[path] = true
			for _, decl := range file.Decls {
				fn, ok := decl.(*ast.FuncDecl)
				if !ok {
					continue
				}
				obj, ok := p.TypesInfo.Defs[fn.Name].(*types.Func)
				if !ok {
					a.report("go.unresolved-symbol", "warning", "Go could not resolve this function; retain explicit native assembly.", a.loc(p.Fset, fn.Pos()))
					continue
				}
				sig := obj.Type().(*types.Signature)
				if e.Role == "worker" {
					if file.Name.Name == "main" && fn.Name.Name == "main" {
						a.addWorker(p, e, pkgroot)
					}
					continue
				}
				if fn.Name.Name == "init" || strings.HasPrefix(fn.Name.Name, "RegisterGenesys") {
					continue
				}
				c := candidate{Object: obj, Expression: obj.Name(), Definition: definition{ID: path + ":" + obj.FullName(), Source: a.loc(p.Fset, fn.Pos()), EntryID: e.ID, Language: "go", Kind: e.Role, Symbol: obj.FullName(), Identity: identity{Name: obj.Name(), State: "resolved"}}}
				if e.Role == "nexus" {
					if sig.Results().Len() < 1 || sig.Results().Len() > 2 || !service(sig.Results().At(0).Type()) {
						continue
					}
					c.Service = true
					c.Definition.Identity = identity{State: "dynamic", Reason: "The service name is owned by the native service returned at runtime."}
					c.Definition.Construction = &construction{Symbol: obj.FullName(), Reason: "Pass the application-owned service returned by this native factory; Genesys does not invoke it during analysis."}
				} else if !a.callable(sig, e.Role == "workflow") {
					a.report("go.native-signature-excluded", "info", "Function does not have the native "+e.Role+" signature; retained as helper or explicit native assembly.", a.loc(p.Fset, fn.Pos()))
					continue
				}
				if sig.Recv() != nil {
					if !obj.Exported() && e.Role == "activity" {
						a.report("go.private-method-excluded", "info", "Unexported methods are outside native struct Activity registration; explicit registration remains available.", a.loc(p.Fset, fn.Pos()))
						continue
					}
					c.Receiver = sig.Recv().Type()
					c.Definition.Construction = &construction{Symbol: types.TypeString(c.Receiver, nil), Reason: "Pass the existing application-owned receiver instance."}
				}
				all[obj] = c
				perPackage[p] = append(perPackage[p], c)
			}
			if e.Role == "workflow" || e.Role == "activity" {
				for _, c := range a.callableVariables(p, file, e) {
					all[c.Object] = c
					perPackage[p] = append(perPackage[p], c)
				}
			}
			if e.Role == "nexus" {
				for _, c := range a.serviceVariables(p, file, e) {
					all[c.Object] = c
					perPackage[p] = append(perPackage[p], c)
				}
			}
		}
	}
	return definitionIndex{all, perPackage, seenEntries}
}

func (a *analyzer) callableVariables(p *packages.Package, file *ast.File, e entry) []candidate {
	cs := []candidate{}
	for _, decl := range file.Decls {
		g, ok := decl.(*ast.GenDecl)
		if !ok {
			continue
		}
		for _, spec := range g.Specs {
			v, ok := spec.(*ast.ValueSpec)
			if !ok {
				continue
			}
			for i, n := range v.Names {
				obj := p.TypesInfo.Defs[n]
				if obj == nil {
					continue
				}
				sig, ok := obj.Type().Underlying().(*types.Signature)
				if !ok || !a.callable(sig, e.Role == "workflow") {
					continue
				}
				if i >= len(v.Values) {
					a.report("go.callable-value-unresolved", "warning", "Callable variable requires explicit native assembly because its value is not statically known.", a.loc(p.Fset, n.Pos()))
					continue
				}
				target, ok := object(p.TypesInfo, v.Values[i]).(*types.Func)
				if !ok {
					a.report("go.callable-value-unresolved", "warning", "Closure or computed callable requires explicit native registration with a stable Name override.", a.loc(p.Fset, n.Pos()))
					continue
				}
				cs = append(cs, candidate{Object: obj, Expression: n.Name, Definition: definition{ID: e.Path + ":" + n.Name, Source: a.loc(p.Fset, n.Pos()), EntryID: e.ID, Language: "go", Kind: e.Role, Symbol: p.PkgPath + "." + n.Name, Identity: identity{Name: target.Name(), State: "resolved"}}})
			}
		}
	}
	return cs
}

func (a *analyzer) serviceVariables(p *packages.Package, file *ast.File, e entry) []candidate {
	cs := []candidate{}
	for _, decl := range file.Decls {
		g, ok := decl.(*ast.GenDecl)
		if !ok {
			continue
		}
		for _, spec := range g.Specs {
			v, ok := spec.(*ast.ValueSpec)
			if !ok {
				continue
			}
			for i, n := range v.Names {
				obj := p.TypesInfo.Defs[n]
				if obj == nil || !service(obj.Type()) {
					continue
				}
				id := identity{State: "dynamic", Reason: "Native service name could not be resolved statically."}
				if i < len(v.Values) {
					if call, ok := v.Values[i].(*ast.CallExpr); ok && len(call.Args) > 0 {
						if callee := object(p.TypesInfo, call.Fun); callee != nil && callee.Pkg() != nil && callee.Pkg().Path() == "github.com/nexus-rpc/sdk-go/nexus" && callee.Name() == "NewService" {
							if name, ok := stringValue(p.TypesInfo, call.Args[0]); ok {
								id = identity{Name: name, State: "resolved"}
							}
						}
					}
				}
				cs = append(cs, candidate{Object: obj, Expression: n.Name, Definition: definition{ID: e.Path + ":" + n.Name, Source: a.loc(p.Fset, n.Pos()), EntryID: e.ID, Language: "go", Kind: "nexus", Symbol: p.PkgPath + "." + n.Name, Identity: id}})
			}
		}
	}
	return cs
}
