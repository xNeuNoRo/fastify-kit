import type { IRequest } from "../../../../src/cqrs/interfaces/request.interface.js";

export class CreateUserCommand implements IRequest<string> {
  readonly _resultType?: string;
  constructor(public readonly name: string) {}
}
