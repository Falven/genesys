use std::sync::{
    Arc,
    atomic::{AtomicU32, Ordering},
};
use temporalio_macros::activities as native_activities;
use temporalio_sdk::{
    WorkerOptionsBuilder, WorkflowRegistrationError,
    activities::{ActivityContext, ActivityError},
    worker_options_builder::State,
};

pub(super) struct Operations {
    prefix: &'static str,
    count: AtomicU32,
}

#[native_activities]
impl Operations {
    #[activity(name = "greeting")]
    pub(in crate::temporal) async fn greet(
        self: Arc<Self>,
        _ctx: ActivityContext,
        name: String,
    ) -> Result<String, ActivityError> {
        self.count.fetch_add(1, Ordering::Relaxed);
        Ok(format!("{}{name}", self.prefix))
    }

    #[activity]
    pub(in crate::temporal) async fn increment(
        self: Arc<Self>,
        _ctx: ActivityContext,
    ) -> Result<u32, ActivityError> {
        Ok(self.count.fetch_add(1, Ordering::Relaxed))
    }
}

include!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/.gsys/compile/rust/6a7af8d7cf6e19cc/registration/f44ebe0691d481d2.rs"
));

pub(crate) fn register<S: State>(
    options: WorkerOptionsBuilder<S>,
) -> Result<WorkerOptionsBuilder<S>, WorkflowRegistrationError> {
    genesys_register_f44ebe0691d481d2(
        options,
        Operations {
            prefix: "instance:",
            count: AtomicU32::new(41),
        },
    )
}
