export class ApiError<E = unknown> {
  constructor(
    public readonly code: string,
    public readonly message: string,
    public readonly details?: E,
  ) {}
}
