use temporalio_sdk::interceptors::{
    ActivityInboundInterceptor, ExecuteActivityInput, ExecuteActivityOutput, Next,
};

pub(crate) struct AddSuffix;

impl ActivityInboundInterceptor for AddSuffix {
    fn execute_activity<'a>(
        &'a self,
        mut input: ExecuteActivityInput,
        next: Next<'a, ExecuteActivityInput, ExecuteActivityOutput<'a>>,
    ) -> ExecuteActivityOutput<'a> {
        if let Some(name) = input.args_mut::<String>() {
            name.push_str("-intercepted");
        }
        next.run(input)
    }
}
