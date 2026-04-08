import { Injectable } from "../container/injectable.decorator.js";
import { HealthCheckError } from "./HealthCheckError.js";
import type { HealthCheckResult, HealthIndicatorResult } from "./interfaces.js";

/**
 * @description Servicio centralizado para orquestar múltiples comprobaciones de salud.
 * Utiliza Promise.allSettled para evaluar de forma concurrente todas las dependencias vitales.
 */
@Injectable()
export class HealthCheckService {
  /**
   * @description Ejecuta una serie de indicadores de salud.
   * @param indicators Array de promesas o funciones asíncronas que retornan HealthIndicatorResult.
   * @throws {HealthCheckError} Si uno o más indicadores fallan (HTTP 503).
   * @returns {Promise<HealthCheckResult>} El reporte completo (HTTP 200) si pasa exitosamente.
   */
  async check(
    indicators: (() => Promise<HealthIndicatorResult>)[],
  ): Promise<HealthCheckResult> {
    // Ejecutamos todas las promesas de los indicadores de salud de
    // forma concurrente y esperamos a que todas se resuelvan o rechacen
    const results = await Promise.allSettled(
      indicators.map((indicator) => indicator()),
    );

    // Inicializamos los diccionarios para clasificar los resultados y el flag de error
    const info: HealthIndicatorResult = {};
    const error: HealthIndicatorResult = {};
    const details: HealthIndicatorResult = {};
    let hasErrors = false;

    // Iteramos sobre los resultados para clasificarlos en
    // 'info' o 'error' y construir el reporte completo en 'details'
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      hasErrors =
        result.status === "fulfilled" // Si se resolvió exitosamente, manejamos el resultado para clasificarlo
          ? this.handleFulfilledResult(result.value, info, error, details) ||
            hasErrors // Si ya había errores previos, mantenemos el estado de error global
          : this.handleRejectedResult(result, i, error, details) || hasErrors;
    }

    // Armamos el reporte final
    const healthResult = this.buildHealthResult(
      hasErrors,
      info,
      error,
      details,
    );

    // Si hubo errores, lanzamos la excepción que atraparemos globalmente (HTTP 503)
    if (hasErrors) {
      throw new HealthCheckError("Unhealthy Service", healthResult);
    }

    // Si está bien, retornamos el reporte (HTTP 200)
    return healthResult;
  }

  /**
   * @description Maneja los casos donde la promesa del indicador se resolvió exitosamente,
   * pero el estado del indicador puede ser 'up' o 'down'. Clasifica cada indicador en
   * 'info' o 'error' según su estado y construye el diccionario combinado de 'details'.
   * @param value El resultado de la promesa resuelta, que debe ser un HealthIndicatorResult.
   * @param info El diccionario donde se registran los indicadores que pasaron exitosamente.
   * @param error El diccionario donde se registran los indicadores que fallaron.
   * @param details El diccionario combinado de todos los indicadores para una vista completa.
   * @returns {boolean} Retorna true si hubo errores, afectando el estado global del reporte.
   */
  private handleFulfilledResult(
    value: HealthIndicatorResult,
    info: HealthIndicatorResult,
    error: HealthIndicatorResult,
    details: HealthIndicatorResult,
  ): boolean {
    let hasErrors = false;

    // Si la promesa se resolvió exitosamente, verificamos el estado de cada indicador
    for (const [key, indicatorValue] of Object.entries(value)) {
      // Agregamos el resultado al diccionario combinado de details para tener una vista completa
      details[key] = indicatorValue;
      if (indicatorValue.status === "up") {
        // Si el indicador está 'up', lo registramos en info
        info[key] = indicatorValue;
      } else {
        // Si el indicador está 'down', lo registramos en error y marcamos que hubo un fallo
        error[key] = indicatorValue;
        hasErrors = true;
      }
    }

    // Retornamos si hubo algún error para afectar el estado global del reporte
    return hasErrors;
  }

  /**
   * @description Maneja los casos donde la promesa del indicador fue rechazada,
   * marcando ese indicador como 'down' y registrando el error.
   * @param result El resultado de la promesa rechazada.
   * @param index El índice del indicador en el array original para identificarlo en caso de error.
   * @param error El diccionario donde se registran los indicadores que fallaron.
   * @param details El diccionario combinado de todos los indicadores para una vista completa.
   * @returns {boolean} Retorna true para indicar que hubo un error, lo que afectará el estado global del reporte.
   */
  private handleRejectedResult(
    result: PromiseRejectedResult,
    index: number,
    error: HealthIndicatorResult,
    details: HealthIndicatorResult,
  ): boolean {
    // Si la promesa fue rechazada, marcamos ese indicador como 'down' y registramos el error
    const fallbackKey = `unknown_indicator_${index}`;
    const reason =
      result.reason instanceof Error
        ? result.reason.message // Si es un error, usamos su mensaje
        : String(result.reason); // Si no, convertimos la razón a string

    // Registramos el error bajo una clave genérica para no perder la información del fallo
    error[fallbackKey] = { status: "down", error: reason };
    // También lo agregamos a details para tener un reporte completo
    details[fallbackKey] = error[fallbackKey];
    return true;
  }

  /**
   * @description Construye el objeto final de HealthCheckResult a partir de los resultados individuales.
   * @param hasErrors Indica si hubo al menos un error para determinar el estado global.
   * @param info Diccionario de indicadores que pasaron exitosamente.
   * @param error Diccionario de indicadores que fallaron.
   * @param details Diccionario combinado de todos los indicadores para una vista completa.
   * @returns {HealthCheckResult} El objeto HealthCheckResult listo para ser retornado o incluido en la excepción.
   */
  private buildHealthResult(
    hasErrors: boolean,
    info: HealthIndicatorResult,
    error: HealthIndicatorResult,
    details: HealthIndicatorResult,
  ): HealthCheckResult {
    return {
      status: hasErrors ? "error" : "ok",
      info,
      error,
      details,
    };
  }
}
