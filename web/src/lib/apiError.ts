/** Error with an HTTP status so the UI can handle e.g. 404 or 409 specifically. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
