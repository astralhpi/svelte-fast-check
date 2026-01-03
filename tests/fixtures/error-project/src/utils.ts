// Type error: return type mismatch
export function add(_a: number, _b: number): number {
  return "not a number";
}

export function greet(name: string): string {
  // Type error: argument type mismatch
  return add(name, name);
}
