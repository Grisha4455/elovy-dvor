export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string) => new AppError(400, code, message);
export const notFound = (message = "Не найдено") => new AppError(404, "not_found", message);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
