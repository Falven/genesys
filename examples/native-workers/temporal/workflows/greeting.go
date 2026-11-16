package workflows

import (
	"time"

	"example.com/native-workers/temporal/activities"
	"go.temporal.io/sdk/workflow"
)

func Greeting(ctx workflow.Context, name string) (string, error) {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout: time.Minute,
	})
	var result string
	err := workflow.ExecuteActivity(ctx, activities.Greet, name).Get(ctx, &result)
	return result, err
}
