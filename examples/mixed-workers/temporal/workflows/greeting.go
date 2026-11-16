package workflows

import (
	"time"

	"go.temporal.io/sdk/workflow"
)

func Greeting(ctx workflow.Context, name string) (string, error) {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		TaskQueue:           "greetings",
		StartToCloseTimeout: 10 * time.Second,
	})
	var greeting string
	if err := workflow.ExecuteActivity(ctx, "ComposeGreeting", name).Get(ctx, &greeting); err != nil {
		return "", err
	}
	var result string
	err := workflow.ExecuteActivity(ctx, "UppercaseGreeting", greeting).Get(ctx, &result)
	return result, err
}
