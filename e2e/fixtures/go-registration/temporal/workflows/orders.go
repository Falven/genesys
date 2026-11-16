package workflows

import (
	"os"
	"time"

	"example.com/go-registration/support"
	"go.temporal.io/sdk/workflow"
)

type Context = workflow.Context

var LookupAlias = support.Lookup

var ExplicitReceipt = func(_ Context, id string) (string, error) {
	return "manual:" + id, nil
}

func init() {
	if marker := os.Getenv("GO_REGISTRATION_INIT_MARKER"); marker != "" {
		if err := os.WriteFile(marker, []byte("worker initialized"), 0600); err != nil {
			panic(err)
		}
	}
}

func Order(ctx Context, id string) (string, error) {
	var receipt string
	if err := workflow.SetQueryHandler(ctx, "receipt", func() (string, error) {
		return receipt, nil
	}); err != nil {
		return "", err
	}
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{StartToCloseTimeout: 5 * time.Second})
	err := workflow.ExecuteActivity(ctx, "Load", id).Get(ctx, &receipt)
	return receipt, err
}

func privateReceipt(_ Context, id string) (string, error) {
	return "private:" + id, nil
}

func AlternateOrder(ctx Context, id string) (string, error) {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{StartToCloseTimeout: 5 * time.Second})
	var receipt string
	err := workflow.ExecuteActivity(ctx, "alt-Load", id).Get(ctx, &receipt)
	return receipt, err
}

func InvokeCatalog(ctx Context, operation, input string) (string, error) {
	catalog := workflow.NewNexusClient("orders-endpoint", "catalog")
	var result string
	err := catalog.ExecuteOperation(ctx, operation, input, workflow.NexusOperationOptions{
		ScheduleToCloseTimeout: 10 * time.Second,
	}).Get(ctx, &result)
	return result, err
}
