package activities

import (
	"context"
	"os"
)

func WorkerPID(_ context.Context) (int, error) {
	return os.Getpid(), nil
}
