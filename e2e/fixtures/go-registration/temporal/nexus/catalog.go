package services

import (
	"context"

	"github.com/nexus-rpc/sdk-go/nexus"
)

func NewCatalog(prefix string) (*nexus.Service, error) {
	catalog := nexus.NewService("catalog")
	return catalog, catalog.Register(
		nexus.NewSyncOperation("quote", func(_ context.Context, id string, _ nexus.StartOperationOptions) (string, error) {
			return prefix + id, nil
		}),
		nexus.NewSyncOperation("validate", func(_ context.Context, id string, _ nexus.StartOperationOptions) (string, error) {
			if id == "invalid" {
				return "", nexus.NewHandlerErrorf(nexus.HandlerErrorTypeBadRequest, "catalog rejected %s", id)
			}
			return prefix + "valid:" + id, nil
		}),
	)
}
