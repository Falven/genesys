package main

import (
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
	r := relative(pkgroot, filepath.Dir(filepath.Join(a.root, e.Path)))
	target := "./" + r
	if r == "." {
		target = "."
	}
	binary := filepath.Join(a.root, ".gsys", "native", "go", strings.ReplaceAll(e.PackageID, ":", "_"), e.WorkerName)
	goos := os.Getenv("GOOS")
	if goos == "" {
		goos = runtime.GOOS
	}
	if goos == "windows" {
		binary += ".exe"
	}
	a.output.Analysis.Workers = append(a.output.Analysis.Workers, worker{ID: e.PackageID + ":" + p.PkgPath, Name: e.WorkerName, Language: "go", PackageID: e.PackageID, Source: location{Path: e.Path}, Build: []command{{"go", []string{"build", "-o", binary, target}, pkgroot}}, Start: &command{binary, []string{}, pkgroot}, Readiness: map[string]any{"state": "unavailable", "description": "Attributed native Worker heartbeats and successful polling establish observed-instance readiness. Complete Worker coverage is unknown for arbitrary Go programs. Process creation and Start/Run return do not establish program readiness.", "evidence": []string{"native heartbeat host/PID/start time", "native successful task polling", "complete intended Worker coverage required"}}})
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
