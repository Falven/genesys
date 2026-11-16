package main

import (
	"context"
	"log"
	"os"
	"strings"
	"time"

	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/client"
)

func execute(ctx context.Context, c client.Client, queue, name string, args ...any) client.WorkflowRun {
	run, err := c.ExecuteWorkflow(ctx, client.StartWorkflowOptions{
		TaskQueue: queue, WorkflowExecutionTimeout: 15 * time.Second,
	}, name, args...)
	if err != nil {
		log.Fatal(err)
	}
	return run
}

func requireResult(ctx context.Context, c client.Client, queue, name, want string, args ...any) client.WorkflowRun {
	run := execute(ctx, c, queue, name, args...)
	var got string
	if err := run.Get(ctx, &got); err != nil || got != want {
		log.Fatalf("%s on %s: got %q, want %q (error: %v)", name, queue, got, want, err)
	}
	return run
}

func initial(ctx context.Context, c client.Client) {
	run := requireResult(ctx, c, "orders", "Order", "owned-orders:123:intercepted", "123")
	value, err := c.QueryWorkflow(ctx, run.GetID(), run.GetRunID(), "receipt")
	if err != nil {
		log.Fatal(err)
	}
	var receipt string
	if err := value.Get(&receipt); err != nil || receipt != "owned-orders:123:intercepted" {
		log.Fatalf("receipt query: got %q (error: %v)", receipt, err)
	}

	requireResult(ctx, c, "orders", "privateReceipt", "private:123", "123")
	requireResult(ctx, c, "orders", "Lookup", "lookup:123", "123")
	requireResult(ctx, c, "orders", "manual-receipt", "manual:123", "123")
	requireResult(ctx, c, "alternate-orders", "Lookup", "alternate:123", "123")
	requireResult(ctx, c, "orders", "Legacy", "legacy")
	requireResult(ctx, c, "orders", "InvokeCatalog", "owned-catalog:123", "quote", "123")
	requireResult(ctx, c, "orders", "InvokeCatalog", "owned-catalog:valid:123", "validate", "123")
	err = execute(ctx, c, "orders", "InvokeCatalog", "validate", "invalid").Get(ctx, nil)
	if err == nil || !strings.Contains(err.Error(), "catalog rejected invalid") {
		log.Fatalf("catalog validation: expected authored rejection, got %v", err)
	}
}

func updated(ctx context.Context, c client.Client) {
	requireResult(ctx, c, "orders", "Lookup", "lookup:123", "123")
	requireResult(ctx, c, "orders", "Current", "current")
	run := execute(ctx, c, "orders", "Legacy")
	history := c.GetWorkflowHistory(ctx, run.GetID(), run.GetRunID(), true, enumspb.HISTORY_EVENT_FILTER_TYPE_ALL_EVENT)
	for history.HasNext() {
		event, err := history.Next()
		if err != nil {
			log.Fatal(err)
		}
		failure := event.GetWorkflowTaskFailedEventAttributes().GetFailure().GetMessage()
		if strings.Contains(failure, "unable to find workflow type: Legacy") {
			return
		}
	}
	log.Fatal("replacement Worker did not reject removed Workflow Legacy")
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Second)
	defer cancel()
	c, err := client.DialContext(ctx, client.Options{
		HostPort:  os.Getenv("TEMPORAL_ADDRESS"),
		Namespace: os.Getenv("TEMPORAL_NAMESPACE"),
	})
	if err != nil {
		log.Fatal(err)
	}
	defer c.Close()

	switch os.Args[1] {
	case "initial":
		initial(ctx, c)
	case "updated":
		updated(ctx, c)
	default:
		log.Fatalf("unknown probe %q", os.Args[1])
	}
}
