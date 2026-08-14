import { defaultHttpRequest, type INodeLoader } from '@nomops/core';
import type {
  IHttpRequestOptions,
  ILoadOptionsContext,
  ILoadOptionsDeclaration,
  INodeCredentialDescription,
  INodeProperties,
  INodePropertyOption,
  IResourceLocatorContext,
  IResourceLocatorResult,
  IResourceMapperFields,
  JsonObject,
} from '@nomops/workflow';
import { OperationalError } from '@nomops/workflow';
import type { CredentialService } from './credential-service.js';
import type { DataTableService } from './data-table-service.js';

export interface IDynamicNodeParametersRequest {
  nodeType: string;
  nodeVersion?: number;
  propertyName: string;
  currentNodeParameters: JsonObject;
  credentials: Record<string, { id: string }>;
  filter?: string;
  paginationToken?: string;
}

function propertyByName(properties: INodeProperties[], name: string): INodeProperties | undefined {
  for (const property of properties) {
    if (property.name === name) return property;
    for (const option of property.options ?? []) {
      const nested = option.values ? propertyByName(option.values, name) : undefined;
      if (nested) return nested;
    }
  }
  return undefined;
}

function getPath(value: unknown, path?: string): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function render(value: unknown, parameters: JsonObject): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*\$parameter\.([\w.]+)\s*\}\}/g, (_match, path: string) => {
      const resolved = getPath(parameters, path);
      return resolved === undefined || resolved === null ? '' : String(resolved);
    });
  }
  if (Array.isArray(value)) return value.map((entry) => render(entry, parameters));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, render(entry, parameters)]));
  }
  return value;
}

function mapOptions(response: unknown, declaration: ILoadOptionsDeclaration): INodePropertyOption[] {
  const rows = getPath(response, declaration.resultsPath);
  if (!Array.isArray(rows)) throw new OperationalError('Dynamic options response is not an array', { status: 502 });
  return rows.map((row, index) => {
    const name = getPath(row, declaration.name);
    const value = getPath(row, declaration.value);
    if (typeof name !== 'string' || !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new OperationalError('Dynamic option has an invalid name or value', { status: 502, index });
    }
    const description = declaration.description ? getPath(row, declaration.description) : undefined;
    return {
      name,
      value: value as string | number | boolean,
      ...(typeof description === 'string' ? { description } : {}),
    };
  });
}

function validateOptions(options: INodePropertyOption[]): INodePropertyOption[] {
  for (const [index, option] of options.entries()) {
    if (typeof option.name !== 'string' || !['string', 'number', 'boolean'].includes(typeof option.value)) {
      throw new OperationalError('Dynamic option has an invalid name or value', { status: 502, index });
    }
  }
  return options;
}

export class DynamicNodeParametersService {
  constructor(
    private readonly nodeLoader: INodeLoader,
    private readonly credentials: CredentialService,
    private readonly httpRequest: (options: IHttpRequestOptions) => Promise<unknown> = defaultHttpRequest,
    private readonly dataTables?: DataTableService,
  ) {}

  private context(
    request: IDynamicNodeParametersRequest,
    projectId: string,
    userId: string,
    credentialDescriptions: INodeCredentialDescription[],
  ): IResourceLocatorContext {
    return {
      getCurrentNodeParameter: (name) => getPath(request.currentNodeParameters, name),
      getCredentials: async (type) => {
        if (!credentialDescriptions.some((description) => description.name === type)) {
          throw new OperationalError('Credential type is not declared by this node', { status: 400, type });
        }
        const reference = request.credentials[type];
        if (!reference) throw new OperationalError('Credential is required for dynamic parameters', { status: 400, type });
        return this.credentials.getDecryptedData(reference.id, projectId, undefined, userId);
      },
      helpers: {
        httpRequest: this.httpRequest,
        ...(this.dataTables
          ? {
              dataTables: {
                list: () => this.dataTables!.list(projectId),
                get: (id: string) => this.dataTables!.get(id, projectId),
              },
            }
          : {}),
      },
      ...(request.filter !== undefined ? { filter: request.filter } : {}),
      ...(request.paginationToken !== undefined ? { paginationToken: request.paginationToken } : {}),
    };
  }

