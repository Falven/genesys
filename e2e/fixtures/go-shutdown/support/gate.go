package support

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"time"
)

func WaitForGate(ctx context.Context, name string) error {
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	path := filepath.Join(os.Getenv("GENESYS_E2E_SHUTDOWN_DIR"), name)
	for {
		if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
			return err
		}
		select {
		case <-ticker.C:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}
