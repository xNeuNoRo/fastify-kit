import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyStatic, {
  SetHeadersResponse,
  type FastifyStaticOptions,
} from "@fastify/static";
import { ForbiddenException } from "../../../exceptions/SecurityExceptions.js";
import { StaticFile } from "../../../responses/StaticFile.js";
import type { StaticAssetsOptions } from "../../../interfaces/static.interface.js";
import { renderDirectoryHtml } from "./static.template.js";
import { NotFoundException } from "../../../exceptions/ResourceExceptions.js";

/**
 * @description Maneja la respuesta de un archivo estático, aplicando opciones como fallback y descarga forzada.
 */
export async function handleStaticFileResponse(
  result: StaticFile,
  reply: FastifyReply,
) {
  let targetFile = result.filename;

  // Si se ha configurado una ruta de fallback,
  // verificamos si el archivo solicitado existe.
  if (result.options.fallback) {
    const fullPath = path.join(result.options.root, targetFile);
    try {
      await fs.promises.access(fullPath, fs.constants.F_OK);
    } catch {
      // Si la promesa es rechazada (ej. código de error ENOENT), el archivo no existe.
      targetFile = result.options.fallback;
    }
  }

  // Si se configura como descarga forzada, inyectamos el header correspondiente.
  if (result.options.attachment) {
    const rawName = result.options.customName || targetFile;

    // Sanitizamos el nombre para evitar problemas con caracteres especiales o intentos de inyección.
    const sanitizedName = rawName
      .replaceAll(/[\r\n]/g, "")
      .replaceAll('"', String.raw`\"`);

    reply.header(
      "Content-Disposition",
      `attachment; filename="${sanitizedName}"`,
    );
  }

  return reply.sendFile(targetFile, result.options.root);
}

/**
 * @description Registra el plugin de archivos estáticos en la instancia de Fastify,
 * aplicando opciones avanzadas como validación de referers, compresión y seguridad.
 * @param app Instancia de Fastify donde se registrará el plugin.
 * @param staticOptions Opciones avanzadas para la configuración de archivos estáticos.
 * @param prefix Prefijo de ruta para servir los archivos estáticos.
 * @param guardHandler Función opcional para aplicar guards personalizados a las rutas de archivos estáticos.
 * @param decorateReply Determina si se inyecta reply.sendFile globalmente (modo Core) o se encapsula dentro de un scope (modo Scanner).
 * @returns Promesa que se resuelve cuando el plugin ha sido registrado correctamente.
 */
