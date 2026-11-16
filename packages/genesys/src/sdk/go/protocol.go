package main

import (
	"go/types"
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
type nativeTarget struct {
	Platform     string `json:"platform"`
	Architecture string `json:"architecture"`
}
type nativeOutput struct {
	Paths               []string     `json:"paths"`
	Target              nativeTarget `json:"target"`
	RuntimeRequirements []string     `json:"runtimeRequirements"`
}
type worker struct {
	ID           string         `json:"id"`
	Name         string         `json:"name"`
	Language     string         `json:"language"`
	PackageID    string         `json:"packageId"`
	Source       location       `json:"source"`
	Build        []command      `json:"build"`
	Start        *command       `json:"start,omitempty"`
	Readiness    map[string]any `json:"readiness"`
	NativeOutput *nativeOutput  `json:"nativeOutput,omitempty"`
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
