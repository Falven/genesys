package main

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"example.com/native-workers/temporal/gsysregistration"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

func main() {
	worker.SetStickyWorkflowCacheSize(0)
	interrupted := worker.InterruptCh()
	c := connect(time.Second)
	defer c.Close()

	if len(os.Args) == 2 && os.Args[1] == "unrelated" {
		primary := start(c, "readiness-primary")
		defer primary.Stop()
		<-interrupted
		return
	}

	if !waitForGate("start-primary", interrupted) {
		return
	}
	primary := start(c, "readiness-primary")
	defer primary.Stop()

	if !waitForGate("start-secondary", interrupted) {
		return
	}
	secondary := start(c, "readiness-secondary")
	hiddenClient := connect(-1)
	defer hiddenClient.Close()
	hidden := start(hiddenClient, "readiness-hidden")
	defer hidden.Stop()

	keepRunning := waitForGate("stop-secondary", interrupted)
	secondary.Stop()
	fmt.Println("Secondary native Worker stopped")
	if keepRunning {
		<-interrupted
	}
}

func connect(heartbeat time.Duration) client.Client {
	c, err := client.Dial(client.Options{
		HostPort:                os.Getenv("TEMPORAL_ADDRESS"),
		Namespace:               os.Getenv("TEMPORAL_NAMESPACE"),
		WorkerHeartbeatInterval: heartbeat,
	})
	if err != nil {
		log.Fatal(err)
	}
	return c
}

func start(c client.Client, queue string) worker.Worker {
	w := worker.New(c, queue, worker.Options{})
	gsysregistration.Register(w)
	if err := w.Start(); err != nil {
		log.Fatal(err)
	}
	return w
}

func waitForGate(gate string, interrupted <-chan interface{}) bool {
	path := filepath.Join(os.Getenv("GENESYS_READINESS_CONTROL"), gate)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		_, err := os.Stat(path)
		if err == nil {
			return true
		}
		if !os.IsNotExist(err) {
			log.Fatal(err)
		}
		select {
		case <-interrupted:
			return false
		case <-ticker.C:
		}
	}
}
