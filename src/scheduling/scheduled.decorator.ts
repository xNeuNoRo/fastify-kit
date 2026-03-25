import { FastifyKitMetadata } from "../http/decorators/types";

/**
 * @description Constantes de expresiones Cron predefinidas para facilitar la programación de tareas comunes. Estas expresiones pueden ser utilizadas al decorar métodos con \@Scheduled para definir cuándo deben ejecutarse automáticamente. Por ejemplo, si queremos que un método se ejecute cada hora, podemos usar CronExpression.EVERY_HOUR en el decorador @Scheduled.
 */
export const CronExpression = {
  EVERY_SECOND: "* * * * * *",
  EVERY_MINUTE: "* * * * *",
  EVERY_5_MINUTES: "*/5 * * * *",
  EVERY_15_MINUTES: "*/15 * * * *",
  EVERY_30_MINUTES: "*/30 * * * *",
  EVERY_HOUR: "0 * * * *",
  EVERY_DAY_AT_MIDNIGHT: "0 0 * * *",
  EVERY_DAY_AT_8AM: "0 8 * * *",
  EVERY_DAY_AT_3AM: "0 3 * * *",
  EVERY_WEEK_AT_MONDAY_8AM: "0 8 * * 1",
  EVERY_WEEK_AT_FRIDAY_5PM: "0 17 * * 5",
  MONDAY_TO_FRIDAY_AT_8AM: "0 8 * * 1-5",
} as const;

/**
 * @description Decorador de método para programar la ejecución automática de un método en base a una expresión Cron. Este decorador es útil para definir tareas programadas dentro de nuestras clases, como por ejemplo tareas de mantenimiento, envío de correos periódicos, sincronización de datos, etc. Al decorar un método con \@Scheduled y proporcionar una expresión Cron, el framework se encargará de ejecutar ese método automáticamente según el horario definido por la expresión.
 * @param cronExpression La expresión Cron que define cuándo debe ejecutarse el método decorado. Esta expresión puede ser una de las constantes predefinidas en CronExpression o una expresión personalizada que siga el formato estándar de Cron.
 * @returns Una función que envuelve el método original, registrando su información en la metadata de la clase para que el framework pueda programar su ejecución automática según la expresión Cron proporcionada.
 * @example
 * class MyService {
 *   \@Scheduled(CronExpression.EVERY_HOUR)
 *   performHourlyTask() {
 *     console.log("Esta tarea se ejecuta cada hora");
 *   }
 *
 *   \@Scheduled("0 0 * * 0") // Expresión Cron personalizada para ejecutar cada domingo a medianoche
 *   performWeeklyTask() {
 *     console.log("Esta tarea se ejecuta cada semana");
 *   }
 * }
 * @remarks El método decorado con \@Scheduled puede tener cualquier lógica interna, pero no debe depender de parámetros de entrada, ya que se ejecutará automáticamente sin recibir argumentos. Además, es importante tener en cuenta que el framework debe estar configurado para manejar la programación de tareas basadas en Cron para que este decorador funcione correctamente.
 */
export function Scheduled(cronExpression: string) {
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    if (context.kind !== "method") {
      throw new Error("@Scheduled solo puede aplicarse a métodos de clase.");
    }

    // Extendemos la metadata del decorador para incluir información sobre las tareas programadas.
    const metadata = context.metadata as FastifyKitMetadata;
    metadata.scheduledTasks = metadata.scheduledTasks || [];

    // Guardamos el nombre del método y cuándo debe ejecutarse
    metadata.scheduledTasks.push({
      methodName: context.name,
      cronExpression,
    });
  };
}
