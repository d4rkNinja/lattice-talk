/** User/input mistake — tools return this as isError, they do not crash the process. */
export class UserError extends Error {
  readonly code: string;

  constructor(message: string, code = "user_error") {
    super(message);
    this.name = "UserError";
    this.code = code;
  }
}

export function isUserError(err: unknown): err is UserError {
  return err instanceof UserError;
}
