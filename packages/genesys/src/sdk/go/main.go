// Genesys analyzes native types without executing authored programs.
package main

import (
	"encoding/json"
	"fmt"
	"go/ast"
	"go/constant"
	"go/format"
	"go/token"
	"go/types"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"golang.org/x/tools/go/packages"
)

type entry struct {
	DiscoveryRoot   string `json:"discoveryRoot"`
	ID              string `json:"id"`
	Path            string `json:"path"`
	Role            string `json:"role"`
	PackageID       string `json:"packageId"`
	WorkerName      string `json:"workerName"`
	WorkerDirectory string `json:"workerDirectory"`
}
type location struct {
	Path   string `json:"path"`
	Line   int    `json:"line,omitempty"`
	Column int    `json:"column,omitempty"`
}
type diagnostic struct {
	Code     string   `json:"code"`
	Severity string   `json:"severity"`
	Message  string   `json:"message"`
	Source   location `json:"source"`
}
type identity struct {
	Name   string `json:"name,omitempty"`
	State  string `json:"state"`
	Reason string `json:"reason,omitempty"`
}
type construction struct {
	Symbol string `json:"symbol"`
	Reason string `json:"reason"`
}
type definition struct {
	ID                string        `json:"id"`
	Source            location      `json:"source"`
	EntryID           string        `json:"entryId"`
	Language          string        `json:"language"`
	Kind              string        `json:"kind"`
	Symbol            string        `json:"symbol"`
	Identity          identity      `json:"identity"`
	RegistrationScope string        `json:"registrationScope,omitempty"`
	Construction      *construction `json:"construction,omitempty"`
}
type command struct {
	Executable string   `json:"executable"`
	Args       []string `json:"args"`
	Cwd        string   `json:"cwd"`
}
type worker struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Language  string         `json:"language"`
	PackageID string         `json:"packageId"`
	Source    location       `json:"source"`
	Build     []command      `json:"build"`
	Start     *command       `json:"start,omitempty"`
	Readiness map[string]any `json:"readiness"`
}
type artifact struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Kind    string `json:"kind"`
}
type analysis struct {
	Definitions []definition `json:"definitions"`
	Diagnostics []diagnostic `json:"diagnostics"`
	Workers     []worker     `json:"workers"`
}
type emission struct {
	Artifacts   []artifact   `json:"artifacts"`
	Diagnostics []diagnostic `json:"diagnostics"`
}
type result struct {
	Analysis analysis `json:"analysis"`
	Emission emission `json:"emission"`
}
type candidate struct {
	Definition definition
	Object     types.Object
	Receiver   types.Type
	Expression string
	Service    bool
}

var root string
var workflowContextType types.Type
var output = result{Analysis: analysis{Definitions: []definition{}, Diagnostics: []diagnostic{}, Workers: []worker{}}, Emission: emission{Artifacts: []artifact{}, Diagnostics: []diagnostic{}}}

