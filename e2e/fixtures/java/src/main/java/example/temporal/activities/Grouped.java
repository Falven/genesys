package example.temporal.activities;

import io.temporal.activity.ActivityInterface;
import io.temporal.activity.ActivityMethod;

@ActivityInterface(namePrefix = "Group_")
public interface Grouped extends Base {
    @ActivityMethod(name = "Other")
    String second();

    @ActivityInterface
    interface Manual {
        @ActivityMethod(name = "Explicit")
        String value();
    }
}
