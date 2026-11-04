import schemas from './generated/contracts.schema.json';

type Schema = {
  $ref?: string; const?: unknown; enum?: unknown[]; anyOf?: Schema[];
  type?: string; properties?: Record<string, Schema>; required?: string[];
  additionalProperties?: boolean; items?: Schema; minimum?: number; maximum?: number;
  minLength?: number; maxLength?: number; minItems?: number; maxItems?: number; pattern?: string; format?: string;
};
const definitions = schemas.$defs as Record<string, Schema>;

/** The generated Pydantic schema subset used by this application. Fail closed. */
function validate(schema: Schema, value: unknown): boolean {
  if (schema.$ref) {
    const definition = definitions[schema.$ref.split('/').pop() || ''];
    return !!definition && validate(definition, value);
  }
  if ('const' in schema && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.anyOf) return schema.anyOf.some(option => validate(option, value));
  if (schema.type === 'null') return value === null;
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'number' || schema.type === 'integer') {
    return typeof value === 'number' && Number.isFinite(value)
      && (schema.type !== 'integer' || Number.isInteger(value))
      && (schema.minimum === undefined || value >= schema.minimum)
      && (schema.maximum === undefined || value <= schema.maximum);
  }
  if (schema.type === 'string') {
    return typeof value === 'string'
      && (schema.minLength === undefined || value.length >= schema.minLength)
      && (schema.maxLength === undefined || value.length <= schema.maxLength)
      && (!schema.pattern || new RegExp(schema.pattern).test(value))
      && (schema.format !== 'uuid' || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
      && (schema.format !== 'date-time' || Number.isFinite(Date.parse(value)));
  }
  if (schema.type === 'array') {
    return Array.isArray(value) && (schema.minItems === undefined || value.length >= schema.minItems)
      && (schema.maxItems === undefined || value.length <= schema.maxItems)
      && !!schema.items && value.every(item => validate(schema.items!, item));
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const properties = schema.properties || {};
    return (schema.required || []).every(key => key in record)
      && Object.entries(record).every(([key, entry]) =>
        key in properties ? validate(properties[key], entry) : schema.additionalProperties !== false);
  }
  return 'const' in schema || !!schema.enum;
}

export function isContract<T>(name: string, value: unknown): value is T {
  return !!definitions[name] && validate(definitions[name], value);
}

export function decodeContract<T>(name: string, value: unknown): T {
  if (!isContract<T>(name, value)) throw new Error('We received an unexpected response. Please refresh and try again.');
  return value;
}
