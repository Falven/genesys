export function registrationCollisions<T>(
  definitions: readonly T[],
  identity: (definition: T) => string | undefined,
): { definition: T; previous: T }[] {
  const seen = new Map<string, T>();
  const collisions: { definition: T; previous: T }[] = [];
  for (const definition of definitions) {
    const key = identity(definition);
    if (key === undefined) continue;
    const previous = seen.get(key);
    if (previous !== undefined) collisions.push({ definition, previous });
    seen.set(key, definition);
  }
  return collisions;
}
