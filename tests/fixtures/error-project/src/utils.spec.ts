// Test file with type error
import { add } from "./utils";

// Type error: argument type mismatch - passing string to number parameter
const result: number = add("hello", "world");

export { result };
