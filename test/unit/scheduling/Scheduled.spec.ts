import { describe, it, expect } from "vitest";

import type { FastifyKitMetadata } from "../../../src/http/decorators/types.js";
import {
  Scheduled,
  CronExpression,
} from "../../../src/scheduling/scheduled.decorator.js";

// Aseguramos que Symbol.metadata esté definido para que el decorador pueda inyectar los metadatos correctamente durante las pruebas.
if (!(Symbol as any).metadata) {
  (Symbol as any).metadata = Symbol.for("Symbol.metadata");
}

describe("Sistema de Tareas Programadas (@Scheduled & CronExpression)", () => {
  describe("CronExpression Constants", () => {
    it("Debería contener las expresiones Cron predefinidas correctamente formadas", () => {
      // Validamos que los strings tengan el formato clásico de cron
      expect(CronExpression.EVERY_SECOND).toBe("* * * * * *");
      expect(CronExpression.EVERY_MINUTE).toBe("* * * * *");
      expect(CronExpression.EVERY_5_MINUTES).toBe("*/5 * * * *");
      expect(CronExpression.EVERY_15_MINUTES).toBe("*/15 * * * *");
      expect(CronExpression.EVERY_30_MINUTES).toBe("*/30 * * * *");
      expect(CronExpression.EVERY_HOUR).toBe("0 * * * *");
      expect(CronExpression.EVERY_DAY_AT_MIDNIGHT).toBe("0 0 * * *");
      expect(CronExpression.EVERY_DAY_AT_8AM).toBe("0 8 * * *");
      expect(CronExpression.EVERY_DAY_AT_3AM).toBe("0 3 * * *");
      expect(CronExpression.EVERY_WEEK_AT_MONDAY_8AM).toBe("0 8 * * 1");
      expect(CronExpression.EVERY_WEEK_AT_FRIDAY_5PM).toBe("0 17 * * 5");
      expect(CronExpression.MONDAY_TO_FRIDAY_AT_8AM).toBe("0 8 * * 1-5");
    });
  });

  describe("Decorador @Scheduled (Inyección de Metadatos)", () => {
    it("Debería inyectar la configuración de la tarea en los metadatos de la clase (Symbol.metadata)", () => {
      // Creamos una clase dummy y le aplicamos el decorador a varios métodos
      class BackgroundJobs {
        @Scheduled(CronExpression.EVERY_HOUR)
        limpiarCache() {
          return true;
        }

        @Scheduled("*/10 * * * *") // Cron personalizado
        sincronizarBaseDeDatos() {
          return true;
        }
      }

      // Obtenemos los metadatos inyectados por el decorador
      const metadata = (BackgroundJobs as any)[
        (Symbol as any).metadata
      ] as FastifyKitMetadata;

      expect(metadata).toBeDefined();
      expect(metadata.scheduledTasks).toBeDefined();
      expect(Array.isArray(metadata.scheduledTasks)).toBe(true);
      expect(metadata.scheduledTasks).toHaveLength(2);

      // Validamos que el primer método se registró con el cron predefinido correctamente
      expect(metadata.scheduledTasks![0]).toEqual({
        methodName: "limpiarCache",
        cronExpression: CronExpression.EVERY_HOUR,
      });

      // Validamos que el segundo método se registró con el cron personalizado correctamente
      expect(metadata.scheduledTasks![1]).toEqual({
        methodName: "sincronizarBaseDeDatos",
        cronExpression: "*/10 * * * *",
      });
    });

    it("Debería crear el array scheduledTasks si no existe, o añadir a uno existente", () => {
      // Simulamos un obj de metadata vacío para probar que el decorador crea el array si no existe, o lo extiende si ya existe
      const fakeMetadata: any = {};

      const decorator1 = Scheduled(CronExpression.EVERY_MINUTE);
      decorator1(() => {}, {
        kind: "method",
        name: "task1",
        metadata: fakeMetadata,
      } as any);

      const decorator2 = Scheduled(CronExpression.EVERY_HOUR);
      decorator2(() => {}, {
        kind: "method",
        name: "task2",
        metadata: fakeMetadata,
      } as any);

      // El array no debería haberse sobrescrito, sino que debería tener ambas tareas
      expect(fakeMetadata.scheduledTasks).toBeDefined();
      expect(fakeMetadata.scheduledTasks).toHaveLength(2);
      expect(fakeMetadata.scheduledTasks[0].methodName).toBe("task1");
      expect(fakeMetadata.scheduledTasks[1].methodName).toBe("task2");
    });
  });

  describe("Protección del Decorador", () => {
    it("Debería lanzar un error si @Scheduled se aplica a algo que no es un método (ej. un campo)", () => {
      expect(() => {
        class InvalidUsage {
          declare public dummy: unknown;

          constructor() {
            const scheduledFn = Scheduled(CronExpression.EVERY_DAY_AT_MIDNIGHT);
            // Simulamos aplicarlo a una propiedad de clase (kind: "field")
            scheduledFn(
              undefined as any,
              {
                kind: "field",
                name: "badProperty",
              } as any,
            );
          }
        }
        new InvalidUsage();
      }).toThrow();
    });
  });
});
