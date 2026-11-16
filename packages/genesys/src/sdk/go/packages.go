package main

import (
	"os"
	"sort"
	"strings"

	"golang.org/x/tools/go/packages"
)

func (a *analyzer) loadPackages(pkgroot string) []*packages.Package {
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
	config := &packages.Config{
		Dir: pkgroot,
		Mode: packages.NeedName | packages.NeedFiles | packages.NeedCompiledGoFiles |
			packages.NeedImports | packages.NeedDeps | packages.NeedTypes |
			packages.NeedSyntax | packages.NeedTypesInfo | packages.NeedModule,
		Tests:      false,
		BuildFlags: []string{"-mod=readonly"},
	}
	pkgs, err := packages.Load(config, "./...")
	if err != nil {
		panic(err)
	}
	sort.Slice(pkgs, func(i, j int) bool { return pkgs[i].PkgPath < pkgs[j].PkgPath })
	sdkVersions := map[string]bool{}
	packages.Visit(pkgs, nil, func(p *packages.Package) {
		if p.PkgPath == "go.temporal.io/sdk/workflow" && p.Types != nil {
			if context := p.Types.Scope().Lookup("Context"); context != nil {
				a.workflowContextType = context.Type()
			}
		}
		if p.Module != nil && p.Module.Path == "go.temporal.io/sdk" {
			sdkVersions[p.Module.Version] = true
		}
	})
	for version := range sdkVersions {
		a.report("go.sdk-version", "info", "Resolved go.temporal.io/sdk "+version+"; registration APIs reviewed against released v1.51.0. Other versions are not compatibility-verified.", location{Path: relative(a.root, pkgroot)})
	}
	if len(sdkVersions) == 0 {
		a.report("go.sdk-unresolved", "error", "Go package loading did not resolve go.temporal.io/sdk. Install native module dependencies before analysis.", location{Path: relative(a.root, pkgroot)})
	}
	return pkgs
}
