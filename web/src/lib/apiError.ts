/** Fehler mit HTTP-Status, damit die UI z. B. 404 oder 409 gezielt behandeln kann. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
