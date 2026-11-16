package example.temporal.activities;

import io.temporal.activity.ActivityInterface;

@ActivityInterface
public interface Dependent {
    String configured();
}
