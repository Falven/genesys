package main

import (
	"encoding/json"
	"os"
)

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--coverage" {
		coverageMain()
		return
	}
	production := len(os.Args) == 4 && os.Args[3] == "--production"
	if len(os.Args) != 3 && !production {
		panic("expected project root and package root, optionally --production; entries on stdin")
	}
	if production {
		for _, name := range []string{"GOOS", "GOARCH", "CGO_ENABLED"} {
			if err := os.Setenv(name, os.Getenv("GSYS_ANALYSIS_"+name)); err != nil {
				panic(err)
			}
		}
	}
	var entries []entry
	if err := json.NewDecoder(os.Stdin).Decode(&entries); err != nil {
		panic(err)
	}
	result := analyze(os.Args[1], os.Args[2], entries, production)
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		panic(err)
	}
}
