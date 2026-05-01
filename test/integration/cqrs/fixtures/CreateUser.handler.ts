import { Injectable } from "../../../../src/container/injectable.decorator.js";
import { CommandHandler } from "../../../../src/cqrs/decorators/handler.decorators.js";
import type { IRequestHandler } from "../../../../src/cqrs/interfaces/request.interface.js";
import { CreateUserCommand } from "./CreateUser.command.js";

@Injectable()
@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements IRequestHandler<
  CreateUserCommand,
  string
> {
  public async handle(command: CreateUserCommand): Promise<string> {
    // Simulamos lógica de negocio
    return `User ${command.name} created successfully`;
  }
}
