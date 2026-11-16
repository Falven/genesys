package example.temporal.activities;

public class DependentImpl implements Dependent {
    private final String prefix;

    public DependentImpl(String prefix) {
        this.prefix = prefix;
    }

    public String configured() {
        return prefix;
    }
}
