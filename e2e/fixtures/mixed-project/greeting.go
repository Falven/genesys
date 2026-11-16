package workflows

import (
	"time"

	"go.temporal.io/sdk/workflow"
)

func Greeting(ctx workflow.Context, name string) (string, error) {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		TaskQueue:           "genesys-python",
		StartToCloseTimeout: 10 * time.Second,
	})
	var greeting string
	err := workflow.ExecuteActivity(ctx, "ComposeGreeting", name).Get(ctx, &greeting)
	return greeting, err
}
