package activities

import (
	"context"
	"os"
	"path/filepath"

	"example.com/native-workers/support"
	"go.temporal.io/sdk/activity"
)

func Probe(ctx context.Context, hold bool) (int, error) {
	if hold {
		if err := os.WriteFile(filepath.Join(os.Getenv("GENESYS_E2E_SHUTDOWN_DIR"), "activity-started"), nil, 0600); err != nil {
			return 0, err
		}
		select {
		case <-activity.GetWorkerStopChannel(ctx):
		case <-ctx.Done():
			return 0, ctx.Err()
		}
		if err := os.WriteFile(filepath.Join(os.Getenv("GENESYS_E2E_SHUTDOWN_DIR"), "activity-stopping"), nil, 0600); err != nil {
			return 0, err
		}
		if err := support.WaitForGate(ctx, "release-activity"); err != nil {
			return 0, err
		}
	}
	return os.Getpid(), nil
}
