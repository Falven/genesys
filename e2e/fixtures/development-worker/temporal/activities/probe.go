package activities

import (
	"context"
	"os"

	version "example.com/native-workers"
)

type Observation struct {
	Version string `json:"version"`
	PID     int    `json:"pid"`
	CWD     string `json:"cwd"`
}

func Observe(_ context.Context) (Observation, error) {
	cwd, err := os.Getwd()
	return Observation{Version: version.BuildID(), PID: os.Getpid(), CWD: cwd}, err
}
