/**
 * @description Símbolo único para acceder a la metadata de los decoradores de Stage 3.
 */
export const FASTIFY_KIT_METADATA_SYMBOL: symbol =
  (Symbol as any).metadata ?? Symbol.for("Symbol.metadata");

// Polyfill global para entornos que no lo tengan nativo (como Node < 23)
if ((Symbol as any).metadata === undefined) {
  (Symbol as any).metadata = FASTIFY_KIT_METADATA_SYMBOL;
}
