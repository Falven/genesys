package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"time"

	"example.com/native-workers/support"
	"example.com/native-workers/temporal/gsysregistration"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

func observeInterrupt(control, marker string) {
	interrupt := make(chan os.Signal, 1)
	signal.Notify(interrupt, os.Interrupt)
	go func() {
		<-interrupt
		if err := os.WriteFile(filepath.Join(control, marker), nil, 0600); err != nil {
			log.Fatal(err)
		}
	}()
}

func main() {
	control := os.Getenv("GENESYS_E2E_SHUTDOWN_DIR")
	if len(os.Args) == 2 && os.Args[1] == "descendant" {
		observeInterrupt(control, "descendant-interrupted")
		if err := os.WriteFile(filepath.Join(control, "descendant-pid"), fmt.Append(nil, os.Getpid()), 0600); err != nil {
			log.Fatal(err)
		}
		if err := support.WaitForGate(context.Background(), "release-descendant"); err != nil {
			log.Fatal(err)
		}
		return
	}

	var interrupt <-chan interface{}
	if os.Getenv("GENESYS_E2E_SHUTDOWN_MODE") == "unresponsive" {
		observeInterrupt(control, "worker-interrupted")
		interrupt = make(chan interface{})
	} else {
		interrupt = worker.InterruptCh()
	}

	executable, err := os.Executable()
	if err != nil {
		log.Fatal(err)
	}
	cwd, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}
	launch, err := json.Marshal(struct {
		Args       []string `json:"args"`
		Cwd        string   `json:"cwd"`
		Executable string   `json:"executable"`
	}{os.Args[1:], cwd, executable})
	if err != nil {
		log.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(control, "worker-launch.json"), launch, 0600); err != nil {
		log.Fatal(err)
	}
	descendant := exec.Command(executable, "descendant")
	if err := descendant.Start(); err != nil {
		log.Fatal(err)
	}
	// Reap a descendant that exits before its Worker leader.
	go func() { _ = descendant.Wait() }()

	c, err := client.Dial(client.Options{
		HostPort:  os.Getenv("TEMPORAL_ADDRESS"),
		Namespace: os.Getenv("TEMPORAL_NAMESPACE"),
	})
	if err != nil {
		log.Fatal(err)
	}
	defer c.Close()

	w := worker.New(c, "shutdown", worker.Options{WorkerStopTimeout: 90 * time.Second})
	gsysregistration.Register(w)
	if err := w.Run(interrupt); err != nil {
		log.Fatal(err)
	}
}
