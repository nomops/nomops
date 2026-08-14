import type { IDisplayOptions, INodeProperties, INodeTypeDescription } from '@nomops/workflow';

const rowDisplay = (operations: string[]): IDisplayOptions => ({
  show: { resource: ['row'], operation: operations },
});

const tableDisplay = (operations: string[]): IDisplayOptions => ({
  show: { resource: ['table'], operation: operations },
});

const tableLocator = (displayOptions: IDisplayOptions): INodeProperties => ({
  displayName: 'Data table',
  name: 'dataTableId',
  type: 'resourceLocator',
  default: { mode: 'list', value: '' },
  required: true,
  modes: [
    { displayName: 'From List', name: 'list', placeholder: 'Select a data table', searchListMethod: 'tableSearch' },
    { displayName: 'By Name', name: 'name', placeholder: 'e.g. My Table' },
    { displayName: 'ID', name: 'id' },
  ],
  displayOptions,
});

const conditionFields = (operations: string[], required: boolean): INodeProperties[] => [
  {
    displayName: 'Must Match',
    name: 'matchType',
    type: 'options',
    default: 'anyCondition',
    options: [
      { name: 'Any Condition', value: 'anyCondition' },
      { name: 'All Conditions', value: 'allConditions' },
    ],
    displayOptions: rowDisplay(operations),
  },
  {
    displayName: 'Conditions',
    name: 'filters',
    type: 'fixedCollection',
    default: {},
    placeholder: 'Add Condition',
    description: 'Filter to decide which rows get selected',
    typeOptions: {
      multipleValues: true,
      fixedCollection: { itemTitle: 'Condition', addButtonLabel: 'Add Condition', layout: 'horizontal' },
    },
    displayOptions: rowDisplay(operations),
    options: [
      {
        name: 'conditions',
        value: 'conditions',
        values: [
          {
            displayName: 'Column',
            name: 'keyName',
            type: 'options',
            default: 'id',
            required,
            typeOptions: {
              loadOptionsDependsOn: ['dataTableId.value'],
              loadOptionsMethod: 'getDataTableColumns',
            },
          },
          {
            displayName: 'Condition',
            name: 'condition',
            type: 'options',
            default: 'eq',
            typeOptions: {
              loadOptionsDependsOn: ['keyName'],
              loadOptionsMethod: 'getConditionsForColumn',
            },
          },
          {
            displayName: 'Value',
            name: 'keyValue',
            type: 'string',
            default: '',
            displayOptions: { hide: { condition: ['isEmpty', 'isNotEmpty', 'isTrue', 'isFalse'] } },
          },
        ],
      },
    ],
  },
];

const columnMapper = (operation: 'insert' | 'update' | 'upsert'): INodeProperties => ({
  displayName: 'Columns',
  name: 'columns',
  type: 'resourceMapper',
  default: { mappingMode: 'defineBelow', value: {}, schema: [] },
  required: true,
  noDataExpression: true,
  typeOptions: {
    loadOptionsDependsOn: ['dataTableId.value'],
    resourceMapper: {
      valuesLabel: `Values to ${operation}`,
      resourceMapperMethod: 'getDataTables',
      mode: operation === 'insert' ? 'add' : 'update',
      addAllFields: true,
      multiKeyMatch: true,
    },
  },
  displayOptions: rowDisplay([operation]),
});

const dryRunOptions = (operations: string[]): INodeProperties => ({
  displayName: 'Options',
  name: 'options',
  type: 'collection',
  default: {},
  placeholder: 'Add option',
  displayOptions: rowDisplay(operations),
  options: [
    {
      name: 'dryRun',
      value: 'dryRun',
      values: [
        {
          displayName: 'Dry Run',
          name: 'dryRun',
          type: 'boolean',
          default: false,
          description: 'Whether the operation simulates and returns affected rows in their before and after states',
        },
      ],
    },
  ],
});

