# frozen_string_literal: true

require 'json'
require 'securerandom'
require 'temporalio/client'

client = Temporalio::Client.connect(ENV.fetch('TEMPORAL_ADDRESS'), ENV.fetch('TEMPORAL_NAMESPACE'))
workflow = ARGV.fetch(0)
handle = client.start_workflow(workflow, id: SecureRandom.uuid, task_queue: 'ruby-greetings', execution_timeout: 15)
handle.signal('release_greeting', 'Genesys') if workflow == 'RubyGreeting'
puts JSON.generate(handle.result)
