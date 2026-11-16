package workflows

import (
	"time"

	"example.com/native-workers/temporal/activities"
	"go.temporal.io/sdk/workflow"
)

func ReadinessProbe(ctx workflow.Context, remote bool) (int, error) {
	var pid int
	if remote {
		ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
			StartToCloseTimeout:   10 * time.Second,
			DisableEagerExecution: true,
		})
		err := workflow.ExecuteActivity(ctx, activities.WorkerPID).Get(ctx, &pid)
		return pid, err
	}
	ctx = workflow.WithLocalActivityOptions(ctx, workflow.LocalActivityOptions{
		StartToCloseTimeout: 10 * time.Second,
	})
	err := workflow.ExecuteLocalActivity(ctx, activities.WorkerPID).Get(ctx, &pid)
	return pid, err
}
