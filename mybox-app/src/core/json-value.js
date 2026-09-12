/** Compare JSON values without treating object property order as content. Array order matters. */
export function jsonValueEqual(left, right) {
  const ordered = (_, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value;
  return JSON.stringify(left, ordered) === JSON.stringify(right, ordered);
}
