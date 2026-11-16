import com.sun.source.tree.*;
import com.sun.source.util.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import javax.lang.model.element.Modifier;
import javax.tools.*;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.*;

class Inspect {
  static final List<Object> types = new ArrayList<>();
  static Trees trees;

  static Object expression(ExpressionTree value) {
    if (value instanceof LiteralTree literal && literal.getValue() instanceof String) return Map.of("literal", literal.getValue());
    if (value instanceof ParenthesizedTree parens) return expression(parens.getExpression());
    if (value instanceof BinaryTree binary && binary.getKind() == Tree.Kind.PLUS)
      return Map.of("concat", List.of(expression(binary.getLeftOperand()), expression(binary.getRightOperand())));
    if (value instanceof MemberSelectTree member && member.getIdentifier().contentEquals("class"))
      return Map.of("className", member.getExpression().toString());
    return Map.of("reference", value.toString());
  }

  static List<Object> annotations(ModifiersTree modifiers) {
    List<Object> result = new ArrayList<>();
    for (AnnotationTree annotation : modifiers.getAnnotations()) {
      Map<String, Object> values = new LinkedHashMap<>();
      for (ExpressionTree argument : annotation.getArguments()) {
        if (argument instanceof AssignmentTree assignment)
          values.put(assignment.getVariable().toString(), expression(assignment.getExpression()));
        else values.put("value", expression(argument));
      }
      result.add(Map.of("name", annotation.getAnnotationType().toString(), "values", values));
    }
    return result;
  }

  static List<String> flags(ModifiersTree modifiers) {
    return modifiers.getFlags().stream().map(Modifier::toString).sorted().toList();
  }

  static String rawType(Tree type) {
    if (type instanceof ParameterizedTypeTree parameterized) return rawType(parameterized.getType());
    if (type instanceof AnnotatedTypeTree annotated) return rawType(annotated.getUnderlyingType());
    return type.toString();
  }

  static void scanType(ClassTree type, CompilationUnitTree unit, String enclosing, boolean visible, boolean implicitModifiers) {
    String simple = type.getSimpleName().toString();
    if (simple.isEmpty()) return;
    String name = enclosing.isEmpty() ? simple : enclosing + "." + simple;
    boolean isInterface = type.getKind() == Tree.Kind.INTERFACE;
    boolean accessible = visible && (implicitModifiers || type.getModifiers().getFlags().contains(Modifier.PUBLIC));
    List<String> typeFlags = new ArrayList<>(flags(type.getModifiers()));
    if (implicitModifiers) { if (!typeFlags.contains("public")) typeFlags.add("public"); if (!typeFlags.contains("static")) typeFlags.add("static"); }
    List<Object> methods = new ArrayList<>();
    Map<String, Object> constants = new LinkedHashMap<>();
    for (Tree member : type.getMembers()) {
      if (member instanceof MethodTree method) {
        methods.add(Map.of("name", method.getName().toString(), "flags", flags(method.getModifiers()),
          "annotations", annotations(method.getModifiers()),
          "parameters", method.getParameters().stream().map(p -> rawType(p.getType())).toList(),
          "returns", method.getReturnType() == null ? "" : rawType(method.getReturnType()),
          "throwsTypes", method.getThrows().stream().map(Object::toString).toList()));
      } else if (member instanceof VariableTree variable && variable.getInitializer() != null &&
        (isInterface || (variable.getModifiers().getFlags().contains(Modifier.STATIC) &&
          variable.getModifiers().getFlags().contains(Modifier.FINAL)))) {
        constants.put(variable.getName().toString(), expression(variable.getInitializer()));
      }
    }
    long offset = trees.getSourcePositions().getStartPosition(unit, type);
    List<String> parents = new ArrayList<>();
    if (type.getExtendsClause() != null) parents.add(rawType(type.getExtendsClause()));
    for (Tree parent : type.getImplementsClause()) parents.add(rawType(parent));
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("name", name);
    result.put("simple", simple);
    result.put("packageName", unit.getPackageName() == null ? "" : unit.getPackageName().toString());
    result.put("path", Path.of(unit.getSourceFile().toUri()).toString());
    result.put("line", unit.getLineMap().getLineNumber(offset));
    result.put("flags", typeFlags);
    result.put("accessible", accessible);
    result.put("nested", !enclosing.equals(result.get("packageName")));
    result.put("kind", type.getKind().toString());
    result.put("parents", parents);
    result.put("generic", !type.getTypeParameters().isEmpty() || type.getExtendsClause() instanceof ParameterizedTypeTree || type.getImplementsClause().stream().anyMatch(parent -> parent instanceof ParameterizedTypeTree));
    result.put("annotations", annotations(type.getModifiers()));
    result.put("imports", unit.getImports().stream().filter(i -> !i.isStatic()).map(i -> i.getQualifiedIdentifier().toString()).toList());
    result.put("staticImports", unit.getImports().stream().filter(ImportTree::isStatic).map(i -> i.getQualifiedIdentifier().toString()).toList());
    result.put("methods", methods);
    result.put("constants", constants);
    types.add(result);
    for (Tree member : type.getMembers()) {
      if (member instanceof ClassTree nested) scanType(nested, unit, name, accessible, isInterface);
    }
  }

