require 'json'
require 'ripper'
require_relative 'source_parser'

input = JSON.parse(STDIN.read)
results = input.fetch('sources').map do |path, text|
  tree = Ripper.sexp(text)
  if tree.nil?
    { path: path, error: "Ruby #{RUBY_VERSION} could not parse this source. Use a Ruby runtime compatible with the application's syntax." }
  else
    parser = GenesysRuby::SourceParser.new(path)
    parser.walk(tree)
    { path: path, classes: parser.classes, assignments: parser.assignments,
      workers: parser.workers.uniq { |worker| worker[:line] }, runs: parser.runs.uniq, private_constants: parser.private_constants,
      diagnostics: parser.diagnostics.uniq, relative_requires: parser.relative_requires.uniq }
  end
end
STDOUT.write(JSON.generate({ ruby_version: RUBY_VERSION, files: results }))
