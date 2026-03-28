import type { PipeTransform } from "../pipes/PipeTransform.js";
import type { Constructor } from "../routing/scanner.js";
import type {
  ParameterType,
  FastifyKitMetadata,
  FileOptions,
} from "./types.js";

/**
 * @description Decorador para obtener los datos del body de la solicitud
 * @param key Un dato en especifico, ejemplo: "name" para obtener solo el campo "name" del body. Si se omite, se inyectará el body.
 * @param pipe Una clase que implemente PipeTransform para transformar o validar el valor antes de inyectarlo. Ejemplo: ParseIntPipe para convertir un valor a número entero. Si se omite, no se aplicará ninguna transformación o validación adicional.
 * @returns Un objeto que define el tipo de parámetro (body), la clave opcional y el pipe opcional. Este objeto se utiliza internamente por el decorador \@UseParams para procesar la metadata de los parámetros de los métodos de controlador.
 */
export const Body = (key?: string, pipe?: Constructor<PipeTransform>) => ({
  type: "body" as ParameterType,
  key,
  pipe,
});

/**
 * @description Decorador para obtener los datos de la query de la solicitud
 * @param key Un dato en especifico, ejemplo: "id" para obtener solo el campo "id" de la query. Si se omite, se inyectará toda la query.
 * @param pipe Una clase que implemente PipeTransform para transformar o validar el valor antes de inyectarlo. Ejemplo: ParseIntPipe para convertir un valor a número entero. Si se omite, no se aplicará ninguna transformación o validación adicional.
 * @returns Un objeto que define el tipo de parámetro (query), la clave opcional y el pipe opcional. Este objeto se utiliza internamente por el decorador \@UseParams para procesar la metadata de los parámetros de los métodos de controlador.
 */
export const Query = (key?: string, pipe?: Constructor<PipeTransform>) => ({
  type: "query" as ParameterType,
  key,
  pipe,
});

/**
 * @description Decorador para obtener los datos de los parámetros de ruta (params) de la solicitud
 * @param key Un dato en especifico, ejemplo: "id" para obtener solo el campo "id" de los params. Si se omite, se inyectarán todos los params.
 * @param pipe Una clase que implemente PipeTransform para transformar o validar el valor antes de inyectarlo. Ejemplo: ParseIntPipe para convertir un valor a número entero. Si se omite, no se aplicará ninguna transformación o validación adicional.
 * @returns Un objeto que define el tipo de parámetro (param), la clave opcional y el pipe opcional. Este objeto se utiliza internamente por el decorador \@UseParams para procesar la metadata de los parámetros de los métodos de controlador.
 */
export const Param = (key?: string, pipe?: Constructor<PipeTransform>) => ({
  type: "param" as ParameterType,
  key,
  pipe,
});

/**
 * @description Decorador para obtener los datos de los headers de la solicitud
 * @param key Un header en especifico, ejemplo: "authorization" para obtener solo el header "authorization". Si se omite, se inyectarán todos los headers.
 * @param pipe Una clase que implemente PipeTransform para transformar o validar el valor antes de inyectarlo. Ejemplo: ParseIntPipe para convertir un valor a número entero. Si se omite, no se aplicará ninguna transformación o validación adicional.
 * @returns Un objeto que define el tipo de parámetro (headers), la clave opcional y el pipe opcional. Este objeto se utiliza internamente por el decorador \@UseParams para procesar la metadata de los parámetros de los métodos de controlador.
 */
export const Headers = (key?: string, pipe?: Constructor<PipeTransform>) => ({
  type: "headers" as ParameterType,
  key,
  pipe,
});

/**
 * @description Decorador para obtener el objeto de solicitud (request) completo. Este decorador se utiliza por el decorador \@UseParams para inyectar el objeto FastifyRequest directamente en un método de controlador.
 * @returns Un objeto que define el tipo de parámetro (request). Este objeto se utiliza internamente por el decorador \@UseParams para procesar la metadata de los parámetros de los métodos de controlador.
 */
export const Req = () => ({ type: "request" as ParameterType });

/**
 * @description Decorador para obtener el objeto de respuesta (reply) completo. Este decorador se utiliza por el decorador \@UseParams para inyectar el objeto FastifyReply directamente en un método de controlador.
 * @returns Un objeto que define el tipo de parámetro (reply). Este objeto se utiliza internamente por el decorador \@UseParams para procesar la metadata de los parámetros de los métodos de controlador.
 */
export const Res = () => ({ type: "reply" as ParameterType });

/**
 * @description Decorador para obtener la dirección IP del cliente que realiza la solicitud. Este decorador se utiliza por el decorador \@UseParams para inyectar la IP directamente en un método de controlador.
 * @returns Un objeto que define el tipo de parámetro (ip). Este objeto se utiliza internamente por el decorador \@UseParams para procesar la metadata de los parámetros de los métodos de controlador.
 */
