package main

import (
	"go/ast"
	"go/constant"
	"go/token"
	"go/types"
	"path/filepath"
	"strings"
)

func relative(base, path string) string {
	r, err := filepath.Rel(base, path)
	if err != nil {
		panic(err)
	}
	return filepath.ToSlash(r)
}

func (a *analyzer) loc(fset *token.FileSet, pos token.Pos) location {
	p := fset.Position(pos)
	return location{relative(a.root, p.Filename), p.Line, p.Column}
}

func (a *analyzer) report(code, severity, message string, source location) {
	a.output.Analysis.Diagnostics = append(a.output.Analysis.Diagnostics, diagnostic{code, severity, message, source})
}

func qualified(t types.Type, pkg, name string) bool {
	t = types.Unalias(t)
	if p, ok := t.(*types.Pointer); ok {
		t = types.Unalias(p.Elem())
	}
	n, ok := t.(*types.Named)
	return ok && n.Obj().Pkg() != nil && n.Obj().Pkg().Path() == pkg && n.Obj().Name() == name
}

func (a *analyzer) workflowContext(t types.Type) bool {
	return a.workflowContextType != nil && types.Identical(t, a.workflowContextType)
}

func service(t types.Type) bool {
	_, pointer := types.Unalias(t).(*types.Pointer)
	return pointer && qualified(t, "github.com/nexus-rpc/sdk-go/nexus", "Service")
}

func (a *analyzer) callable(sig *types.Signature, workflow bool) bool {
	if (sig.TypeParams() != nil && sig.TypeParams().Len() > 0) || (sig.RecvTypeParams() != nil && sig.RecvTypeParams().Len() > 0) {
		return false
	}
	if workflow && (sig.Params().Len() == 0 || !a.workflowContext(sig.Params().At(0).Type())) {
		return false
	}
	if !workflow {
		for i := 0; i < sig.Params().Len() && i < 2; i++ {
			if a.workflowContext(sig.Params().At(i).Type()) {
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
