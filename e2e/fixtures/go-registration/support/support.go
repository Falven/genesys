package support

import (
	"context"

	"go.temporal.io/sdk/interceptor"
	"go.temporal.io/sdk/workflow"
)

func Lookup(_ workflow.Context, id string) (string, error) {
	return "lookup:" + id, nil
}

type ReceiptInterceptor struct {
	interceptor.WorkerInterceptorBase
}

func (*ReceiptInterceptor) InterceptActivity(_ context.Context, next interceptor.ActivityInboundInterceptor) interceptor.ActivityInboundInterceptor {
	return &receiptInbound{ActivityInboundInterceptorBase: interceptor.ActivityInboundInterceptorBase{Next: next}}
}

type receiptInbound struct {
	interceptor.ActivityInboundInterceptorBase
}

func (i *receiptInbound) ExecuteActivity(ctx context.Context, input *interceptor.ExecuteActivityInput) (any, error) {
	result, err := i.Next.ExecuteActivity(ctx, input)
	if receipt, ok := result.(string); ok {
		return receipt + ":intercepted", err
	}
	return result, err
}
