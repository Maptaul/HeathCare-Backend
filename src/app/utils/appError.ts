export class AppError extends Error {
  public statusCode: number;

  constructor(statusCode: number, message: string, stack: "") {
    super(message); // throw error message to the parent class (Error)
    this.statusCode = statusCode;

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
