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
	if len(os.Args) != 3 {
		panic("expected project root and package root; entries on stdin")
	}
	var entries []entry
	if err := json.NewDecoder(os.Stdin).Decode(&entries); err != nil {
		panic(err)
	}
	result := analyze(os.Args[1], os.Args[2], entries)
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		panic(err)
	}
}
