import { describe, it, expect, vi } from "vitest";

import type { MetricsService } from "../../../src/observability/contracts/MetricsService.js";
import {
  buildCacheMetrics,
  CACHE_METRICS_NAMES,
} from "../../../src/observability/instrumentations/cache.instrumentation.js";

function makeMetricsServiceMock() {
  return {
    increment: vi.fn(),
    histogram: vi.fn(),
  };
}

describe("Instrumentación de métricas de caché (buildCacheMetrics)", () => {
  it("Debería mapear lecturas a cache_read_total con el evento como label", () => {
    const metricsService = makeMetricsServiceMock();
    const cacheMetrics = buildCacheMetrics(
      metricsService as unknown as MetricsService,
    );

    cacheMetrics.onRead("l1_hit");
    cacheMetrics.onRead("l2_stale");
    cacheMetrics.onRead("miss");

    expect(metricsService.increment).toHaveBeenCalledWith(
      CACHE_METRICS_NAMES.reads,
      { result: "l1_hit" },
    );
    expect(metricsService.increment).toHaveBeenCalledWith(
      CACHE_METRICS_NAMES.reads,
      { result: "l2_stale" },
    );
    expect(metricsService.increment).toHaveBeenCalledWith(
      CACHE_METRICS_NAMES.reads,
      { result: "miss" },
    );
  });

  it("Debería mapear duración, locks, errores e invalidaciones", () => {
    const metricsService = makeMetricsServiceMock();
    const cacheMetrics = buildCacheMetrics(
      metricsService as unknown as MetricsService,
    );

    cacheMetrics.onLoaderDuration(0.123);
    cacheMetrics.onLockContention();
    cacheMetrics.onLoaderError();
    cacheMetrics.onInvalidationReceived();

    expect(metricsService.histogram).toHaveBeenCalledWith(
      CACHE_METRICS_NAMES.loaderDuration,
      0.123,
    );
    expect(metricsService.increment).toHaveBeenCalledWith(
      CACHE_METRICS_NAMES.lockContention,
    );
    expect(metricsService.increment).toHaveBeenCalledWith(
      CACHE_METRICS_NAMES.loaderError,
    );
    expect(metricsService.increment).toHaveBeenCalledWith(
      CACHE_METRICS_NAMES.invalidationReceived,
    );
  });

  it("Debería proteger el flujo funcional si el provider de métricas falla", () => {
    const failing = makeMetricsServiceMock();
    failing.increment = vi.fn(() => {
      throw new Error("prometheus exploded");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cacheMetrics = buildCacheMetrics(
      failing as unknown as MetricsService,
    );

    expect(() => cacheMetrics.onRead("miss")).not.toThrow();
    expect(() => cacheMetrics.onLockContention()).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("Debería mapear duración Redis con la operación como label", () => {
    const metricsService = makeMetricsServiceMock();
    const cacheMetrics = buildCacheMetrics(
      metricsService as unknown as MetricsService,
    );

    cacheMetrics.onRedisDuration?.("get", 0.012);

    expect(metricsService.histogram).toHaveBeenCalledWith(
      CACHE_METRICS_NAMES.redisDuration,
      0.012,
      { operation: "get" },
    );
  });
});
