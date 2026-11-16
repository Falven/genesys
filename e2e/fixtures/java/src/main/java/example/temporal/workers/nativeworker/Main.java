package example.temporal.workers.nativeworker;

import example.temporal.activities.DependentImpl;
import example.temporal.activities.GroupedImpl;
import example.temporal.lib.NativeClient;
import example.temporal.nexus.EchoImpl;
import genesys.generated.GenesysRegistration_c5e2d8aa87be;
import io.temporal.worker.WorkerFactory;
import io.temporal.worker.WorkerOptions;
import java.util.Properties;
import java.util.concurrent.TimeUnit;

public class Main {
    public static class Launcher {
        public static void main(String[] args) throws Exception {
            var settings = new Properties();
            try (var resource = Launcher.class.getResourceAsStream("/java-worker.properties")) {
                settings.load(resource);
            }
            var service = NativeClient.service();
            var factory = WorkerFactory.newInstance(NativeClient.client(service));
            var worker = factory.newWorker(NativeClient.QUEUE, WorkerOptions.newBuilder()
                    .setIdentity(settings.getProperty("workerIdentity")).build());
            GenesysRegistration_c5e2d8aa87be.register(worker,
                    new DependentImpl(settings.getProperty("activityPrefix")),
                    new GroupedImpl(), new EchoImpl("nexus"));
            worker.registerActivitiesImplementations(GroupedImpl.manual());
            Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                factory.shutdown();
                factory.awaitTermination(20, TimeUnit.SECONDS);
                service.shutdownNow();
            }));
            factory.start();
        }
    }
}
