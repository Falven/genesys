# frozen_string_literal: true

require 'temporalio/workflow'

module RubyGreeting
  WorkflowBase = Temporalio::Workflow::Definition

  class Greeting < WorkflowBase
    workflow_name 'RubyGreeting'

    workflow_signal(name: 'release_greeting')
    def release(name)
      @name = name
    end

    def execute
      Temporalio::Workflow.wait_condition { @name }
      text = Temporalio::Workflow.execute_activity('RubyGreetingText', @name, start_to_close_timeout: 5)
      punctuation = Temporalio::Workflow.execute_activity('RubyPunctuation', start_to_close_timeout: 5)
      explicit = Temporalio::Workflow.execute_activity('RubyExplicit', start_to_close_timeout: 5)
      [text, punctuation, explicit]
    end
  end

  class RetiredGreeting < WorkflowBase
    def execute
      'retired'
    end
  end
end
