# frozen_string_literal: true

require 'temporalio/activity'

module RubyGreeting
  class GreetingText < Temporalio::Activity::Definition
    activity_name :RubyGreetingText

    def initialize(prefix)
      @prefix = prefix
    end

    def execute(name)
      "#{@prefix}, #{name}"
    end
  end

  INFO = Temporalio::Activity::Definition::Info.new(name: 'RubyPunctuation') { '!' }
end
