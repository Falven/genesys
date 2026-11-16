package workflows

import (
	"time"

	"example.com/native-workers/temporal/activities"
	"go.temporal.io/sdk/workflow"
)

func LifecycleProbe(ctx workflow.Context, hold bool) (activities.Observation, error) {
	ctx = workflow.WithActivityOptions(ctx, workflow.ActivityOptions{
		StartToCloseTimeout:   10 * time.Second,
		DisableEagerExecution: true,
	})
	var observed activities.Observation
	if err := workflow.SetQueryHandler(ctx, "observed", func() (activities.Observation, error) {
		return observed, nil
	}); err != nil {
		return observed, err
	}
	if err := workflow.ExecuteActivity(ctx, activities.Observe).Get(ctx, &observed); err != nil || !hold {
		return observed, err
	}
	workflow.GetSignalChannel(ctx, "release").Receive(ctx, nil)
	err := workflow.ExecuteActivity(ctx, activities.Observe).Get(ctx, &observed)
	return observed, err
}
