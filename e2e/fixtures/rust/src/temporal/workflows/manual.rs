use temporalio_macros::{workflow, workflow_methods};
use temporalio_sdk::{WorkflowContext, WorkflowResult};

#[workflow]
#[derive(Default)]
pub(super) struct Manual;

#[cfg(not(test))]
#[workflow_methods]
impl Manual {
    #[run(name = "manual-workflow")]
    pub(in crate::temporal::workflows) async fn run(
        _ctx: &mut WorkflowContext<Self>,
    ) -> WorkflowResult<String> {
        Ok("explicit".into())
    }
}
