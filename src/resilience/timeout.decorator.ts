/**
 * @description Función auxiliar para crear una promesa que se rechaza después de un tiempo determinado.
 * @param ms El tiempo en milisegundos después del cual la promesa se rechazará con un error de timeout.
 * @returns Una promesa que se rechaza después de ms milisegundos con un error de timeout.
 */
function createTimeoutPromise(ms: number): Promise<never> {
  return new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`La operación excedió el tiempo límite de ${ms} ms`));
    }, ms);
  });
}

/**
 * @description Decorador de método para aplicar un timeout a la ejecución de un método de clase. Si el método decorado es asíncrono y no se resuelve dentro del tiempo especificado, se rechazará con un error de timeout.
 * @param ms El tiempo en milisegundos que se permitirá para la ejecución del método antes de que se considere un timeout.
 * @example
 * class ApiService {
 *   \@Timeout(5000) // Aplica un timeout de 5 segundos a este método
 *   async fetchData() {
 *     // Lógica para llamar a un servicio externo o base de datos
 *   }
 * }
 * @remarks Si el método decorado es síncrono, el decorador simplemente devolverá el resultado sin aplicar un timeout, ya que el código síncrono se ejecuta de manera bloqueante. Sin embargo, si el método es asíncrono (devuelve una promesa), el decorador utilizará Promise.race para aplicar el timeout, lo que significa que si la promesa no se resuelve o rechaza dentro del tiempo especificado, se rechazará automáticamente con un error de timeout.
 * @returns Una función que envuelve el método original, implementando la lógica de timeout 
 * para controlar la ejecución basada en el tiempo especificado. Si el método es asíncrono, se utilizará Promise
 */
export function Timeout(ms: number) {
  return function <This, Args extends any[], Return>(
    target: (this: This, ...args: Args) => Return,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Return
    >,
  ) {
    if (context.kind !== "method") {
      throw new Error("@Timeout solo puede ser aplicado a métodos de clase");
    }

    return function (this: This, ...args: Args): Return {
      const result = target.apply(this, args);

      if (result instanceof Promise) {
        // Creamos una promesa que se rechaza después de ms milisegundos
        const timeoutPromise = createTimeoutPromise(ms);

        // Con Promise.race garantizamos que se resuelva o rechace lo que ocurra primero: el resultado de la función o el timeout
        return Promise.race([result, timeoutPromise]) as Return;
      }

      // Si la función no es asíncrona, simplemente devolvemos el resultado
      return result;
    };
  };
}
