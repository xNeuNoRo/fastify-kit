import { HealthIndicator } from "./HealthIndicator.js";
import type { HealthIndicatorResult } from "../interfaces.js";

export class MemoryHealthIndicator extends HealthIndicator {
  /**
   * @description Verifica que el Heap (memoria de objetos) no exceda el límite.
   * @param key Identificador (ej. "memory_heap")
   * @param maxHeapThresholdMB Límite máximo permitido en Megabytes.
   */
  async checkHeap(
    key: string,
    maxHeapThresholdMB: number,
  ): Promise<HealthIndicatorResult> {
    // Obtenemos la memoria usada en bytes y la pasamos a MB
    const heapUsedBytes = process.memoryUsage().heapUsed;
    const heapUsedMB = Math.round(heapUsedBytes / 1024 / 1024);

    const isHealthy = heapUsedMB <= maxHeapThresholdMB;

    return this.getStatus(key, isHealthy, {
      usedMB: heapUsedMB,
      maxMB: maxHeapThresholdMB,
      error: isHealthy
        ? undefined
        : `Heap limit exceeded (${heapUsedMB}MB > ${maxHeapThresholdMB}MB)`,
    });
  }

  /**
   * @description Verifica que el RSS (memoria total del proceso) no exceda el límite.
   * @param key Identificador (ej. "memory_rss")
   * @param maxRssThresholdMB Límite máximo permitido en Megabytes.
   */
  async checkRSS(
    key: string,
    maxRssThresholdMB: number,
  ): Promise<HealthIndicatorResult> {
    const rssBytes = process.memoryUsage().rss;
    const rssMB = Math.round(rssBytes / 1024 / 1024);

    const isHealthy = rssMB <= maxRssThresholdMB;

    return this.getStatus(key, isHealthy, {
      usedMB: rssMB,
      maxMB: maxRssThresholdMB,
      error: isHealthy
        ? undefined
        : `RSS limit exceeded (${rssMB}MB > ${maxRssThresholdMB}MB)`,
    });
  }
}
