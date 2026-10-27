export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function badRequest(message: string): AppError {
  return new AppError(400, "VALIDATION_ERROR", message);
}

export function unauthorized(): AppError {
  return new AppError(401, "UNAUTHORIZED", "Authentication is required");
}

export function forbidden(): AppError {
  return new AppError(
    403,
    "FORBIDDEN",
    "You are not allowed to perform this action",
  );
}

export function notFound(): AppError {
  return new AppError(404, "NOT_FOUND", "Resource not found");
}

export function conflict(message: string): AppError {
  return new AppError(409, "CONFLICT", message);
}
