# frozen_string_literal: true

require 'temporalio/activity'
require 'temporalio/worker/interceptor'

module GreetingOptions
  EXPLICIT = Temporalio::Activity::Definition::Info.new(name: 'RubyExplicit') { 'explicit' }

  class ActivityInterceptor
    include Temporalio::Worker::Interceptor::Activity

    class Inbound < Temporalio::Worker::Interceptor::Activity::Inbound
      def execute(input)
        "intercepted(#{super})"
      end
    end

    def intercept_activity(next_interceptor)
      Inbound.new(next_interceptor)
    end
  end
end
