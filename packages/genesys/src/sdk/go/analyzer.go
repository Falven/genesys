package main

import (
	"go/types"
	"sort"
)

type analyzer struct {
	root                string
	production          bool
	workflowContextType types.Type
	output              result
}

func analyze(projectRoot, pkgroot string, entries []entry, production bool) result {
	a := analyzer{
		root:       projectRoot,
		production: production,
		output: result{
			Analysis: analysis{
				Definitions: []definition{},
				Diagnostics: []diagnostic{},
				Workers:     []worker{},
			},
			Emission: emission{Artifacts: []artifact{}, Diagnostics: []diagnostic{}},
		},
	}
	byPath := map[string]entry{}
	for _, e := range entries {
		byPath[e.Path] = e
	}
	pkgs := a.loadPackages(pkgroot)
	index := a.collectDefinitions(pkgs, pkgroot, byPath)
	handlers := a.messageHandlers(pkgs)
	for _, p := range pkgs {
		a.nativeRegistrations(p, index.byObject, handlers)
	}
	for p, candidates := range index.byPackage {
		filtered := []candidate{}
		for _, c := range candidates {
			if handlers[c.Object] {
				delete(index.byObject, c.Object)
				a.report("go.message-handler-excluded", "info", "Native message handler or validator is not an automatic registration; explicit native registration remains available.", c.Definition.Source)
			} else {
				filtered = append(filtered, c)
			}
		}
		index.byPackage[p] = filtered
	}
	for _, p := range pkgs {
		cs := index.byPackage[p]
		if len(cs) == 0 {
			continue
		}
		for _, c := range cs {
			a.output.Analysis.Definitions = append(a.output.Analysis.Definitions, c.Definition)
		}
		a.generate(p, cs)
	}
	if a.production {
		a.reportProductionEntrypoints(entries, byPath, index.selectedPaths)
	} else {
		a.resolveWorkers(entries, byPath, pkgroot)
	}
	a.generateAggregates(pkgs, index.byPackage, byPath)
	for _, e := range entries {
		if !index.selectedPaths[e.Path] {
			a.report("go.source-not-selected", "info", "Native Go package rules did not select this source for the current GOOS, GOARCH, build tags, or module/workspace context.", location{Path: e.Path})
		}
	}
	sort.Slice(a.output.Analysis.Definitions, func(i, j int) bool { return a.output.Analysis.Definitions[i].ID < a.output.Analysis.Definitions[j].ID })
	a.detectCollisions()
	return a.output
}
