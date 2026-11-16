package example.temporal.activities;

public class GroupedImpl implements Grouped {
    public String first(String value) {
        return "inherited:" + value;
    }

    public String second() {
        return "overridden";
    }

    public static Grouped.Manual manual() {
        return new Explicit();
    }

    static class Explicit implements Grouped.Manual {
        public String value() {
            return "explicit";
        }
    }
}
