# frozen_string_literal: true

# This program parses text received on stdin. It never loads project files.
require 'json'
require 'ripper'

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
      # Escapes depend on the quote mode, which Ripper's sexp does not retain.
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

class SourceParser
  attr_reader :classes, :assignments, :workers, :diagnostics, :private_constants, :runs, :relative_requires

  def initialize(path)
    @path = path
    @classes, @assignments, @workers, @diagnostics, @private_constants = [], [], [], [], []
    @worker_variables, @runs, @relative_requires = [], [], []
  end

  def diagnostic(code, message, node)
    @diagnostics << { code: code, severity: 'warning', message: message,
                      source: { path: @path, line: position(node)&.first || 1 } }
  end

  def walk(node, namespace = [], conditional = false, executable = true)
    return unless node.is_a?(Array)
    case node[0]
    when :module
      name = qualified(constant(node[1]), namespace)
      return walk(node[2], name ? name.split('::') : namespace, conditional, executable)
    when :class
      name = qualified(constant(node[1]), namespace)
      if name
        statements = node.dig(3, 1) || []
        metadata = statements.map { |statement| call(statement) }.compact
        initializer = statements.find { |statement| statement[0] == :def && statement.dig(1, 1) == 'initialize' }
        params = initializer && initializer[2]
        params = params[1] if params && params[0] == :paren
        required = params && params[0] == :params &&
                   (!(params[1] || []).empty? || !(params[4] || []).empty? || (params[5] || []).any? { |kw| kw[1] == false })
        @classes << { symbol: name, parent: constant(node[2]), namespace: namespace,
                      path: @path, line: position(node[1])&.first || 1,
                      conditional: conditional, calls: metadata.select { |item| item[:receiver].nil? },
                      initializer: !initializer.nil?, required: !!required,
                      uncertain: statements.any? { |statement| %i[if unless case begin method_add_block].include?(statement[0]) } }
        return walk(node[3], name.split('::'), conditional, false)
      end
    when :def, :defs, :sclass
      return # A method body does not execute when the file is loaded.
    when :assign
      name = constant(node[1])
      assigned_call = call(node[2])
      if assigned_call && assigned_call[:name] == 'new' && constant(assigned_call[:receiver])&.sub(/^::/, '') == 'Temporalio::Worker'
        @worker_variables << node[1][1][1] if node.dig(1, 0) == :var_field
      end
      if name
        @assignments << { symbol: qualified(name, namespace), value: node[2], namespace: namespace,
                          path: @path, line: position(node[1])&.first || 1, conditional: conditional }
      end
    end

    invocation = call(node)
    if invocation
      if invocation[:receiver].nil? && invocation[:name] == 'require_relative'
        value = literal(invocation[:args].first)
        if value[:known] && value[:value].is_a?(String)
          @relative_requires << value[:value]
        elsif !invocation[:args].empty?
          diagnostic('ruby.relative-import-unresolved', 'Computed require_relative needs native runtime resolution; foreign package definitions are not assumed to be in this scope.', node)
        end
      end
      receiver = invocation[:receiver]
      receiver_call = call(receiver)
      native_worker = constant(receiver)&.sub(/^::/, '') == 'Temporalio::Worker'
      worker_instance = (receiver && receiver[0] == :var_ref && @worker_variables.include?(receiver.dig(1, 1))) ||
                        (receiver_call && receiver_call[:name] == 'new' && constant(receiver_call[:receiver])&.sub(/^::/, '') == 'Temporalio::Worker')
      if executable && ((native_worker && invocation[:name] == 'run_all') || (worker_instance && invocation[:name] == 'run'))
        @runs << invocation[:line]
      end
      if invocation[:name] == 'private_constant'
        invocation[:args].each do |arg|
          value = literal(arg)
          @private_constants << qualified(value[:value], namespace) if value[:known] && value[:value].is_a?(String)
        end
      end
      if %w[class_eval module_eval const_set define_method].include?(invocation[:name])
        diagnostic('ruby.metaprogramming-unresolved', 'Runtime Ruby definitions require explicit native assembly; discovery does not execute metaprogramming.', node)
      end
      if constant(invocation[:receiver])&.sub(/^::/, '') == 'Temporalio::Worker' && invocation[:name] == 'new'
        @workers << { path: @path, line: invocation[:line], options: keywords(invocation[:args]), namespace: namespace,
                      executable: executable, conditional: conditional }
      end
    end
    child_conditional = conditional || %i[if unless if_mod unless_mod case while until for rescue].include?(node[0])
    node.each { |child| walk(child, namespace, child_conditional, executable) }
  end
end

input = JSON.parse(STDIN.read)
results = input.fetch('sources').map do |path, text|
  tree = Ripper.sexp(text)
  if tree.nil?
    { path: path, error: "Ruby #{RUBY_VERSION} could not parse this source. Use a Ruby runtime compatible with the application's syntax." }
  else
    parser = SourceParser.new(path)
    parser.walk(tree)
    { path: path, classes: parser.classes, assignments: parser.assignments,
      workers: parser.workers.uniq { |worker| worker[:line] }, runs: parser.runs.uniq, private_constants: parser.private_constants,
      diagnostics: parser.diagnostics.uniq, relative_requires: parser.relative_requires.uniq }
  end
end
STDOUT.write(JSON.generate({ ruby_version: RUBY_VERSION, files: results }))