export const Ip = () => ({ type: "ip" as ParameterType });

/**
 * @description Decorador para manejar la carga de archivos en los métodos de controlador. Este decorador se utiliza por el decorador \@UseParams para procesar la metadata de los parámetros relacionados con archivos, incluyendo opciones como el tamaño máximo permitido, los tipos MIME aceptados y el modo de entrega (buffer o stream).
 * @param key Un dato en especifico, ejemplo: "avatar" para obtener solo el campo "avatar" del body multipart. Si se omite, se inyectará el body multipart.
 * @param options Un objeto de opciones para configurar el manejo de archivos, incluyendo maxSize (tamaño máximo en bytes), mimetypes (tipos MIME permitidos) y mode (modo de entrega: 'buffer' o 'stream').
 * @returns Un objeto que define el tipo de parámetro (file), la clave opcional y las opciones de configuración para el manejo de archivos. Este objeto se utiliza internamente por el decorador \@UseParams para procesar la metadata de los parámetros relacionados con archivos en los métodos de controlador.
 */
export const File = (key?: string, fileOptions?: FileOptions) => ({
  type: "file" as ParameterType,
  key,
  fileOptions,
});

/**
 * @description Decorador para obtener los datos de las cookies de la solicitud
 * @param key Una cookie en especifico, ejemplo: "sessionId" para obtener solo la cookie "sessionId". Si se omite, se inyectarán todas las cookies.
 * @param pipe Una clase que implemente PipeTransform para transformar o validar el valor antes de inyectarlo. Ejemplo: ParseIntPipe para convertir un valor a número entero. Si se omite, no se aplicará ninguna transformación o validación adicional.
 * @returns Un objeto que define el tipo de parámetro (cookie), la clave opcional y el pipe opcional. Este objeto se utiliza internamente por el decorador \@UseParams para procesar la metadata de los parámetros de los métodos de controlador relacionados con cookies.
 */
export const Cookie = (key?: string, pipe?: Constructor<PipeTransform>) => ({
  type: "cookie" as ParameterType,
  key,
  pipe,
});

/**
 * @description Decorador para definir los parámetros que se deben inyectar en un método de controlador. Este decorador procesa un array de definiciones de parámetros, cada una con su tipo (body, query, param, etc.), una clave opcional para identificar qué parte de los datos se debe inyectar, y una referencia opcional a un PipeTransform para transformar o validar el valor antes de inyectarlo. La metadata resultante se almacena en la metadata del método decorado, mapeada por el nombre del método.
 * @param params Un array de objetos que definen los parámetros a inyectar, cada uno con su tipo, clave opcional y pipe opcional. Por ejemplo: [{ type: "body", key: "name" }, { type: "query", key: "age", pipe: ParseIntPipe }]
 * @returns Un decorador de método que procesa la metadata de los parámetros y la almacena para su uso posterior en el proceso de resolución de dependencias y manejo de solicitudes.
 * @example
 * \@UseParams(
 *   Body("name"),
 *   Query("age", ParseIntPipe),
 *   Param("id"),
 *   Headers("authorization"),
 *   Req(),
 *   Res(),
 *   Ip(),
 * )
 * async myControllerMethod(name: string, age: number, id: string, authHeader: string, request: FastifyRequest, reply: FastifyReply, ip: string) {
 *   // Aquí puedes usar los parámetros inyectados directamente en tu método de controlador.
 * }
 */
export function UseParams(
  ...params: {
    type: ParameterType;
    key?: string;
    pipe?: Constructor<PipeTransform>;
    fileOptions?: FileOptions;
  }[]
) {
  return function (_target: any, context: ClassMethodDecoratorContext) {
    // ! OJO: Si en el futuro TS implementa para usar decoradores como parametros de funciones,
    // ! lo ideal seria que este decorador ni exista, ya que seria mucho mas intuitivo usar los decoradores
    // ! de parámetros directamente en los argumentos del método, sin necesidad de un decorador adicional para procesarlos.

    // Validamos que el decorador se aplique solo a métodos de clase
    if (context.kind !== "method") {
      throw new Error(
        "[FastifyKit] @UseParams solo puede aplicarse a métodos.",
      );
    }

    // Obtenemos o inicializamos la metadata personalizada de FastifyKit para este método.
    const metadata = context.metadata as FastifyKitMetadata;
    metadata.parameters ??= {};

    // Mapeamos el array para inyectarles el "index" basado en su posición.
    // Esto hace que tu scanner.ts siga funcionando mágicamente sin cambiarle nada.
    metadata.parameters[context.name] = params.map((param, index) => ({
      index, // 0 para el primer argumento, 1 para el segundo, etc.
      type: param.type,
      key: param.key,
      pipe: param.pipe,
      fileOptions: param.fileOptions,
    }));
  };
}