  static String json(Object value) {
    if (value == null) return "null";
    if (value instanceof Boolean || value instanceof Number) return value.toString();
    if (value instanceof Map<?, ?> map) {
      List<String> fields = new ArrayList<>();
      for (var entry : map.entrySet()) fields.add(json(entry.getKey().toString()) + ":" + json(entry.getValue()));
      return "{" + String.join(",", fields) + "}";
    }
    if (value instanceof Iterable<?> items) {
      List<String> elements = new ArrayList<>();
      for (Object item : items) elements.add(json(item));
      return "[" + String.join(",", elements) + "]";
    }
    StringBuilder text = new StringBuilder("\"");
    for (char character : value.toString().toCharArray()) {
      switch (character) {
        case '"': text.append("\\\""); break;
        case '\\': text.append("\\\\"); break;
        case '\n': text.append("\\n"); break;
        case '\r': text.append("\\r"); break;
        case '\t': text.append("\\t"); break;
        default:
          if (character < 32) text.append(String.format("\\u%04x", (int) character));
          else text.append(character);
      }
    }
    return text.append('"').toString();
  }

  static Element child(Element parent, String name) {
    for (Node node = parent.getFirstChild(); node != null; node = node.getNextSibling())
      if (node instanceof Element element && element.getTagName().equals(name)) return element;
    return null;
  }

  static String text(Element parent, String name, String fallback) {
    if (parent == null) return fallback;
    Element element = child(parent, name);
    return element == null ? fallback : element.getTextContent().trim();
  }

  static Map<String, Object> maven(String path) throws Exception {
    DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
    factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
    factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
    factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
    factory.setXIncludeAware(false);
    factory.setExpandEntityReferences(false);
    Element project = factory.newDocumentBuilder().parse(Path.of(path).toFile()).getDocumentElement();
    Element build = child(project, "build");
    Map<String, String> properties = new LinkedHashMap<>();
    Element values = child(project, "properties");
    if (values != null) for (Node node = values.getFirstChild(); node != null; node = node.getNextSibling())
      if (node instanceof Element value) properties.put(value.getTagName(), value.getTextContent().trim());
    properties.put("project.build.directory", text(build, "directory", "target"));
    properties.put("project.basedir", ".");
    properties.put("basedir", ".");
    return Map.of("properties", properties, "outputDirectory", text(build, "outputDirectory", "${project.build.directory}/classes"),
      "parent", child(project, "parent") != null, "profiles", child(project, "profiles") != null,
      "packaging", text(project, "packaging", "jar"));
  }

  public static void main(String[] args) throws Exception {
    JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
    if (compiler == null) throw new IllegalStateException("Static Java analysis requires a JDK, not a JRE");
    DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
    try (StandardJavaFileManager files = compiler.getStandardFileManager(diagnostics, null, StandardCharsets.UTF_8)) {
      List<String> paths = Files.readAllLines(Path.of(args[0]), StandardCharsets.UTF_8);
      JavacTask task = (JavacTask) compiler.getTask(null, files, diagnostics,
        List.of("-proc:none", "-encoding", "UTF-8"), null, files.getJavaFileObjectsFromStrings(paths));
      trees = Trees.instance(task);
      for (CompilationUnitTree unit : task.parse()) {
        String packageName = unit.getPackageName() == null ? "" : unit.getPackageName().toString();
        for (Tree declaration : unit.getTypeDecls())
          if (declaration instanceof ClassTree type) scanType(type, unit, packageName, true, false);
      }
      List<Object> messages = new ArrayList<>();
      for (var diagnostic : diagnostics.getDiagnostics()) {
        messages.add(Map.of("message", diagnostic.getMessage(Locale.ROOT),
          "path", diagnostic.getSource() == null ? "" : Path.of(diagnostic.getSource().toUri()).toString(),
          "line", diagnostic.getLineNumber(), "error", diagnostic.getKind() == Diagnostic.Kind.ERROR));
      }
      Map<String, Object> result = new LinkedHashMap<>();
      result.put("types", types);
      result.put("diagnostics", messages);
      if (args.length > 1) result.put("maven", maven(args[1]));
      System.out.println(json(result));
    }
  }
}