export const dataTableDescription: INodeTypeDescription = {
  displayName: 'Data table',
  name: 'dataTable',
  group: ['input', 'transform'],
  categories: ['core', 'dataTransformation'],
  aliases: ['database', 'table', 'persistent data', 'storage'],
  version: [1, 1.1],
  description: 'Permanently save data across workflow executions in a table',
  defaults: { name: 'Data table' },
  inputs: ['main'],
  outputs: ['main'],
  usableAsTool: true,
  properties: [
    {
      displayName: 'Resource',
      name: 'resource',
      type: 'options',
      default: 'row',
      noDataExpression: true,
      options: [
        { name: 'Row', value: 'row' },
        { name: 'Table', value: 'table' },
      ],
    },
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      default: 'insert',
      noDataExpression: true,
      displayOptions: { show: { resource: ['row'] } },
      options: [
        { name: 'Delete', value: 'deleteRows', description: 'Delete row(s)' },
        { name: 'Get', value: 'get', description: 'Get row(s)' },
        { name: 'If Row Exists', value: 'rowExists', description: 'Match input items that are in the data table' },
        { name: 'If Row Does Not Exist', value: 'rowNotExists', description: 'Match input items that are not in the data table' },
        { name: 'Insert', value: 'insert', description: 'Insert a new row' },
        { name: 'Update', value: 'update', description: 'Update row(s) matching certain fields' },
        { name: 'Upsert', value: 'upsert', description: 'Update row(s), or insert if there is no match' },
      ],
    },
    tableLocator({ show: { resource: ['row'] } }),
    ...conditionFields(['deleteRows', 'get', 'rowExists', 'rowNotExists', 'update', 'upsert'], false),
    {
      displayName: 'Return All',
      name: 'returnAll',
      type: 'boolean',
      default: false,
      description: 'Whether to return all results or only up to a given limit',
      displayOptions: rowDisplay(['get']),
    },
    {
      displayName: 'Limit Per Input Row',
      name: 'limit',
      type: 'number',
      default: 50,
      description: 'Max number of results to return',
      typeOptions: { minValue: 1 },
      displayOptions: { show: { resource: ['row'], operation: ['get'], returnAll: [false] } },
    },
    {
      displayName: 'Order By',
      name: 'orderBy',
      type: 'boolean',
      default: false,
      displayOptions: rowDisplay(['get']),
    },
    {
      displayName: 'Order By Column',
      name: 'orderByColumn',
      type: 'options',
      default: 'createdAt',
      typeOptions: { loadOptionsDependsOn: ['dataTableId.value'], loadOptionsMethod: 'getDataTableColumns' },
      displayOptions: { show: { resource: ['row'], operation: ['get'], orderBy: [true] } },
    },
    {
      displayName: 'Order By Direction',
      name: 'orderByDirection',
      type: 'options',
      default: 'DESC',
      options: [
        { name: 'Ascending', value: 'ASC' },
        { name: 'Descending', value: 'DESC' },
      ],
      displayOptions: { show: { resource: ['row'], operation: ['get'], orderBy: [true] } },
    },
    columnMapper('insert'),
    columnMapper('update'),
    columnMapper('upsert'),
    {
      displayName: 'Options',
      name: 'options',
      type: 'collection',
      default: {},
      placeholder: 'Add Option',
      displayOptions: rowDisplay(['insert']),
      options: [
        {
          name: 'optimizeBulk',
          value: 'optimizeBulk',
          values: [{
            displayName: 'Optimize Bulk',
            name: 'optimizeBulk',
            type: 'boolean',
            default: false,
            noDataExpression: true,
            description: 'Whether to improve bulk insert performance by returning only an inserted count',
          }],
        },
      ],
    },
    dryRunOptions(['deleteRows', 'update', 'upsert']),
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      default: 'list',
      noDataExpression: true,
      displayOptions: { show: { resource: ['table'] } },
      options: [
        { name: 'Clear', value: 'clear', description: 'Clear all rows from a data table' },
        { name: 'Create', value: 'create', description: 'Create a new data table' },
        { name: 'Delete', value: 'delete', description: 'Delete a data table' },
        { name: 'List', value: 'list', description: 'List all data tables' },
        { name: 'Rename', value: 'update', description: 'Rename a data table' },
      ],
    },
    tableLocator({ show: { resource: ['table'], operation: ['clear', 'delete', 'update'] } }),
    {
      displayName: 'This will permanently delete all rows from the data table. The table structure will be retained. This action cannot be undone.',
      name: 'clearWarning',
      type: 'notice',
      default: '',
      displayOptions: tableDisplay(['clear']),
    },
    {
      displayName: 'Name',
      name: 'tableName',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'e.g. My Data Table',
      description: 'The name of the data table to create',
      displayOptions: tableDisplay(['create']),
    },
    {
      displayName: 'Columns',
      name: 'columns',
      type: 'fixedCollection',
      default: {},
      placeholder: 'Add Column',
      description: 'The columns to create in the data table',
      typeOptions: {
        multipleValues: true,
        fixedCollection: { itemTitle: 'Column', addButtonLabel: 'Add Column', layout: 'horizontal' },
      },
      displayOptions: tableDisplay(['create']),
      options: [{
        name: 'column',
        value: 'column',
        values: [
          { displayName: 'Name', name: 'name', type: 'string', default: '', required: true },
          {
            displayName: 'Type',
            name: 'type',
            type: 'options',
            default: 'string',
            options: [
              { name: 'Boolean', value: 'boolean' },
              { name: 'Date', value: 'date' },
              { name: 'Number', value: 'number' },
              { name: 'String', value: 'string' },
            ],
          },
        ],
      }],
    },
    {
      displayName: 'Options',
      name: 'options',
      type: 'collection',
      default: {},
      placeholder: 'Add Option',
      displayOptions: tableDisplay(['create']),
      options: [{
        name: 'createIfNotExists',
        value: 'createIfNotExists',
        values: [{
          displayName: 'Reuse Existing Tables',
          name: 'createIfNotExists',
          type: 'boolean',
          default: true,
          description: 'Whether to return an existing table with the same name without throwing an error',
        }],
      }],
    },
    {
      displayName: 'This will permanently delete the data table and all its data. This action cannot be undone.',
      name: 'deleteWarning',
      type: 'notice',
      default: '',
      displayOptions: tableDisplay(['delete']),
    },
    {
      displayName: 'Return All',
      name: 'returnAll',
      type: 'boolean',
      default: true,
      displayOptions: tableDisplay(['list']),
    },
    {
      displayName: 'Limit Per Input Row',
      name: 'limit',
      type: 'number',
      default: 50,
      typeOptions: { minValue: 1 },
      displayOptions: { show: { resource: ['table'], operation: ['list'], returnAll: [false] } },
    },
    {
      displayName: 'Options',
      name: 'options',
      type: 'collection',
      default: {},
      placeholder: 'Add Option',
      displayOptions: tableDisplay(['list']),
      options: [
        { name: 'filterName', value: 'filterName', values: [{ displayName: 'Filter by Name', name: 'filterName', type: 'string', default: '' }] },
        {
          name: 'sortField', value: 'sortField', values: [{
            displayName: 'Sort Field', name: 'sortField', type: 'options', default: 'name', options: [
              { name: 'Created', value: 'createdAt' }, { name: 'Name', value: 'name' }, { name: 'Updated', value: 'updatedAt' },
            ],
          }],
        },
        {
          name: 'sortDirection', value: 'sortDirection', values: [{
            displayName: 'Sort Direction', name: 'sortDirection', type: 'options', default: 'asc', options: [
              { name: 'Ascending', value: 'asc' }, { name: 'Descending', value: 'desc' },
            ],
          }],
        },
      ],
    },
    {
      displayName: 'New Name',
      name: 'newName',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'e.g. Renamed Data Table',
      description: 'The new name for the data table',
      displayOptions: tableDisplay(['update']),
    },
  ],
};
