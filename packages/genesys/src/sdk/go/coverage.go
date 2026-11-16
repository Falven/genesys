package main

import (
	"crypto/sha256"
	"debug/buildinfo"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/constant"
	"go/token"
	"go/types"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"golang.org/x/mod/modfile"
	"golang.org/x/tools/go/packages"
)

type coverageInput struct {
	BeforeBuild  bool              `json:"beforeBuild"`
	SourceSHA256 string            `json:"sourceSha256"`
	PackageRoot  string            `json:"packageRoot"`
	Target       string            `json:"target"`
	Executable   string            `json:"executable"`
	Environment  map[string]string `json:"environment"`
}
type coverageProof struct {
	SourceSHA256 string   `json:"sourceSha256"`
	Kind         string   `json:"kind"`
	Executable   string   `json:"executable"`
	Cwd          string   `json:"cwd"`
	SHA256       string   `json:"sha256"`
	TaskQueue    string   `json:"taskQueue"`
	TaskTypes    []string `json:"taskTypes"`
	SDKVersion   string   `json:"sdkVersion"`
	Platform     string   `json:"platform"`
	Architecture string   `json:"architecture"`
}

func coverageMain() {
	var input coverageInput
	if err := json.NewDecoder(os.Stdin).Decode(&input); err != nil {
		panic(err)
	}
	proof, err := proveCoverage(input)
	result := map[string]any{}
	if proof != nil && input.BeforeBuild {
		result["sourceSha256"] = proof.SourceSHA256
	} else {
		result["proof"] = proof
	}
	if err != nil {
		result["reason"] = err.Error()
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		panic(err)
	}
}
func proveCoverage(input coverageInput) (*coverageProof, error) {
	fail := func(reason string) (*coverageProof, error) { return nil, fmt.Errorf("%s", reason) }
	env := input.Environment
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		return fail("Coverage requires POSIX native direct launch.")
	}
	if env["GOOS"] != runtime.GOOS || env["GOARCH"] != runtime.GOARCH || env["CGO_ENABLED"] != "0" || env["GOFLAGS"] != "" || env["GOEXPERIMENT"] != "" || (env["GOWORK"] != "" && env["GOWORK"] != "off") {
		return fail("Coverage requires the host target, CGO_ENABLED=0, and no custom GOFLAGS, GOEXPERIMENT or Go workspace.")
	}
	if _, err := os.Stat(filepath.Join(input.PackageRoot, "vendor")); err == nil || !os.IsNotExist(err) {
		return fail("Vendor source is outside the reviewed module closure.")
	}
	verify := exec.Command("go", "mod", "verify")
	verify.Dir = input.PackageRoot
	if output, err := verify.CombinedOutput(); err != nil {
		return fail("Native dependency source verification failed: " + string(output))
	}
	os.Setenv("GOPACKAGESDRIVER", "off")
	config := &packages.Config{Dir: input.PackageRoot, Env: os.Environ(), Mode: packages.NeedName | packages.NeedFiles | packages.NeedCompiledGoFiles | packages.NeedImports | packages.NeedDeps | packages.NeedTypes | packages.NeedSyntax | packages.NeedTypesInfo | packages.NeedModule, Tests: false, BuildFlags: []string{"-mod=readonly"}}
	selected, err := packages.Load(config, input.Target)
	if err != nil || len(selected) != 1 {
		return fail("Cannot resolve exactly one compiled native main target.")
	}
	mainPackage := selected[0]
	if mainPackage.Name != "main" || mainPackage.Module == nil || mainPackage.Module.Replace != nil {
		return fail("Compiled native main/module identity does not match analysis.")
	}
	modSource, err := os.ReadFile(mainPackage.Module.GoMod)
	if err != nil {
		return fail(err.Error())
	}
	module, err := modfile.Parse(mainPackage.Module.GoMod, modSource, nil)
	if err != nil || len(module.Replace) > 0 {
		return fail("Module replacements are outside the reviewed build context.")
	}
	local := map[string]*packages.Package{}
	sdk := false
	var problem string
	packages.Visit(selected, nil, func(p *packages.Package) {
		if len(p.Errors) > 0 && problem == "" {
			problem = p.Errors[0].Error()
		}
		if p.Module != nil && p.Module.Replace != nil {
			problem = "Replaced module in compiled import closure."
		}
		if p.PkgPath == "go.temporal.io/sdk/worker" {
			sdk = p.Module != nil && p.Module.Version == "v1.51.0"
		}
		if p.Module != nil && p.Module.Path == mainPackage.Module.Path {
			local[p.PkgPath] = p
		}
	})
	if problem != "" {
		return fail(problem)
	}
	if !sdk {
		return fail("Coverage is restricted to released go.temporal.io/sdk v1.51.0.")
	}
	functions := map[types.Object]*ast.FuncDecl{}
	registries := map[types.Object]types.Object{}
	var mainFunction *ast.FuncDecl
	for _, p := range local {
		if len(p.OtherFiles) > 0 || len(p.EmbedFiles) > 0 {
			return fail("Native/embedded source is outside the checked Go subset.")
		}
		for path := range p.Imports {
			if local[path] != nil {
				continue
			}
			switch path {
			case "context", "time", "log", "os", "go.temporal.io/sdk/client", "go.temporal.io/sdk/worker", "go.temporal.io/sdk/workflow":
			default:
				return fail("Unreviewed application import: " + path)
			}
		}
		for _, file := range p.Syntax {
			for _, group := range file.Comments {
				for _, comment := range group.List {
					if strings.Contains(comment.Text, "go:") || strings.Contains(comment.Text, "#cgo") {
						return fail("Compiler/native directives require opaque coverage.")
					}
				}
			}
			for _, decl := range file.Decls {
				if group, ok := decl.(*ast.GenDecl); ok && group.Tok == token.VAR {
					return fail("Package-level mutable variables require opaque coverage.")
				}
				fn, ok := decl.(*ast.FuncDecl)
				if !ok {
					continue
				}
				obj := p.TypesInfo.Defs[fn.Name]
				if fn.Name.Name == "init" || fn.Body == nil || fn.Recv != nil || (fn.Type.TypeParams != nil && len(fn.Type.TypeParams.List) > 0) {
					return fail("Initializers, methods, generics or bodyless functions require opaque coverage.")
				}
				functions[obj] = fn
				if p == mainPackage && fn.Name.Name == "main" {
					mainFunction = fn
				}
				sig, ok := obj.Type().(*types.Signature)
				if ok && sig.Params().Len() == 1 && sig.Results().Len() == 0 && qualified(sig.Params().At(0).Type(), "go.temporal.io/sdk/worker", "Registry") {
					registries[obj] = sig.Params().At(0)
					for _, statement := range fn.Body.List {
						if _, ok := statement.(*ast.ExprStmt); !ok {
							return fail("Registry helpers must contain only direct registration calls.")
						}
					}
				}
			}
		}
	}
	if mainFunction == nil {
		return fail("Native main function is unavailable.")
	}
	mainObject := mainPackage.TypesInfo.Defs[mainFunction.Name]
	var clientObject, workerObject types.Object
	var newCall, dialCall *ast.CallExpr
	for _, statement := range mainFunction.Body.List {
		assignment, ok := statement.(*ast.AssignStmt)
		if !ok || assignment.Tok != token.DEFINE || len(assignment.Rhs) != 1 {
			continue
		}
		call, ok := assignment.Rhs[0].(*ast.CallExpr)
		if !ok {
			continue
		}
		obj := object(mainPackage.TypesInfo, call.Fun)
		if obj == nil || obj.Pkg() == nil {
			continue
		}
		if obj.Pkg().Path() == "go.temporal.io/sdk/client" && obj.Name() == "Dial" && len(assignment.Lhs) == 2 {
			clientObject = object(mainPackage.TypesInfo, assignment.Lhs[0])
			dialCall = call
		}
		if obj.Pkg().Path() == "go.temporal.io/sdk/worker" && obj.Name() == "New" && len(assignment.Lhs) == 1 {
			workerObject = object(mainPackage.TypesInfo, assignment.Lhs[0])
			newCall = call
		}
	}
	if clientObject == nil || workerObject == nil || dialCall == nil || newCall == nil || len(newCall.Args) != 3 || object(mainPackage.TypesInfo, newCall.Args[0]) != clientObject || len(dialCall.Args) != 1 {
		return fail("Main must directly construct one native client and one Worker in local variables.")
	}
	queue, ok := stringValue(mainPackage.TypesInfo, newCall.Args[1])
	if !ok || queue == "" {
		return fail("Worker Task Queue must be a native compile-time string.")
	}
	options, ok := newCall.Args[2].(*ast.CompositeLit)
	if !ok {
		return fail("Worker options must be a checked native literal.")
	}
	localActivityOnly := false
	for _, element := range options.Elts {
		field, ok := element.(*ast.KeyValueExpr)
		if !ok {
			return fail("Worker options require keyed native fields.")
		}
		key, ok := field.Key.(*ast.Ident)
		if !ok {
			return fail("Unknown Worker option.")
		}
		value := mainPackage.TypesInfo.Types[field.Value].Value
		if value == nil {
			return fail("Worker options must have compile-time values.")
		}
		switch key.Name {
		case "WorkerStopTimeout":
			if value.Kind() != constant.Int {
				return fail("WorkerStopTimeout must be a constant duration.")
			}
		case "LocalActivityWorkerOnly":
			if value.Kind() != constant.Bool {
				return fail("LocalActivityWorkerOnly must be constant.")
			}
			localActivityOnly = constant.BoolVal(value)
		default:
			return fail("Worker option is outside the unversioned subset: " + key.Name)
		}
	}
	clientOptions, ok := dialCall.Args[0].(*ast.CompositeLit)
	if !ok {
		return fail("Client options must be a native literal without custom construction.")
	}
	for _, element := range clientOptions.Elts {
		field, ok := element.(*ast.KeyValueExpr)
		if !ok {
			return fail("Client options require keyed native fields.")
		}
		key, ok := field.Key.(*ast.Ident)
		if !ok || (key.Name != "HostPort" && key.Name != "Namespace") {
			return fail("Client extensions/options require opaque coverage.")
		}
		if _, constant := stringValue(mainPackage.TypesInfo, field.Value); constant {
			continue
		}
		call, ok := field.Value.(*ast.CallExpr)
		if !ok || len(call.Args) != 1 {
			return fail("Client location must be literal or os.Getenv.")
		}
		obj := object(mainPackage.TypesInfo, call.Fun)
		if obj == nil || obj.Pkg() == nil || obj.Pkg().Path() != "os" || obj.Name() != "Getenv" {
			return fail("Client location expression is outside the checked subset.")
		}
		if _, ok := stringValue(mainPackage.TypesInfo, call.Args[0]); !ok {
			return fail("Client environment key must be constant.")
		}
	}
	allowedUses := map[ast.Node]bool{newCall.Args[0]: true}
	newReferences, dialReferences, runCalls := 0, 0, 0
	workflows, activities := false, false
	for _, p := range local {
		for _, file := range p.Syntax {
			for _, decl := range file.Decls {
				fn, ok := decl.(*ast.FuncDecl)
				if !ok {
					continue
				}
				function := p.TypesInfo.Defs[fn.Name]
				registry := registries[function]
				ast.Inspect(fn.Body, func(node ast.Node) bool {
					if problem != "" {
						return false
					}
					reject := func(reason string) bool {
						problem = fmt.Sprintf("%s: %s", p.Fset.Position(node.Pos()), reason)
						return false
					}
					switch n := node.(type) {
					case *ast.GoStmt, *ast.FuncLit:
						return reject("Goroutines and function literals require opaque coverage.")
					case *ast.ForStmt, *ast.RangeStmt, *ast.BranchStmt:
						if fn == mainFunction {
							return reject("Main must be non-reentrant and contain no loops or jumps.")
						}
					case *ast.Ident:
						if obj := p.TypesInfo.Uses[n]; obj != nil {
							if obj == mainObject {
								return reject("Native main cannot be referenced or called.")
							}
							if obj.Pkg() != nil && obj.Pkg().Path() == "go.temporal.io/sdk/worker" && obj.Name() == "New" {
								newReferences++
							}
							if obj.Pkg() != nil && obj.Pkg().Path() == "go.temporal.io/sdk/client" && obj.Name() == "Dial" {
								dialReferences++
							}
						}
					case *ast.AssignStmt:
						for _, left := range n.Lhs {
							id, ok := left.(*ast.Ident)
							if !ok {
								return reject("Indirect mutation requires opaque coverage.")
							}
							if variable, ok := p.TypesInfo.ObjectOf(id).(*types.Var); ok && variable.Parent() == p.Types.Scope() {
								return reject("Global mutation requires opaque coverage.")
							}
						}
					case *ast.CallExpr:
						called, ok := object(p.TypesInfo, n.Fun).(*types.Func)
						if !ok {
							return reject("Dynamic calls, conversions and builtins are outside the checked subset.")
						}
						if called == mainObject {
							return reject("Main cannot be called.")
						}
						if functions[called] != nil {
							if registries[called] != nil {
								if len(n.Args) != 1 {
									return reject("Registry helpers require the existing registry.")
								}
								actual := object(p.TypesInfo, n.Args[0])
								if actual != registry && !(fn == mainFunction && actual == workerObject) {
									return reject("Worker escaped its direct registry path.")
								}
								allowedUses[n.Args[0]] = true
							}
							return true
						}
						if called.Pkg() == nil {
							return reject("Unresolved native call.")
						}
						path, name := called.Pkg().Path(), called.Name()
						switch {
						case path == "go.temporal.io/sdk/client" && name == "Dial":
							if n != dialCall {
								return reject("Client construction must occur only in main.")
							}
						case path == "go.temporal.io/sdk/worker" && name == "New":
							if n != newCall {
								return reject("Worker construction must occur only once in main.")
							}
						case path == "go.temporal.io/sdk/worker" && name == "InterruptCh":
							if fn != mainFunction {
								return reject("Native interrupt channel must be owned by main.")
							}
						case path == "go.temporal.io/sdk/worker" && name == "Run":
							sel, ok := n.Fun.(*ast.SelectorExpr)
							if !ok || fn != mainFunction || object(p.TypesInfo, sel.X) != workerObject || len(n.Args) != 1 {
								return reject("Run must use the main Worker and native interrupt channel.")
							}
							interrupt, ok := n.Args[0].(*ast.CallExpr)
							if !ok {
								return reject("Run requires worker.InterruptCh().")
							}
							target := object(p.TypesInfo, interrupt.Fun)
							if target == nil || target.Pkg() == nil || target.Pkg().Path() != "go.temporal.io/sdk/worker" || target.Name() != "InterruptCh" {
								return reject("Run requires worker.InterruptCh().")
							}
							runCalls++
							allowedUses[sel.X] = true
						case path == "go.temporal.io/sdk/worker" && (name == "RegisterWorkflow" || name == "RegisterActivity"):
							sel, ok := n.Fun.(*ast.SelectorExpr)
							if !ok || registry == nil || object(p.TypesInfo, sel.X) != registry || len(n.Args) != 1 {
								return reject("Registration must use a plain native registry helper.")
							}
							target := object(p.TypesInfo, n.Args[0])
							if functions[target] == nil || registries[target] != nil || target == mainObject {
								return reject("Registration must reference a checked native application function.")
							}
							allowedUses[sel.X] = true
							if name == "RegisterWorkflow" {
								workflows = true
							} else {
								activities = true
							}
						case path == "go.temporal.io/sdk/client" && name == "Close":
							sel, ok := n.Fun.(*ast.SelectorExpr)
							if !ok || fn != mainFunction || object(p.TypesInfo, sel.X) != clientObject {
								return reject("Client must remain in main's native lifetime.")
							}
							allowedUses[sel.X] = true
						case path == "go.temporal.io/sdk/workflow" && (name == "WithActivityOptions" || name == "ExecuteActivity"):
							if fn == mainFunction || registry != nil {
								return reject("Workflow calls must remain in checked callbacks.")
							}
							if name == "ExecuteActivity" && (len(n.Args) < 2 || functions[object(p.TypesInfo, n.Args[1])] == nil) {
								return reject("ExecuteActivity must reference a checked application function.")
							}
						case path == "go.temporal.io/sdk/internal" && name == "Get":
							sel, ok := n.Fun.(*ast.SelectorExpr)
							if !ok || !qualified(p.TypesInfo.TypeOf(sel.X), "go.temporal.io/sdk/internal", "Future") {
								return reject("Only native Workflow Future.Get is supported.")
							}
						case path == "os" && (name == "Getenv" || name == "Exit"), path == "log" && (name == "Fatal" || name == "Print"):
							if fn != mainFunction {
								return reject("Process environment/logging calls must stay in main.")
							}
						default:
							return reject("Call is outside the checked native subset: " + path + "." + name)
						}
					}
					return true
				})
				if problem != "" {
					return fail(problem)
				}
				ast.Inspect(fn.Body, func(node ast.Node) bool {
					id, ok := node.(*ast.Ident)
					if !ok {
						return true
					}
					obj := p.TypesInfo.Uses[id]
					if obj != nil && (obj == clientObject || obj == workerObject || obj == registry) && !allowedUses[id] {
						problem = "Native client/Worker/registry reference escapes or is reassigned."
						return false
					}
					return true
				})
				if problem != "" {
					return fail(problem)
				}
			}
		}
	}
	if newReferences != 1 || dialReferences != 1 || runCalls != 1 || !workflows || (!activities && !localActivityOnly) {
		return fail("Checked closure does not establish exactly one native construction/run and expected registrations.")
	}
	files := []string{mainPackage.Module.GoMod, filepath.Join(filepath.Dir(mainPackage.Module.GoMod), "go.sum")}
	for _, p := range local {
		files = append(files, p.CompiledGoFiles...)
	}
	sort.Strings(files)
	sourceDigest := sha256.New()
	for _, path := range files {
		content, err := os.ReadFile(path)
		if err != nil {
			return fail("Native source binding unavailable: " + err.Error())
		}
		fmt.Fprintf(sourceDigest, "%d:%s:%d:", len(path), path, len(content))
		sourceDigest.Write(content)
	}
	context := map[string]string{}
	for _, key := range []string{"GOOS", "GOARCH", "CGO_ENABLED", "GOFLAGS", "GOEXPERIMENT", "GOWORK", "GOVERSION", "GO111MODULE", "GOAMD64", "GOARM64", "GOARM", "GO386", "GOMIPS", "GOMIPS64", "GOPPC64", "GOWASM", "GOFIPS140", "GOROOT", "GOTOOLCHAIN", "GOENV"} {
		context[key] = env[key]
	}
	encoded, err := json.Marshal(context)
	if err != nil {
		return fail(err.Error())
	}
	sourceDigest.Write(encoded)
	sourceSHA256 := hex.EncodeToString(sourceDigest.Sum(nil))
	if input.BeforeBuild {
		return &coverageProof{SourceSHA256: sourceSHA256}, nil
	}
	if input.SourceSHA256 == "" || sourceSHA256 != input.SourceSHA256 {
		return fail("Native source/module/build context changed across compilation; coverage is unknown.")
	}
	info, err := buildinfo.ReadFile(input.Executable)
	if err != nil {
		return fail("Native executable build information is unavailable: " + err.Error())
	}
	if info.GoVersion != runtime.Version() || env["GOVERSION"] != info.GoVersion {
		return fail("Native compiler and coverage analyzer toolchain versions differ.")
	}
	for _, module := range info.Deps {
		if module.Replace != nil {
			return fail("Replaced native modules invalidate coverage.")
		}
	}
	settings := map[string]string{}
	for _, setting := range info.Settings {
		settings[setting.Key] = setting.Value
	}
	for _, key := range []string{"GOOS", "GOARCH", "CGO_ENABLED"} {
		if settings[key] != env[key] {
			return fail("Compiled binary does not match effective native " + key + ".")
		}
	}
	for _, key := range []string{"-ldflags", "-gcflags", "-asmflags", "-tags", "GOEXPERIMENT"} {
		if settings[key] != "" {
			return fail("Custom native build setting " + key + " invalidates coverage.")
		}
	}
	if settings["-buildmode"] != "exe" || settings["-compiler"] != "gc" {
		return fail("Coverage requires the normal native Go executable build.")
	}
	if mainPackage.PkgPath != info.Path || mainPackage.Module.Path != info.Main.Path {
		return fail("Compiled main/module identity differs from the checked source.")
	}
	sdkBinary := false
	for _, dependency := range info.Deps {
		if dependency.Path == "go.temporal.io/sdk" && dependency.Version == "v1.51.0" && dependency.Sum == "h1:RsEghFfg91qWgNaecRgPrms9TA7iXskSzSQO2BwhJRs=" {
			sdkBinary = true
		}
	}
	if !sdkBinary {
		return fail("Executable does not identify the reviewed Go SDK.")
	}
	binary, err := os.ReadFile(input.Executable)
	if err != nil {
		return fail(err.Error())
	}
	digest := sha256.Sum256(binary)
	taskTypes := []string{"workflow"}
	if !localActivityOnly {
		taskTypes = append(taskTypes, "activity")
	}
	return &coverageProof{sourceSHA256, "go-unversioned-single-worker", input.Executable, input.PackageRoot, hex.EncodeToString(digest[:]), queue, taskTypes, "1.51.0", runtime.GOOS, runtime.GOARCH}, nil
}
