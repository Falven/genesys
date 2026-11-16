package main

import (
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"golang.org/x/tools/go/packages"
)

func workerDirectory(e entry) string {
	if e.WorkerDirectory == "" {
		panic("missing native Worker directory for " + e.Path)
	}
	return e.WorkerDirectory
}

func (a *analyzer) addWorker(p *packages.Package, e entry, pkgroot string) {
	if e.WorkerName == "" {
		return
	}
	programDirectory := filepath.Dir(filepath.Join(a.root, e.Path))
	r := relative(pkgroot, programDirectory)
	target := "./" + r
	if r == "." {
		target = "."
	}
	name := e.WorkerName
	binaryName := name
	outputDirectory := strings.ReplaceAll(e.PackageID, ":", "_")
	if a.production {
		if nested := relative(filepath.Join(a.root, workerDirectory(e)), programDirectory); nested != "." {
			name += "/" + nested
		}
		binaryName = url.PathEscape(name)
	}
	if a.production || runtime.GOOS == "windows" {
		// Windows trims the trailing dot in the root module's package ID.
		outputDirectory += "_pkg"
	}
	binary := filepath.Join(a.root, ".gsys", "native", "go", outputDirectory, binaryName)
	goos := os.Getenv("GOOS")
	if goos == "" {
		goos = runtime.GOOS
	}
	if goos == "windows" {
		binary += ".exe"
	}
	plan := worker{ID: e.PackageID + ":" + p.PkgPath, Name: name, Language: "go", PackageID: e.PackageID, Source: location{Path: e.Path}, Build: []command{{"go", []string{"build", "-o", binary, target}, pkgroot}}, Start: &command{binary, []string{}, pkgroot}, Readiness: map[string]any{"state": "unavailable", "description": "Attributed native Worker heartbeats and successful polling establish observed-instance readiness. Complete Worker coverage is unknown for arbitrary Go programs. Process creation and Start/Run return do not establish program readiness.", "evidence": []string{"native heartbeat host/PID/start time", "native successful task polling", "complete intended Worker coverage required"}}}
	if a.production {
		requirements := []string{"Compatible target OS and CPU, plus application runtime files and settings."}
		if os.Getenv("CGO_ENABLED") == "1" {
			requirements = append(requirements, "Supply any dynamic libraries required by cgo or native linker settings.")
		}
		plan.NativeOutput = &nativeOutput{
			Paths:               []string{relative(a.root, binary)},
			Target:              nativeTarget{Platform: goos, Architecture: os.Getenv("GOARCH")},
			RuntimeRequirements: requirements,
		}
	}
	a.output.Analysis.Workers = append(a.output.Analysis.Workers, plan)
}

func (a *analyzer) reportProductionEntrypoints(entries []entry, byPath map[string]entry, selectedPaths map[string]bool) {
	hasEntrypoint := map[string]bool{}
	for _, w := range a.output.Analysis.Workers {
		hasEntrypoint[workerDirectory(byPath[w.Source.Path])] = true
	}
	for _, e := range entries {
		if e.Role != "worker" || e.WorkerName == "" || !selectedPaths[e.Path] {
			continue
		}
		directory := workerDirectory(e)
		if !hasEntrypoint[directory] {
			a.report("go.worker-entrypoint-unresolved", "error", "No selected main package with func main was found for this named Worker. Provide a native Go entrypoint to produce an executable.", location{Path: e.Path})
			hasEntrypoint[directory] = true
		}
	}
}

func (a *analyzer) resolveWorkers(entries []entry, byPath map[string]entry, pkgroot string) {
	groups := map[string][]worker{}
	order := []string{}
	for _, w := range a.output.Analysis.Workers {
		directory := workerDirectory(byPath[w.Source.Path])
		if len(groups[directory]) == 0 {
			order = append(order, directory)
		}
		groups[directory] = append(groups[directory], w)
	}
	a.output.Analysis.Workers = []worker{}
	for _, directory := range order {
		candidates := groups[directory]
		plan := candidates[0]
		if len(candidates) > 1 {
			names := []string{}
			for _, candidate := range candidates {
				names = append(names, candidate.ID+" ("+candidate.Source.Path+")")
			}
			a.report("go.worker-entrypoint-ambiguous", "warning", "Several native main packages belong to this named Worker; supply an executable override. Candidates: "+strings.Join(names, ", "), plan.Source)
			plan.ID = plan.PackageID + ":worker:" + directory
			plan.Start = nil
			plan.Build = []command{{"go", []string{"build", "./..."}, pkgroot}}
		}
		a.output.Analysis.Workers = append(a.output.Analysis.Workers, plan)
	}
	reportedWorkers := map[string]bool{}
	for _, e := range entries {
		if e.Role != "worker" || e.WorkerName == "" {
			continue
		}
		directory := workerDirectory(e)
		if len(groups[directory]) == 0 && !reportedWorkers[directory] {
			a.report("go.worker-entrypoint-unresolved", "warning", "No selected main package with func main was found for this named Worker. Keep explicit native startup for nonstandard entrypoints.", location{Path: e.Path})
			a.output.Analysis.Workers = append(a.output.Analysis.Workers, worker{
				ID: e.PackageID + ":worker:" + directory, Name: e.WorkerName, Language: "go", PackageID: e.PackageID,
				Source:    location{Path: e.Path},
				Build:     []command{{"go", []string{"build", "./..."}, pkgroot}},
				Readiness: map[string]any{"state": "unavailable", "description": "Native executable override required; complete Worker coverage remains unknown."},
			})
			reportedWorkers[directory] = true
		}
	}
}
