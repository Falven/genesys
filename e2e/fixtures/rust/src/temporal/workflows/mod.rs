mod manual;

use super::activities::Operations;
use std::time::Duration;
use temporalio_macros::{workflow, workflow_methods as native_workflow_methods};
use temporalio_sdk::{
    ActivityOptions, SyncWorkflowContext, WorkerOptionsBuilder, WorkflowContext,
    WorkflowRegistrationError, WorkflowResult, worker_options_builder::State,
};

#[workflow]
struct WithFactory {
    name: &'static str,
    suffix: Option<String>,
}

#[native_workflow_methods(factory_only)]
impl WithFactory {
    #[run]
    async fn run(ctx: &mut WorkflowContext<Self>) -> WorkflowResult<String> {
        ctx.wait_condition(|state| state.suffix.is_some()).await?;
        let (name, suffix) = ctx.state(|state| (state.name, state.suffix.clone().unwrap()));
        let greeting = ctx
            .execute_activity(
                Operations::greet,
                name.to_owned(),
                ActivityOptions::start_to_close_timeout(Duration::from_secs(5)),
            )
            .await?;
        let count = ctx
            .execute_activity(
                Operations::increment,
                (),
                ActivityOptions::start_to_close_timeout(Duration::from_secs(5)),
            )
            .await?;
        Ok(format!("{greeting}:{count}:{suffix}"))
    }

    #[signal(name = "release")]
    fn release(&mut self, _ctx: &mut SyncWorkflowContext<Self>, suffix: String) {
        self.suffix = Some(suffix);
    }
}

#[workflow]
#[derive(Default)]
struct Greeting;

#[native_workflow_methods]
impl Greeting {
    #[run(name = "hello-workflow")]
    async fn run(_ctx: &mut WorkflowContext<Self>) -> WorkflowResult<String> {
        Ok("before".into())
    }
}

include!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/.gsys/compile/rust/6a7af8d7cf6e19cc/registration/7cb028dcb66a522c.rs"
));

pub(crate) fn register<S: State>(
    options: WorkerOptionsBuilder<S>,
) -> Result<WorkerOptionsBuilder<S>, WorkflowRegistrationError> {
    genesys_register_7cb028dcb66a522c(options, || WithFactory {
        name: "factory",
        suffix: None,
    })?
    .register_workflow::<manual::Manual>()
}
