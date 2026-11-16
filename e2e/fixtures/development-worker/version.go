package version

import (
	_ "embed"
	"strings"
)

const sourceVersion = "v1"

//go:embed go.mod
var module string

func BuildID() string {
	_, suffix, _ := strings.Cut(module, "\n// lifecycle-build-suffix: ")
	return sourceVersion + strings.TrimSpace(suffix)
}
