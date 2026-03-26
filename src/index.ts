/**
 * Soporte para Stage 3 Decorators Metadata.
 * Garantiza que Symbol.metadata exista en el entorno de ejecución (Bun/Node/V8).
 */
if ((Symbol as any).metadata === undefined) {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}

// ----------------------------------------------
// Core & Bootstrap
// ----------------------------------------------
export { FastifyKit, type FastifyKitOptions } from "./core/FastifyKit.js";
export { Module } from "./core/module.decorator.js";
export { discoverControllers, discoverModules } from "./http/routing/discovery.js";
export type { ModuleOptions } from "./http/decorators/types.js";
export type { AutoDiscoverOptions } from "./http/routing/discovery.js";
export type { Constructor } from "./http/routing/scanner.js";

// ----------------------------------------------
// HTTP Routing & Controllers
// ----------------------------------------------
export { Controller } from "./http/decorators/controller.js";
export { Get, Post, Put, Patch, Delete } from "./http/decorators/methods.js";
export { Version } from "./http/decorators/version.js"; // Decorador para definir versiones de API a nivel de clase o método
export {
  UseParams, // Decorador para definir qué parámetros queremos inyectar en cada método de nuestros controladores
  Body,
  Query,
  Param,
  Headers,
  Req,
  Res,
  Ip,
} from "./http/decorators/parameters.js";

// ----------------------------------------------
// HTTP Security & Guards
// ----------------------------------------------
export { UseGuards } from "./http/decorators/guards.js";
export { RateLimit } from "./http/decorators/rate-limit.js";
export type { CanActivate } from "./http/guards/CanActivate.js";
export type { RateLimitOptions } from "./http/decorators/types.js";

// ----------------------------------------------
// HTTP Responses & Exceptions
// ----------------------------------------------
export { createApiResponseSchema } from "./http/responses/api-response.schema.js";
export { ApiResponse } from "./http/responses/ApiResponse.js";
export { ApiError } from "./http/responses/ApiError.js";
export * from "./http/exceptions/index.js"; // Exporta todos los ErrorCodes y Excepciones (NotFound, Validation, etc.)

// ----------------------------------------------
// Execution Context (AsyncLocalStorage)
// ----------------------------------------------
export { AlsStore } from "./http/context/AlsStore.js";
// Exportamos la instancia global por si el usuario necesita acceder al requestId manualmente
export { requestContext } from "./http/context/requestContext.js";

// ----------------------------------------------
// Dependency Injection (IoC)
// ----------------------------------------------
export { container, type Contract } from "./container/DIContainer.js";
export { Injectable } from "./container/injectable.decorator.js";
export { Inject } from "./container/inject.decorator.js";

// ----------------------------------------------
// Data & Mapping
// ----------------------------------------------
export { MapTo } from "./utils/map-to.decorator.js";
export { Mapper } from "./utils/Mapper.js";
export type { PipeTransform } from "./http/pipes/PipeTransform.js"; // El contrato de transformación

// ----------------------------------------------
// Caching (AOP)
// ----------------------------------------------
export { Cache, ClearCache } from "./cache/cache.decorator.js";
export { CacheManager } from "./cache/CacheManager.js";

// ----------------------------------------------
// Database & Transactions (Agnostic)
// ----------------------------------------------
export {
  Transactional,
  TRANSACTION_MANAGER_TOKEN,
} from "./database/transactions.js";
export { createTransactionProxy } from "./database/proxy.js";
export type { ITransactionManager } from "./database/transactions.js";

// ----------------------------------------------
// Observability & Logging
// ----------------------------------------------
export { Benchmark } from "./logger/benchmark.decorator.js";
export {
  LOGGER_TOKEN,
  type LoggerContract,
  DefaultConsoleLogger,
} from "./logger/LoggerContract.js";
export { getLogger } from "./logger/logger.factory.js";

// ----------------------------------------------
// Resilience & Fault Tolerance
// ----------------------------------------------
export { Retry } from "./resilience/retry.decorator.js";
export { Timeout } from "./resilience/timeout.decorator.js";
export { CircuitBreaker } from "./resilience/circuit-breaker.decorator.js";

// ----------------------------------------------
// Event Bus (Pub / Sub)
// ----------------------------------------------
export { OnEvent } from "./events/on-event.decorator.js";
export { OnceEvent } from "./events/once-event.decorator.js";
export {
  EVENT_BUS_TOKEN,
  type EventBusContract,
  DefaultEventBus,
} from "./events/EventBus.js";
export { getEventBus } from "./events/eventbus.factory.js";

// ----------------------------------------------
// Scheduling & Background Tasks
// ----------------------------------------------
export { Scheduled, CronExpression } from "./scheduling/scheduled.decorator.js";

// ----------------------------------------------
// Configuration Management
// ----------------------------------------------
export { ConfigRegistry } from "./config/ConfigRegistry.js";
export { InjectConfig } from "./config/inject-config.decorator.js";

// ----------------------------------------------
// Validation (TypeBox)
// ----------------------------------------------
export { Validate } from "./validation/validate.decorator.js";
