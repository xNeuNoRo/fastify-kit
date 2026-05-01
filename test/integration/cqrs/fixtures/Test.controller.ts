import { Controller } from "../../../../src/http/decorators/controller.js";
import { Post } from "../../../../src/http/decorators/methods.js";
import { Inject } from "../../../../src/container/inject.decorator.js";
import { Mediator } from "../../../../src/cqrs/Mediator.js";
import { CreateUserCommand } from "./CreateUser.command.js";
import type { FastifyRequest } from "fastify";

@Controller("/test-cqrs")
export class TestCqrsController {
  @Inject(Mediator)
  private readonly mediator!: Mediator;

  @Post()
  public async create(request: FastifyRequest<{ Body: { name: string } }>) {
    const command = new CreateUserCommand(request.body.name);
    // Ejecutamos el mediator
    const result = await this.mediator.send(command);
    return { result };
  }
}
