module GenesysRuby
  module Syntax
    private

    def constant(node)
      return unless node.is_a?(Array)
      case node[0]
      when :@const then node[1]
      when :var_ref, :var_field, :const_ref then constant(node[1])
      when :top_const_ref, :top_const_field then "::#{constant(node[1])}"
      when :const_path_ref, :const_path_field
        left = constant(node[1])
        "#{left}::#{constant(node[2])}" if left
      end
    end

    def position(node)
      return unless node.is_a?(Array)
      return node[2] if node[0].to_s.start_with?('@')
      node.each do |child|
        found = position(child)
        return found if found
      end
      nil
    end

    def qualified(name, namespace)
      return unless name
      return name.sub(/^::/, '') if name.start_with?('::')
      (namespace + [name]).join('::')
    end

    def arguments(node)
      return [] unless node.is_a?(Array)
      return arguments(node[1]) if node[0] == :arg_paren
      return node[1] || [] if node[0] == :args_add_block && node[2] == false
      []
    end

    def call(node)
      return unless node.is_a?(Array)
      case node[0]
      when :method_add_block then call(node[1])
      when :method_add_arg
        base = call(node[1])
        base && base.merge(args: arguments(node[2]))
      when :command then { receiver: nil, name: node[1][1], args: arguments(node[2]), line: node[1][2][0] }
      when :command_call then { receiver: node[1], name: node[3][1], args: arguments(node[4]), line: node[3][2][0] }
      when :call then { receiver: node[1], name: node[3][1], args: [], line: node[3][2][0] }
      when :fcall, :vcall then { receiver: nil, name: node[1][1], args: [], line: node[1][2][0] }
      end
    end

    def literal(node)
      return { known: false } unless node.is_a?(Array)
      case node[0]
      when :symbol_literal
        token = node.dig(1, 1)
        return { known: true, value: token[1] } if token && %i[@ident @const @op].include?(token[0])
      when :string_literal, :dyna_symbol
        content = node[1]
        if content && content[0] == :string_content && content.drop(1).all? { |part| part[0] == :@tstring_content }
          text = content.drop(1).map { |part| part[1] }.join
          return { known: true, value: text } unless text.include?('\\')
        end
      when :var_ref
        token = node[1]
        return { known: true, value: { 'true' => true, 'false' => false, 'nil' => nil }[token[1]] } if token[0] == :@kw && %w[true false nil].include?(token[1])
      end
      { known: false }
    end

    def keywords(args)
      hash = args.find { |arg| arg.is_a?(Array) && %i[bare_assoc_hash hash].include?(arg[0]) }
      return {} unless hash
      pairs = hash[0] == :hash ? hash.dig(1, 1) : hash[1]
      (pairs || []).each_with_object({}) do |pair, result|
        next unless pair[0] == :assoc_new && pair.dig(1, 0) == :@label
        result[pair[1][1].sub(/:$/, '')] = pair[2]
      end
    end

  end
end
