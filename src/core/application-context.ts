import { container } from "../container/DIContainer.js";

/** Token interno para asociar recursos globales del proceso con una aplicación. */
export const APPLICATION_CONTEXT_TOKEN = Symbol.for(
  "FastifyKitApplicationContext",
);

const resourceOwners = new WeakMap<object, object>();

export function claimApplicationResource(
  resource: object,
  resourceName: string,
): void {
  if (!container.has(APPLICATION_CONTEXT_TOKEN)) return;
  const application = container.resolve<object>(APPLICATION_CONTEXT_TOKEN);
  const owner = resourceOwners.get(resource);
  if (owner && owner !== application) {
    throw new Error(
      `[FastifyKit Lifecycle] El recurso global '${resourceName}' ya pertenece a otra aplicación. ` +
        "No se soportan dos aplicaciones FastifyKit activas en el mismo proceso.",
    );
  }
  resourceOwners.set(resource, application);
}

export function releaseApplicationResource(resource: object): void {
  resourceOwners.delete(resource);
}
