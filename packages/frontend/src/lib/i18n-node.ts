import type {
  INodeProperties,
  INodePropertyOption,
  INodeTypeDescription,
} from '@nomops/workflow';
import type { NodeTypeInfo } from '../api/client.js';
import { locale, translateExact } from './i18n.js';

export function localizeNodeOption(option: INodePropertyOption): INodePropertyOption {
  if (locale.value === 'en') return option;
  return {
    ...option,
    name: translateExact(option.name),
    ...(option.description ? { description: translateExact(option.description) } : {}),
    ...(option.values ? { values: option.values.map(localizeNodeProperty) } : {}),
  };
}

export function localizeNodeProperty(property: INodeProperties): INodeProperties {
  if (locale.value === 'en') return property;
  return {
    ...property,
    displayName: translateExact(property.displayName),
    ...(property.description ? { description: translateExact(property.description) } : {}),
    ...(property.placeholder ? { placeholder: translateExact(property.placeholder) } : {}),
    ...(property.options ? { options: property.options.map(localizeNodeOption) } : {}),
    ...(property.modes ? {
      modes: property.modes.map((mode) => ({
        ...mode,
        displayName: translateExact(mode.displayName),
        ...(mode.placeholder ? { placeholder: translateExact(mode.placeholder) } : {}),
      })),
    } : {}),
    ...(property.typeOptions ? {
      typeOptions: {
        ...property.typeOptions,
        ...(property.typeOptions.action ? {
          action: { ...property.typeOptions.action, label: translateExact(property.typeOptions.action.label) },
        } : {}),
        ...(property.typeOptions.fixedCollection ? {
          fixedCollection: {
            ...property.typeOptions.fixedCollection,
            ...(property.typeOptions.fixedCollection.itemTitle ? {
              itemTitle: translateExact(property.typeOptions.fixedCollection.itemTitle),
            } : {}),
            ...(property.typeOptions.fixedCollection.addButtonLabel ? {
              addButtonLabel: translateExact(property.typeOptions.fixedCollection.addButtonLabel),
            } : {}),
          },
        } : {}),
        ...(property.typeOptions.addOptionalFieldButtonText ? {
          addOptionalFieldButtonText: translateExact(property.typeOptions.addOptionalFieldButtonText),
        } : {}),
        ...(property.typeOptions.filter ? {
          filter: {
            ...property.typeOptions.filter,
            ...(property.typeOptions.filter.itemTitle ? {
              itemTitle: translateExact(property.typeOptions.filter.itemTitle),
            } : {}),
            ...(property.typeOptions.filter.addButtonLabel ? {
              addButtonLabel: translateExact(property.typeOptions.filter.addButtonLabel),
            } : {}),
          },
        } : {}),
        ...(property.typeOptions.resourceMapper?.valuesLabel ? {
          resourceMapper: {
            ...property.typeOptions.resourceMapper,
            valuesLabel: translateExact(property.typeOptions.resourceMapper.valuesLabel),
          },
        } : {}),
      },
    } : {}),
  };
}

/** Localize display metadata only; protocol names, parameter keys and defaults stay stable. */
export function localizeNodeType(description: NodeTypeInfo): NodeTypeInfo {
  if (locale.value === 'en') return description;
  return {
    ...description,
    displayName: translateExact(description.displayName),
    description: translateExact(description.description),
    defaults: { ...description.defaults, name: translateExact(description.defaults.name) },
    ...(description.outputNames ? { outputNames: description.outputNames.map(translateExact) } : {}),
    properties: description.properties.map(localizeNodeProperty),
  } as INodeTypeDescription & { type: string };
}