  async loadOptions(
    request: IDynamicNodeParametersRequest,
    projectId: string,
    userId: string,
  ): Promise<INodePropertyOption[]> {
    const node = await this.nodeLoader.getByNameAndVersion(request.nodeType, request.nodeVersion);
    const property = propertyByName(node.description.properties, request.propertyName);
    if (!property || !['options', 'multiOptions'].includes(property.type)) {
      throw new OperationalError('Dynamic options property not found', { status: 404 });
    }
    const context = this.context(request, projectId, userId, node.description.credentials ?? []);
    const methodName = property.typeOptions?.loadOptionsMethod;
    if (methodName) {
      const method = node.methods?.loadOptions?.[methodName];
      if (!method) throw new OperationalError('Dynamic options method not found', { status: 404 });
      try {
        return validateOptions(await method.call(context as ILoadOptionsContext));
      } catch {
        throw new OperationalError('Unable to load dynamic node parameters', { status: 502 });
      }
    }
    const declaration = property.typeOptions?.loadOptions;
    if (!declaration) throw new OperationalError('Dynamic options are not declared for this property', { status: 400 });
    const defaults = node.description.requestDefaults;
    const rawUrl = String(render(declaration.request.url, request.currentNodeParameters));
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `${defaults?.baseUrl ?? ''}${rawUrl}`;
    try {
      const response = await this.httpRequest({
        method: declaration.request.method ?? 'GET',
        url,
        headers: {
          ...(defaults?.headers ?? {}),
          ...(render(declaration.request.headers ?? {}, request.currentNodeParameters) as Record<string, string>),
        },
        qs: render(declaration.request.qs, request.currentNodeParameters) as Record<string, unknown> | undefined,
        body: render(declaration.request.body, request.currentNodeParameters),
      });
      return mapOptions(response, declaration);
    } catch {
      throw new OperationalError('Unable to load dynamic node parameters', { status: 502 });
    }
  }

  async locateResources(
    request: IDynamicNodeParametersRequest,
    projectId: string,
    userId: string,
  ): Promise<IResourceLocatorResult> {
    const node = await this.nodeLoader.getByNameAndVersion(request.nodeType, request.nodeVersion);
    const property = propertyByName(node.description.properties, request.propertyName);
    if (!property || property.type !== 'resourceLocator') {
      throw new OperationalError('Resource locator property not found', { status: 404 });
    }
    const listMode = property.modes?.find((mode) => mode.name === 'list');
    const methodName = listMode?.searchListMethod;
    const method = methodName ? node.methods?.resourceLocator?.[methodName] : undefined;
    if (!method) throw new OperationalError('Resource locator method not found', { status: 404 });
    try {
      const result = await method.call(this.context(request, projectId, userId, node.description.credentials ?? []));
      return { ...result, results: validateOptions(result.results) };
    } catch {
      throw new OperationalError('Unable to load dynamic node parameters', { status: 502 });
    }
  }

  async mapResourceFields(
    request: IDynamicNodeParametersRequest,
    projectId: string,
    userId: string,
  ): Promise<IResourceMapperFields> {
    const node = await this.nodeLoader.getByNameAndVersion(request.nodeType, request.nodeVersion);
    const property = propertyByName(node.description.properties, request.propertyName);
    if (!property || property.type !== 'resourceMapper') {
      throw new OperationalError('Resource mapper property not found', { status: 404 });
    }
    const methodName = property.typeOptions?.resourceMapper?.resourceMapperMethod;
    const method = methodName ? node.methods?.resourceMapping?.[methodName] : undefined;
    if (!method) throw new OperationalError('Resource mapper method not found', { status: 404 });
    try {
      const result = await method.call(this.context(request, projectId, userId, node.description.credentials ?? []));
      if (!Array.isArray(result.fields)) throw new Error('invalid fields');
      return result;
    } catch {
      throw new OperationalError('Unable to load resource mapper fields', { status: 502 });
    }
  }
}
