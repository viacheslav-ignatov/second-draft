/**
 * Error shapes.
 *
 * Everything thrown by the built-in AI APIs arrives as `unknown`, and some of it
 * is not an `Error` at all, so the message is extracted once here rather than
 * cast at each call site.
 */

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "Unknown error";
}

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}
