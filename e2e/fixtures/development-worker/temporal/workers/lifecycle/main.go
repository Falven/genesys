package main

import (
	"log"
	"os"
	"time"

	version "example.com/native-workers"
	"example.com/native-workers/temporal/gsysregistration"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

func main() {
	c, err := client.Dial(client.Options{
		HostPort:                os.Getenv("TEMPORAL_ADDRESS"),
		Namespace:               os.Getenv("TEMPORAL_NAMESPACE"),
		WorkerHeartbeatInterval: time.Second,
	})
	if err != nil {
		log.Fatal(err)
	}
	defer c.Close()

	worker.SetStickyWorkflowCacheSize(0)
	w := worker.New(c, "lifecycle", worker.Options{
		Identity: os.Getenv("GENESYS_LIFECYCLE_WORKER_IDENTITY"),
		DeploymentOptions: worker.DeploymentOptions{
			UseVersioning: true,
			Version: worker.WorkerDeploymentVersion{
				DeploymentName: "lifecycle",
				BuildID:        version.BuildID(),
			},
			DefaultVersioningBehavior: workflow.VersioningBehaviorPinned,
		},
	})
	gsysregistration.Register(w)
	if err := w.Run(worker.InterruptCh()); err != nil {
		log.Fatal(err)
	}
}