func relative(base, path string) string {
	r, err := filepath.Rel(base, path)
	if err != nil {
		panic(err)
	}
	return filepath.ToSlash(r)
}
func loc(fset *token.FileSet, pos token.Pos) location {
	p := fset.Position(pos)
	return location{relative(root, p.Filename), p.Line, p.Column}
}
func report(code, severity, message string, source location) {
	output.Analysis.Diagnostics = append(output.Analysis.Diagnostics, diagnostic{code, severity, message, source})
}
func qualified(t types.Type, pkg, name string) bool {
	t = types.Unalias(t)
	if p, ok := t.(*types.Pointer); ok {
		t = types.Unalias(p.Elem())
	}
	n, ok := t.(*types.Named)
	return ok && n.Obj().Pkg() != nil && n.Obj().Pkg().Path() == pkg && n.Obj().Name() == name
}
func workflowContext(t types.Type) bool {
	return workflowContextType != nil && types.Identical(t, workflowContextType)
}
func service(t types.Type) bool {
	_, pointer := types.Unalias(t).(*types.Pointer)
	return pointer && qualified(t, "github.com/nexus-rpc/sdk-go/nexus", "Service")
}
func callable(sig *types.Signature, workflow bool) bool {
	if (sig.TypeParams() != nil && sig.TypeParams().Len() > 0) || (sig.RecvTypeParams() != nil && sig.RecvTypeParams().Len() > 0) {
		return false
	}
	if workflow && (sig.Params().Len() == 0 || !workflowContext(sig.Params().At(0).Type())) {
		return false
	}
	if !workflow {
		for i := 0; i < sig.Params().Len() && i < 2; i++ {
			if workflowContext(sig.Params().At(i).Type()) {
				return false
			}
		}
	}
	if sig.Results().Len() < 1 || sig.Results().Len() > 2 {
		return false
	}
	return types.Identical(sig.Results().At(sig.Results().Len()-1).Type(), types.Universe.Lookup("error").Type())
}
func object(info *types.Info, expression ast.Expr) types.Object {
	switch x := expression.(type) {
	case *ast.Ident:
		return info.ObjectOf(x)
	case *ast.SelectorExpr:
		if s := info.Selections[x]; s != nil {
			return s.Obj()
		}
		return info.ObjectOf(x.Sel)
	}
	return nil
}
func stringValue(info *types.Info, expr ast.Expr) (string, bool) {
	if v := info.Types[expr].Value; v != nil && v.Kind() == constant.String {
		return constant.StringVal(v), true
	}
	return "", false
}
func nativeMethod(info *types.Info, sel *ast.SelectorExpr) bool {
	obj := object(info, sel)
	return obj != nil && obj.Pkg() != nil && strings.HasPrefix(obj.Pkg().Path(), "go.temporal.io/sdk/")
}
func main() {
	if len(os.Args) == 2 && os.Args[1] == "--coverage" {
		coverageMain()
		return
	}
	if len(os.Args) != 3 {
		panic("expected project root and package root; entries on stdin")
	}
	root = os.Args[1]
	pkgroot := os.Args[2]
	var entries []entry
	if err := json.NewDecoder(os.Stdin).Decode(&entries); err != nil {
		panic(err)
	}
	byPath := map[string]entry{}
	for _, e := range entries {
		byPath[e.Path] = e
	}
	if value := os.Getenv("GSYS_ANALYSIS_GOWORK"); value != "" {
		os.Setenv("GOWORK", value)
	} else {
		os.Unsetenv("GOWORK")
	}
	os.Setenv("GOFLAGS", os.Getenv("GSYS_ANALYSIS_GOFLAGS"))
	if strings.Contains(os.Getenv("GOFLAGS"), "-toolexec") {
		panic("Static analysis does not execute a custom -toolexec command. Remove that GOFLAGS setting for inspection.")
	}
	os.Setenv("GOPACKAGESDRIVER", "off")
	config := &packages.Config{Dir: pkgroot, Mode: packages.NeedName | packages.NeedFiles | packages.NeedCompiledGoFiles | packages.NeedImports | packages.NeedDeps | packages.NeedTypes | packages.NeedSyntax | packages.NeedTypesInfo | packages.NeedModule, Tests: false, BuildFlags: []string{"-mod=readonly"}}
	pkgs, err := packages.Load(config, "./...")
	if err != nil {
		panic(err)
	}
	sort.Slice(pkgs, func(i, j int) bool { return pkgs[i].PkgPath < pkgs[j].PkgPath })
	seenEntries := map[string]bool{}
	sdkVersions := map[string]bool{}
	packages.Visit(pkgs, nil, func(p *packages.Package) {
		if p.PkgPath == "go.temporal.io/sdk/workflow" && p.Types != nil {
			if context := p.Types.Scope().Lookup("Context"); context != nil {
				workflowContextType = context.Type()
			}
		}
		if p.Module != nil && p.Module.Path == "go.temporal.io/sdk" {
			sdkVersions[p.Module.Version] = true
		}
	})
	for version := range sdkVersions {
		report("go.sdk-version", "info", "Resolved go.temporal.io/sdk "+version+"; registration APIs reviewed against released v1.51.0. Other versions are not compatibility-verified.", location{Path: relative(root, pkgroot)})
	}
	if len(sdkVersions) == 0 {
		report("go.sdk-unresolved", "error", "Go package loading did not resolve go.temporal.io/sdk. Install native module dependencies before analysis.", location{Path: relative(root, pkgroot)})
	}
	all := map[types.Object]candidate{}
	perPackage := map[*packages.Package][]candidate{}
	for _, p := range pkgs {
		for _, e := range p.Errors {
			severity := "error"
			if strings.Contains(e.Error(), "RegisterGenesys") || strings.Contains(e.Error(), "zz_genesys_registration.go") || strings.Contains(e.Error(), "/gsysregistration") {
				severity = "warning"
			}
			report("go.package-diagnostic", severity, e.Error(), location{Path: relative(root, pkgroot)})
		}
		for _, file := range p.Syntax {
			path := loc(p.Fset, file.Pos()).Path
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
					report("go.unresolved-symbol", "warning", "Go could not resolve this function; retain explicit native assembly.", loc(p.Fset, fn.Pos()))
					continue
				}
				sig := obj.Type().(*types.Signature)
				if e.Role == "worker" {
					if file.Name.Name == "main" && fn.Name.Name == "main" {
						addWorker(p, e, pkgroot)
					}
					continue
				}
				if fn.Name.Name == "init" || strings.HasPrefix(fn.Name.Name, "RegisterGenesys") {
					continue
				}
				c := candidate{Object: obj, Expression: obj.Name(), Definition: definition{ID: path + ":" + obj.FullName(), Source: loc(p.Fset, fn.Pos()), EntryID: e.ID, Language: "go", Kind: e.Role, Symbol: obj.FullName(), Identity: identity{Name: obj.Name(), State: "resolved"}}}
				if e.Role == "nexus" {
					if sig.Results().Len() < 1 || sig.Results().Len() > 2 || !service(sig.Results().At(0).Type()) {
						continue
					}
					c.Service = true
					c.Definition.Identity = identity{State: "dynamic", Reason: "The service name is owned by the native service returned at runtime."}
					c.Definition.Construction = &construction{Symbol: obj.FullName(), Reason: "Pass the application-owned service returned by this native factory; Genesys does not invoke it during analysis."}
				} else if !callable(sig, e.Role == "workflow") {
					report("go.native-signature-excluded", "info", "Function does not have the native "+e.Role+" signature; retained as helper or explicit native assembly.", loc(p.Fset, fn.Pos()))
					continue
				}
				if sig.Recv() != nil {
					if !obj.Exported() && e.Role == "activity" {
						report("go.private-method-excluded", "info", "Unexported methods are outside native struct Activity registration; explicit registration remains available.", loc(p.Fset, fn.Pos()))
						continue
					}
					c.Receiver = sig.Recv().Type()
					c.Definition.Construction = &construction{Symbol: types.TypeString(c.Receiver, nil), Reason: "Pass the existing application-owned receiver instance."}
				}
				all[obj] = c
				perPackage[p] = append(perPackage[p], c)
			}
			if e.Role == "workflow" || e.Role == "activity" {
				for _, c := range callableVariables(p, file, e) {
					all[c.Object] = c
					perPackage[p] = append(perPackage[p], c)
				}
			}
			if e.Role == "nexus" {
				for _, c := range serviceVariables(p, file, e) {
					all[c.Object] = c
					perPackage[p] = append(perPackage[p], c)
				}
			}
		}
	}
	handlers := messageHandlers(pkgs)
	for _, p := range pkgs {
		nativeRegistrations(p, all, handlers)
	}
	for p, candidates := range perPackage {
		filtered := []candidate{}
		for _, c := range candidates {
			if handlers[c.Object] {
				delete(all, c.Object)
				report("go.message-handler-excluded", "info", "Native message handler or validator is not an automatic registration; explicit native registration remains available.", c.Definition.Source)
			} else {
				filtered = append(filtered, c)
			}
		}
		perPackage[p] = filtered
	}
	for _, p := range pkgs {
		cs := perPackage[p]
		if len(cs) == 0 {
			continue
		}
		for _, c := range cs {
			output.Analysis.Definitions = append(output.Analysis.Definitions, c.Definition)
		}
		generate(p, cs)
	}
	groups := map[string][]worker{}
	order := []string{}
	for _, w := range output.Analysis.Workers {
		directory := workerDirectory(byPath[w.Source.Path])
		if len(groups[directory]) == 0 {
			order = append(order, directory)
		}
		groups[directory] = append(groups[directory], w)
	}
	output.Analysis.Workers = []worker{}
	for _, directory := range order {
		candidates := groups[directory]
		plan := candidates[0]
		if len(candidates) > 1 {
			names := []string{}
			for _, candidate := range candidates {
				names = append(names, candidate.ID+" ("+candidate.Source.Path+")")
			}
			report("go.worker-entrypoint-ambiguous", "warning", "Several native main packages belong to this named Worker; supply an executable override. Candidates: "+strings.Join(names, ", "), plan.Source)
			plan.ID = plan.PackageID + ":worker:" + directory
			plan.Start = nil
			plan.Build = []command{{"go", []string{"build", "./..."}, pkgroot}}
		}
		output.Analysis.Workers = append(output.Analysis.Workers, plan)
	}
	reportedWorkers := map[string]bool{}
	for _, e := range entries {
		if e.Role != "worker" || e.WorkerName == "" {
			continue
		}
		directory := workerDirectory(e)
		if len(groups[directory]) == 0 && !reportedWorkers[directory] {
			report("go.worker-entrypoint-unresolved", "warning", "No selected main package with func main was found for this named Worker. Keep explicit native startup for nonstandard entrypoints.", location{Path: e.Path})
			output.Analysis.Workers = append(output.Analysis.Workers, worker{
				ID: e.PackageID + ":worker:" + directory, Name: e.WorkerName, Language: "go", PackageID: e.PackageID,
				Source:    location{Path: e.Path},
				Build:     []command{{"go", []string{"build", "./..."}, pkgroot}},
				Readiness: map[string]any{"state": "unavailable", "description": "Native executable override required; complete Worker coverage remains unknown."},
			})
			reportedWorkers[directory] = true
		}
	}
	generateAggregates(pkgs, perPackage, byPath)
	for _, e := range entries {
		if !seenEntries[e.Path] {
			report("go.source-not-selected", "info", "Native Go package rules did not select this source for the current GOOS, GOARCH, build tags, or module/workspace context.", location{Path: e.Path})
		}
	}
	sort.Slice(output.Analysis.Definitions, func(i, j int) bool { return output.Analysis.Definitions[i].ID < output.Analysis.Definitions[j].ID })
	detectCollisions()
	if err := json.NewEncoder(os.Stdout).Encode(output); err != nil {
		panic(err)
	}
}