export async function registerStaticAssetsPlugin(
  app: FastifyInstance,
  staticOptions: StaticAssetsOptions,
  prefix: string,
  guardHandler?: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<void>,
  decorateReply: boolean = false,
) {
  // Determinamos el prefijo final, dando prioridad a la opción específica del decorador sobre el valor global
  const finalPrefix = staticOptions.prefix ?? prefix;

  // Normalizamos el prefijo para asegurar que siempre termine con una barra y no tenga barras repetidas
  const targetPrefix = finalPrefix
    ? `/${finalPrefix}/`.replaceAll(/\/+/g, "/")
    : "/";

  // Configuración base para fastify-static, mapeando opciones personalizadas a las nativas
  const fastifyNativeOptions: FastifyStaticOptions = {
    root: staticOptions.root,
    prefix: decorateReply ? targetPrefix : "/", // Si es modo Scanner, el prefijo se maneja a nivel de scope
    decorateReply, // Determina si inyecta reply.sendFile globalmente o no
    schemaHide: staticOptions.hideFromDocs ?? true,
  };

  if (staticOptions.cache) {
    switch (staticOptions.cache) {
      case "aggressive":
        fastifyNativeOptions.maxAge = "365d";
        fastifyNativeOptions.immutable = true;
        break;
      case "standard":
        fastifyNativeOptions.maxAge = "30d";
        break;
      case "medium":
        fastifyNativeOptions.maxAge = "7d";
        break;
      case "short":
        fastifyNativeOptions.maxAge = "1d";
        break;
      case "none":
        fastifyNativeOptions.cacheControl = false; // Desactiva cabeceras de caché nativas
        break;
      default:
        if (typeof staticOptions.cache === "object") {
          fastifyNativeOptions.maxAge = staticOptions.cache.maxAge;
          fastifyNativeOptions.immutable = staticOptions.cache.immutable;
        }
        break;
    }
  }

  // Mapeo de opciones de comportamiento
  if (staticOptions.serveDotFiles) fastifyNativeOptions.serveDotFiles = true;
  if (staticOptions.index !== undefined)
    fastifyNativeOptions.index = staticOptions.index;

  // Mapeo de opciones avanzadas
  if (staticOptions.compress) fastifyNativeOptions.preCompressed = true;
  if (typeof staticOptions.listDirectory === "boolean") {
    fastifyNativeOptions.list = staticOptions.listDirectory;
  } else if (typeof staticOptions.listDirectory === "object") {
    const { format = "json", extendedInfo } = staticOptions.listDirectory;

    fastifyNativeOptions.list =
      format === "html"
        ? {
            format: "html",
            extendedFolderInfo: extendedInfo,
            render: renderDirectoryHtml,
          }
        : {
            format: "json",
            extendedFolderInfo: extendedInfo,
            jsonFormat: extendedInfo ? "extended" : "names",
          };
  }

  // Mapeo de extensiones permitidas (Seguridad)
  if (staticOptions.allowedExtensions) {
    fastifyNativeOptions.allowedPath = (pathName: string) => {
      return staticOptions.allowedExtensions!.some((ext) =>
        pathName.endsWith(ext),
      );
    };
  }

  // Mapeo de headers custom y descargas forzadas
  if (
    staticOptions.forceDownload ||
    staticOptions.headers ||
    staticOptions.cache === "none"
  ) {
    fastifyNativeOptions.setHeaders = (
      res: SetHeadersResponse,
      _path: string,
      _stat: fs.Stats,
    ) => {
      if (staticOptions.cache === "none") {
        res.setHeader("Cache-Control", "no-store");
      }
      if (staticOptions.forceDownload) {
        res.setHeader("Content-Disposition", "attachment");
      }
      if (staticOptions.headers) {
        Object.entries(staticOptions.headers).forEach(([key, value]) => {
          res.setHeader(key, value);
        });
      }
    };
  }

  // Si decorateReply es true (modo Core Global), lo registramos directamente en la app
  if (decorateReply) {
    return app.register(fastifyStatic, fastifyNativeOptions);
  }

  // Modo Scanner (Encapsulado por controlador para evitar colisiones)
  await app.register(
    async (scopedInstance) => {
      // Si se proporciona un guard personalizado, lo aplicamos como preHandler a este scope específico
      if (guardHandler) {
        scopedInstance.addHook("preHandler", guardHandler);
      }

      // Protección Anti-Hotlinking => Si se configuran referers válidos,
      // añadimos un hook para validar cada petición
      if (
        staticOptions.validReferers &&
        staticOptions.validReferers.length > 0
      ) {
        scopedInstance.addHook("onRequest", async (req, _reply) => {
          const referer = req.headers.referer;

          // Si no hay referer (acceso directo pegando la URL en el navegador),
          // lo dejamos pasar. El hotlinking ocurre cuando se incrusta en otro HTML.
          if (referer) {
            let isAllowed = false;

            try {
              // Parseamos el referer entrante para extraer su origen real
              const refererUrl = new URL(referer);

              isAllowed = staticOptions.validReferers!.some((allowedRef) => {
                try {
                  // Comparamos orígenes exactos (ej: 'https://nuestra-plataforma.com' === 'https://nuestra-plataforma.com')
                  return new URL(allowedRef).origin === refererUrl.origin;
                } catch {
                  // Fallback: Por si en la configuración solo pasan el dominio ('nuestra-plataforma.com')
                  return allowedRef === refererUrl.hostname;
                }
              });
            } catch (error) {
              // Si el cliente envía un referer malformado (texto basura), denegamos el acceso
              isAllowed = false;
            }

            if (!isAllowed) {
              throw new ForbiddenException(
                "No tienes permiso para acceder a este recurso.",
              );
            }
          }
        });
      }

      // Handler personalizado para rutas no encontradas dentro de este scope,
      // devolviendo un JSON con formato de error consistente
      scopedInstance.setNotFoundHandler((request, reply) => {
        const notFoundError = new NotFoundException(
          "archivo estático",
          request.url,
        );
        reply.status(404).send(notFoundError.toApiError());
      });

      // Finalmente, registramos el plugin de archivos estáticos dentro de este scope específico
      scopedInstance.register(fastifyStatic, fastifyNativeOptions);
    },
    { prefix: targetPrefix }, // Prefijo aplicado a este scope para evitar colisiones con otros controladores o rutas
  );
}
