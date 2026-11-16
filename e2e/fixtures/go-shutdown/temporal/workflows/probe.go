package workflows

import (
	"time"

	"example.com/native-workers/temporal/activities"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

func ShutdownProbe(ctx workflow.Context, hold bool) (int, error) {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout:   2 * time.Minute,
		DisableEagerExecution: true,
		RetryPolicy:           &temporal.RetryPolicy{MaximumAttempts: 1},
	})
	var pid int
	err := workflow.ExecuteActivity(ctx, activities.Probe, hold).Get(ctx, &pid)
	return pid, err
}