// Resolve native handler references through declarations and assignments, without executing code.
func messageHandlers(pkgs []*packages.Package) map[types.Object]bool {
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
			report("go.message-handler-unresolved", "warning", "Native message handler or validator is not a unique static function. Resolved candidates are excluded from automatic registration; retain explicit native assembly.", loc(p.Fset, node.Pos()))
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
								report("go.message-options-unresolved", "warning", "Native Update options are dynamic; validator references require explicit native assembly.", loc(p.Fset, call.Args[3].Pos()))
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
	// Callable variable aliases must not reintroduce a resolved handler.
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
func callableVariables(p *packages.Package, file *ast.File, e entry) []candidate {
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
				if !ok || !callable(sig, e.Role == "workflow") {
					continue
				}
				if i >= len(v.Values) {
					report("go.callable-value-unresolved", "warning", "Callable variable requires explicit native assembly because its value is not statically known.", loc(p.Fset, n.Pos()))
					continue
				}
				target, ok := object(p.TypesInfo, v.Values[i]).(*types.Func)
				if !ok {
					report("go.callable-value-unresolved", "warning", "Closure or computed callable requires explicit native registration with a stable Name override.", loc(p.Fset, n.Pos()))
					continue
				}
				cs = append(cs, candidate{Object: obj, Expression: n.Name, Definition: definition{ID: e.Path + ":" + n.Name, Source: loc(p.Fset, n.Pos()), EntryID: e.ID, Language: "go", Kind: e.Role, Symbol: p.PkgPath + "." + n.Name, Identity: identity{Name: target.Name(), State: "resolved"}}})
			}
		}
	}
	return cs
}
func groupName(c candidate) string {
	name := "RegisterGenesys"
	if c.Service {
		return name + c.Object.Name()
	}
	if c.Receiver != nil {
		t := types.Unalias(c.Receiver)
		if ptr, ok := t.(*types.Pointer); ok {
			t = types.Unalias(ptr.Elem())
		}
		if n, ok := t.(*types.Named); ok {
			return name + n.Obj().Name()
		}
	}
	return name
}
func generatedCall(p *packages.Package, call *ast.CallExpr, sel *ast.SelectorExpr, all map[types.Object]candidate, handlers map[types.Object]bool) bool {
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
		d.Source = loc(p.Fset, call.Pos())
		d.ID += fmt.Sprintf(":generated:%s:%d", d.Source.Path, d.Source.Line)
		if scope := object(p.TypesInfo, call.Args[0]); scope != nil {
			position := loc(p.Fset, scope.Pos())
			d.RegistrationScope = fmt.Sprintf("go:%s:%s:%s:%d", p.PkgPath, scope.Name(), position.Path, position.Line)
		}
		output.Analysis.Definitions = append(output.Analysis.Definitions, d)
	}
	return true
}
func serviceVariables(p *packages.Package, file *ast.File, e entry) []candidate {
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
				cs = append(cs, candidate{Object: obj, Expression: n.Name, Definition: definition{ID: e.Path + ":" + n.Name, Source: loc(p.Fset, n.Pos()), EntryID: e.ID, Language: "go", Kind: "nexus", Symbol: p.PkgPath + "." + n.Name, Identity: id}})
			}
		}
	}
	return cs
}
func nativeRegistrations(p *packages.Package, all map[types.Object]candidate, handlers map[types.Object]bool) {
	for _, file := range p.Syntax {
		if strings.HasSuffix(loc(p.Fset, file.Pos()).Path, "zz_genesys_registration.go") || strings.HasSuffix(loc(p.Fset, file.Pos()).Path, "/gsysregistration/registration.go") {
			continue
		}
		ast.Inspect(file, func(node ast.Node) bool {
			call, ok := node.(*ast.CallExpr)
			if !ok || len(call.Args) == 0 {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if ok && generatedCall(p, call, sel, all, handlers) {
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
						recordRegistration(p, call, sel, name, item, true)
					}
					return true
				}
			}
			if !ok {
				report("go.explicit-registration-unresolved", "warning", "Native "+name+" uses a dynamic, grouped, or external value. Scope and names need explicit native assembly; no default is inferred.", loc(p.Fset, call.Pos()))
				return true
			}
			recordRegistration(p, call, sel, name, c, false)
			return true
		})
	}
}
func recordRegistration(p *packages.Package, call *ast.CallExpr, sel *ast.SelectorExpr, name string, c candidate, grouped bool) {
	d := c.Definition
	d.Source = loc(p.Fset, call.Pos())
	d.ID += fmt.Sprintf(":registration:%s:%d", d.Source.Path, d.Source.Line)
	if scope := object(p.TypesInfo, sel.X); scope != nil {
		d.RegistrationScope = fmt.Sprintf("go:%s:%s:%s:%d", p.PkgPath, scope.Name(), loc(p.Fset, scope.Pos()).Path, loc(p.Fset, scope.Pos()).Line)
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
	output.Analysis.Definitions = append(output.Analysis.Definitions, d)
}

func workerDirectory(e entry) string {
	if e.WorkerDirectory == "" {
		panic("missing native Worker directory for " + e.Path)
	}
	return e.WorkerDirectory
}

func addWorker(p *packages.Package, e entry, pkgroot string) {
	if e.WorkerName == "" {
		return
	}
	r := relative(pkgroot, filepath.Dir(filepath.Join(root, e.Path)))
	target := "./" + r
	if r == "." {
		target = "."
	}
	binary := filepath.Join(root, ".gsys", "native", "go", strings.ReplaceAll(e.PackageID, ":", "_"), e.WorkerName)
	goos := os.Getenv("GOOS")
	if goos == "" {
		goos = runtime.GOOS
	}
	if goos == "windows" {
		binary += ".exe"
	}
	output.Analysis.Workers = append(output.Analysis.Workers, worker{ID: e.PackageID + ":" + p.PkgPath, Name: e.WorkerName, Language: "go", PackageID: e.PackageID, Source: location{Path: e.Path}, Build: []command{{"go", []string{"build", "-o", binary, target}, pkgroot}}, Start: &command{binary, []string{}, pkgroot}, Readiness: map[string]any{"state": "unavailable", "description": "Attributed native Worker heartbeats and successful polling establish observed-instance readiness. Complete Worker coverage is unknown for arbitrary Go programs. Process creation and Start/Run return do not establish program readiness.", "evidence": []string{"native heartbeat host/PID/start time", "native successful task polling", "complete intended Worker coverage required"}}})
}
func generate(p *packages.Package, cs []candidate) {
	sort.Slice(cs, func(i, j int) bool { return cs[i].Definition.Symbol < cs[j].Definition.Symbol })
	imports := map[string]string{"go.temporal.io/sdk/worker": "gsysworker"}
	qualifier := func(pkg *types.Package) string {
		if pkg.Path() == p.PkgPath {
			return ""
		}
		if alias, ok := imports[pkg.Path()]; ok {
			return alias
		}
		alias := fmt.Sprintf("gsys%d", len(imports))
		imports[pkg.Path()] = alias
		return alias
	}
	groups := map[string][]candidate{}
	for _, c := range cs {
		group := "RegisterGenesys"
		if c.Service {
			group += c.Object.Name()
		} else if c.Receiver != nil {
			t := types.Unalias(c.Receiver)
			if ptr, ok := t.(*types.Pointer); ok {
				t = types.Unalias(ptr.Elem())
			}
			n, ok := t.(*types.Named)
			if !ok {
				report("go.receiver-unresolved", "warning", "Receiver type needs explicit native assembly.", c.Definition.Source)
				continue
			}
			group += n.Obj().Name()
		}
		groups[group] = append(groups[group], c)
	}
	groupNames := []string{}
	for name := range groups {
		groupNames = append(groupNames, name)
	}
	sort.Strings(groupNames)
	var functions strings.Builder
	for _, name := range groupNames {
		group := groups[name]
		params := []string{"registry gsysworker.Registry"}
		lines := []string{}
		names := map[string]location{}
		receiverAdded := false
		if existing := p.Types.Scope().Lookup(name); existing != nil && !strings.HasSuffix(loc(p.Fset, existing.Pos()).Path, "zz_genesys_registration.go") {
			output.Emission.Diagnostics = append(output.Emission.Diagnostics, diagnostic{"go.generated-symbol-collision", "error", "Authored symbol conflicts with generated " + name, loc(p.Fset, existing.Pos())})
		}
		for _, c := range group {
			expression := c.Expression
			if c.Service {
				imports["github.com/nexus-rpc/sdk-go/nexus"] = "gsysnexus"
				params = append(params, "service *gsysnexus.Service")
				expression = "service"
			} else if c.Receiver != nil {
				if !receiverAdded {
					t := c.Receiver
					if _, ok := types.Unalias(t).(*types.Pointer); !ok {
						t = types.NewPointer(t)
					}
					params = append(params, "instance "+types.TypeString(t, qualifier))
					receiverAdded = true
				}
				expression = "instance." + c.Expression
			}
			key := c.Definition.Kind + ":" + c.Definition.Identity.Name
			if c.Definition.Identity.State == "resolved" {
				if prev, ok := names[key]; ok {
					output.Emission.Diagnostics = append(output.Emission.Diagnostics, diagnostic{"go.generated-name-collision", "error", fmt.Sprintf("Duplicate native name %s in %s (also %s:%d). Use explicit native assembly for this scope.", key, name, prev.Path, prev.Line), c.Definition.Source})
				}
				names[key] = c.Definition.Source
			}
			method := map[string]string{"workflow": "RegisterWorkflow", "activity": "RegisterActivity", "nexus": "RegisterNexusService"}[c.Definition.Kind]
			lines = append(lines, "registry."+method+"("+expression+")")
		}
		functions.WriteString("// " + name + " registers native definitions using application-owned dependencies.\nfunc " + name + "(" + strings.Join(params, ", ") + ") {\n" + strings.Join(lines, "\n") + "\n}\n\n")
	}
	var b strings.Builder
	b.WriteString("// Code generated by Genesys. DO NOT EDIT.\npackage " + p.Name + "\n\nimport (\n")
	paths := []string{}
	for path := range imports {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		fmt.Fprintf(&b, "%s %q\n", imports[path], path)
	}
	b.WriteString(")\n\n" + functions.String())
	content, err := format.Source([]byte(b.String()))
	if err != nil {
		panic(err)
	}
	path := filepath.ToSlash(filepath.Join(filepath.Dir(cs[0].Definition.Source.Path), "zz_genesys_registration.go"))
	output.Emission.Artifacts = append(output.Emission.Artifacts, artifact{path, string(content), "registration"})
}

// Aggregate imports are derived from discovered packages, never an authored list.
func generateAggregates(pkgs []*packages.Package, candidates map[*packages.Package][]candidate, entries map[string]entry) {
	roots := map[string]map[*packages.Package][]candidate{}
	for _, p := range pkgs {
		for _, c := range candidates[p] {
			r := entries[c.Definition.EntryID].DiscoveryRoot
			if roots[r] == nil {
				roots[r] = map[*packages.Package][]candidate{}
			}
			roots[r][p] = append(roots[r][p], c)
		}
	}
	rootNames := []string{}
	for r := range roots {
		rootNames = append(rootNames, r)
	}
	sort.Strings(rootNames)
	for _, r := range rootNames {
		imports := map[string]string{"go.temporal.io/sdk/worker": "gsysworker"}
		params := []string{"registry gsysworker.Registry"}
		calls := []string{}
		comments := []string{}
		names := map[string]definition{}
		qualifier := func(pkg *types.Package) string {
			if alias, ok := imports[pkg.Path()]; ok {
				return alias
			}
			alias := fmt.Sprintf("gsys%d", len(imports))
			imports[pkg.Path()] = alias
			return alias
		}
		for _, p := range pkgs {
			cs := roots[r][p]
			if len(cs) == 0 {
				continue
			}
			if p.Name == "main" {
				report("go.aggregate-main-package", "warning", "Go main packages cannot be imported by aggregate registration. Use generated package-local helpers in explicit native assembly.", cs[0].Definition.Source)
				continue
			}
			// An aggregate cannot cross a nested Go internal package boundary.
			internalPrefix := ""
			if index := strings.LastIndex(p.PkgPath, "/internal/"); index >= 0 {
				internalPrefix = p.PkgPath[:index]
			}
			aggregateImport := ""
			if p.Module != nil {
				aggregateImport = p.Module.Path + "/" + relative(p.Module.Dir, filepath.Join(root, r, "gsysregistration"))
			}
			if internalPrefix != "" && !strings.HasPrefix(aggregateImport, internalPrefix+"/") {
				report("go.aggregate-internal-package", "warning", "Native internal-package visibility requires explicit package-local registration; aggregate import would be invalid.", cs[0].Definition.Source)
				continue
			}
			groups := map[string][]candidate{}
			for _, c := range cs {
				groups[groupName(c)] = append(groups[groupName(c)], c)
			}
			groupNames := []string{}
			for name := range groups {
				groupNames = append(groupNames, name)
			}
			sort.Strings(groupNames)
			for _, name := range groupNames {
				group := groups[name]
				first := group[0]
				arguments := []string{"registry"}
				parameter := ""
				if first.Service {
					imports["github.com/nexus-rpc/sdk-go/nexus"] = "gsysnexus"
					parameter = fmt.Sprintf("service%d", len(params))
					params = append(params, parameter+" *gsysnexus.Service")
					comments = append(comments, "// "+parameter+" is constructed by "+first.Definition.Symbol+".")
				} else if first.Receiver != nil {
					t := types.Unalias(first.Receiver)
					if ptr, ok := t.(*types.Pointer); ok {
						t = types.Unalias(ptr.Elem())
					}
					named, ok := t.(*types.Named)
					if !ok || !named.Obj().Exported() {
						report("go.aggregate-private-receiver", "warning", "This receiver type cannot be named outside its package. Use the package-local generated helper with its application-owned instance.", first.Definition.Source)
						continue
					}
					parameter = fmt.Sprintf("instance%d", len(params))
					params = append(params, parameter+" "+types.TypeString(types.NewPointer(t), qualifier))
					comments = append(comments, "// "+parameter+" supplies "+first.Definition.Construction.Symbol+".")
				}
				if parameter != "" {
					arguments = append(arguments, parameter)
				}
				alias := qualifier(p.Types)
				calls = append(calls, alias+"."+name+"("+strings.Join(arguments, ", ")+")")
				for _, c := range group {
					if c.Definition.Identity.State != "resolved" {
						continue
					}
					key := c.Definition.Kind + ":" + c.Definition.Identity.Name
					if prev, ok := names[key]; ok {
						report("go.aggregate-name-collision", "warning", fmt.Sprintf("Aggregate registration repeats %s from %s. Use package-local helpers on separate native registries or explicit scoped overrides.", key, prev.Symbol), c.Definition.Source)
					}
					names[key] = c.Definition
				}
			}
		}
		if len(calls) == 0 {
			continue
		}
		var b strings.Builder
		b.WriteString("// Code generated by Genesys. DO NOT EDIT.\npackage gsysregistration\n\nimport (\n")
		paths := []string{}
		for path := range imports {
			paths = append(paths, path)
		}
		sort.Strings(paths)
		for _, path := range paths {
			fmt.Fprintf(&b, "%s %q\n", imports[path], path)
		}
		b.WriteString(")\n\n// Register registers all discovered Go packages on this native registry.\n// Use package-local helpers when native registration scopes must differ.\n" + strings.Join(comments, "\n") + "\nfunc Register(" + strings.Join(params, ", ") + ") {\n" + strings.Join(calls, "\n") + "\n}\n")
		content, err := format.Source([]byte(b.String()))
		if err != nil {
			panic(err)
		}
		output.Emission.Artifacts = append(output.Emission.Artifacts, artifact{filepath.ToSlash(filepath.Join(r, "gsysregistration", "registration.go")), string(content), "registration"})
	}
}

func detectCollisions() {
	seen := map[string]definition{}
	for _, d := range output.Analysis.Definitions {
		if d.RegistrationScope == "" || d.Identity.State != "resolved" {
			continue
		}
		key := d.RegistrationScope + ":" + d.Kind + ":" + d.Identity.Name
		if previous, ok := seen[key]; ok {
			report("go.native-name-collision", "warning", fmt.Sprintf("Native registration repeats %s; first at %s:%d. Control flow and disable-check options remain native decisions.", d.Identity.Name, previous.Source.Path, previous.Source.Line), d.Source)
		}
		seen[key] = d
	}
}
