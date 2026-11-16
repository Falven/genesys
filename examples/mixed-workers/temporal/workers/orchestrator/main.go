package main

import (
	"log"
	"os"
	"time"

	"example.com/mixed-workers/temporal/gsysregistration"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
)

func main() {
	c, err := client.Dial(client.Options{
		HostPort:  os.Getenv("TEMPORAL_ADDRESS"),
		Namespace: os.Getenv("TEMPORAL_NAMESPACE"),
	})
	if err != nil {
		log.Fatal(err)
	}
	defer c.Close()

	w := worker.New(c, "greetings", worker.Options{
		WorkerStopTimeout:       30 * time.Second,
		LocalActivityWorkerOnly: true,
	})
	gsysregistration.Register(w)
	if err := w.Run(worker.InterruptCh()); err != nil {
		log.Print(err)
		c.Close()
		os.Exit(1)
	}
}
