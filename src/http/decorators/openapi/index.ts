/**
 * @description Barrel export para los decoradores de OpenAPI.
 * Agrupa y re-exporta todos los decoradores relacionados con la documentación
 * automática OpenAPI 3.1 + Scalar.
 */

export { ApiTags } from "./ApiTags.js";
export { ApiOperation } from "./ApiOperation.js";
export { ApiResponseDoc } from "./ApiResponse.js";
export { ApiBearerAuth } from "./ApiBearerAuth.js";
export { ApiSecurity } from "./ApiSecurity.js";
export { ApiParam } from "./ApiParam.js";
export { ApiQuery } from "./ApiQuery.js";
export { ApiHeader } from "./ApiHeader.js";
export { ApiProperty, OPENAPI_PROPERTY_METADATA } from "./ApiProperty.js";
export { ApiSchema } from "./ApiSchema.js";
export { ApiExample, OPENAPI_EXAMPLES_METADATA } from "./ApiExample.js";
export { ApiExcludeEndpoint } from "./ApiExcludeEndpoint.js";
export { ApiExcludeController } from "./ApiExcludeController.js";
export { ApiServer } from "./ApiServer.js";

export type {
  ApiPropertyOptions,
  ApiSchemaOptions,
  ApiOperationOptions,
  ApiResponseOptions,
  ApiParamOptions,
  ApiQueryOptions,
  ApiHeaderOptions,
} from "../types.js";
