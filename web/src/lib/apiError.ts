// Custom error class (extends Error like in Java). `readonly status` in the constructor declares and assigns a field.
/** Error with an HTTP status so the UI can handle e.g. 404 or 409 specifically. */
export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}
