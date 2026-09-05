import type {
  CacheMetrics,
  CacheRedisState,
} from "../interfaces/CacheMetrics.js";

/**
 * Circuit breaker pequeño y específico de la dependencia Redis de caché.
 * No reutiliza el decorador público: su estado pertenece a una conexión/servicio
 * de caché y necesita un único sondeo concurrente en estado semiabierto.
 */
export class CacheRedisCircuit {
  private state: CacheRedisState = "healthy";
  private failures = 0;
  private retryAt = 0;
  private probeInFlight = false;

  constructor(
    private readonly failureThreshold: number,
    private readonly recoveryTimeoutMs: number,
    private readonly metrics?: CacheMetrics,
  ) {
    this.metrics?.onRedisState?.("healthy");
  }

  get currentState(): CacheRedisState {
    return this.state;
  }

  /**
   * Devuelve true si la operación puede intentar Redis. En half-open solo
   * una operación atraviesa el circuito; el resto debe ejecutar fallback.
   */
  allowRequest(now: number = Date.now()): boolean {
    if (this.state === "healthy") return true;
    if (this.state === "half_open") return false;
    if (now < this.retryAt || this.probeInFlight) return false;

    this.state = "half_open";
    this.probeInFlight = true;
    this.metrics?.onRedisState?.("half_open");
    return true;
  }

  recordSuccess(): void {
    const changed = this.state !== "healthy";
    this.state = "healthy";
    this.failures = 0;
    this.retryAt = 0;
    this.probeInFlight = false;
    if (changed) this.metrics?.onRedisState?.("healthy");
  }

  recordFailure(): void {
    this.probeInFlight = false;
    this.failures++;
    if (this.failures >= this.failureThreshold || this.state === "half_open") {
      this.state = "degraded";
      this.retryAt = Date.now() + this.recoveryTimeoutMs;
      this.metrics?.onRedisState?.("degraded");
    }
  }
}
