package activities

import "context"

func Greet(_ context.Context, name string) (string, error) {
	return "Hello, " + name + "!", nil
}
