package main

import (
	"log"
	"os"

	"example.com/go-registration/support"
	"example.com/go-registration/temporal/activities"
	"example.com/go-registration/temporal/gsysregistration"
	services "example.com/go-registration/temporal/nexus"
	"example.com/go-registration/temporal/workflows"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/interceptor"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
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

	catalog, err := services.NewCatalog("owned-catalog:")
	if err != nil {
		log.Fatal(err)
	}
	w := worker.New(c, "orders", worker.Options{
		Interceptors: []interceptor.WorkerInterceptor{&support.ReceiptInterceptor{}},
	})
	gsysregistration.Register(w, &activities.Orders{Prefix: "owned-orders:"}, catalog)
	w.RegisterWorkflowWithOptions(workflows.ExplicitReceipt, workflow.RegisterOptions{Name: "manual-receipt"})

	other := worker.New(c, "alternate-orders", worker.Options{})
	other.RegisterWorkflowWithOptions(workflows.AlternateOrder, workflow.RegisterOptions{Name: "Lookup"})
	other.RegisterActivityWithOptions(&activities.Orders{Prefix: "alternate:"}, activity.RegisterOptions{Name: "alt-"})
	if err := other.Start(); err != nil {
		log.Fatal(err)
	}
	defer other.Stop()

	if err := w.Run(worker.InterruptCh()); err != nil {
		log.Fatal(err)
	}
}
