require_relative 'syntax'

module GenesysRuby
  class SourceParser
    include Syntax

    attr_reader :classes, :assignments, :workers, :diagnostics,
                :private_constants, :runs, :relative_requires

    def initialize(path)
      @path = path
      @classes = []
      @assignments = []
      @workers = []
      @diagnostics = []
      @private_constants = []
      @worker_variables = []
      @runs = []
      @relative_requires = []
    end

    def walk(node, namespace = [], conditional = false, executable = true)
      return unless node.is_a?(Array)

      case node[0]
      when :module
        name = qualified(constant(node[1]), namespace)
        return walk(node[2], name ? name.split('::') : namespace, conditional, executable)
      when :class
        name = record_class(node, namespace, conditional)
        return walk(node[3], name.split('::'), conditional, false) if name
      when :def, :defs, :sclass
        return
      when :assign
        record_assignment(node, namespace, conditional)
      end

      invocation = call(node)
      record_invocation(invocation, node, namespace, conditional, executable) if invocation
      child_conditional = conditional ||
                          %i[if unless if_mod unless_mod case while until for rescue].include?(node[0])
      node.each { |child| walk(child, namespace, child_conditional, executable) }
    end

    private

    def diagnostic(code, message, node)
      @diagnostics << {
        code: code,
        severity: 'warning',
        message: message,
        source: { path: @path, line: position(node)&.first || 1 }
      }
    end

    def record_class(node, namespace, conditional)
      name = qualified(constant(node[1]), namespace)
      return unless name

      statements = node.dig(3, 1) || []
      metadata = statements.map { |statement| call(statement) }.compact
      initializer = statements.find do |statement|
        statement[0] == :def && statement.dig(1, 1) == 'initialize'
      end
      parameters = initializer && initializer[2]
      parameters = parameters[1] if parameters && parameters[0] == :paren
      required = parameters && parameters[0] == :params &&
                 (!(parameters[1] || []).empty? ||
                  !(parameters[4] || []).empty? ||
                  (parameters[5] || []).any? { |keyword| keyword[1] == false })
      @classes << {
        symbol: name,
        parent: constant(node[2]),
        namespace: namespace,
        path: @path,
        line: position(node[1])&.first || 1,
        conditional: conditional,
        calls: metadata.select { |item| item[:receiver].nil? },
        initializer: !initializer.nil?,
        required: !!required,
        uncertain: statements.any? do |statement|
          %i[if unless case begin method_add_block].include?(statement[0])
        end
      }
      name
    end

    def record_assignment(node, namespace, conditional)
      name = constant(node[1])
      assigned_call = call(node[2])
      if assigned_call && assigned_call[:name] == 'new' && native_worker?(assigned_call[:receiver])
        @worker_variables << node[1][1][1] if node.dig(1, 0) == :var_field
      end
      return unless name

      @assignments << {
        symbol: qualified(name, namespace),
        value: node[2],
        namespace: namespace,
        path: @path,
        line: position(node[1])&.first || 1,
        conditional: conditional
      }
    end

    def record_invocation(invocation, node, namespace, conditional, executable)
      record_relative_import(invocation, node)
      receiver = invocation[:receiver]
      receiver_call = call(receiver)
      worker_instance =
        (receiver && receiver[0] == :var_ref && @worker_variables.include?(receiver.dig(1, 1))) ||
        (receiver_call && receiver_call[:name] == 'new' && native_worker?(receiver_call[:receiver]))
      runs_workers = (native_worker?(receiver) && invocation[:name] == 'run_all') ||
                     (worker_instance && invocation[:name] == 'run')
      @runs << invocation[:line] if executable && runs_workers

      if invocation[:name] == 'private_constant'
        invocation[:args].each do |argument|
          value = literal(argument)
          if value[:known] && value[:value].is_a?(String)
            @private_constants << qualified(value[:value], namespace)
          end
        end
      end
      if %w[class_eval module_eval const_set define_method].include?(invocation[:name])
        diagnostic(
          'ruby.metaprogramming-unresolved',
          'Runtime Ruby definitions require explicit native assembly; discovery does not execute metaprogramming.',
          node
        )
      end
      return unless native_worker?(receiver) && invocation[:name] == 'new'

      @workers << {
        path: @path,
        line: invocation[:line],
        options: keywords(invocation[:args]),
        namespace: namespace,
        executable: executable,
        conditional: conditional
      }
    end

    def record_relative_import(invocation, node)
      return unless invocation[:receiver].nil? && invocation[:name] == 'require_relative'

      value = literal(invocation[:args].first)
      if value[:known] && value[:value].is_a?(String)
        @relative_requires << value[:value]
      elsif !invocation[:args].empty?
        diagnostic(
          'ruby.relative-import-unresolved',
          'Computed require_relative needs native runtime resolution; foreign package definitions are not assumed to be in this scope.',
          node
        )
      end
    end

    def native_worker?(node)
      constant(node)&.sub(/^::/, '') == 'Temporalio::Worker'
    end
  end
end
