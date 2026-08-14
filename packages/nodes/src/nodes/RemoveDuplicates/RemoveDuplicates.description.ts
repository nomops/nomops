import type { INodeTypeDescription } from '@nomops/workflow';

export const removeDuplicatesDescription: INodeTypeDescription = {
  displayName: 'Remove Duplicates', name: 'removeDuplicates', group: ['transform'],
  categories: ['dataTransformation'], aliases: ['deduplicate', 'unique items'], version: [1, 2],
  description: 'Delete items with matching field values', defaults: { name: 'Remove Duplicates' },
  inputs: ['main'], outputs: ['main'], outputNames: ['Kept', 'Discarded'], properties: [
    { displayName: 'Operation', name: 'operation', type: 'options', default: 'removeDuplicateInputItems', noDataExpression: true,
      displayOptions: { show: { '@version': [{ _cnd: { gte: 2 } }] } },
      options: [
        { name: 'Remove Items Repeated Within Current Input', value: 'removeDuplicateInputItems', description: 'Remove duplicates from incoming items' },
        { name: 'Remove Items Processed in Previous Executions', value: 'removeItemsSeenInPreviousExecutions', description: 'Deduplicate items already seen in previous executions' },
        { name: 'Clear Deduplication History', value: 'clearDeduplicationHistory', description: 'Wipe the store of previous items' },
      ] },
    { displayName: 'Compare', name: 'compare', type: 'options', default: 'allFields',
      displayOptions: { show: { operation: ['removeDuplicateInputItems'] } }, options: [
        { name: 'All Fields', value: 'allFields' }, { name: 'All Fields Except', value: 'allFieldsExcept' },
        { name: 'Selected Fields', value: 'selectedFields' },
      ] },
    { displayName: 'Fields To Exclude', name: 'fieldsToExclude', type: 'string', default: '', placeholder: 'e.g. email, name',
      displayOptions: { show: { operation: ['removeDuplicateInputItems'], compare: ['allFieldsExcept'] } } },
    { displayName: 'Fields To Compare', name: 'fieldsToCompare', type: 'string', default: '', placeholder: 'e.g. email, name',
      displayOptions: { show: { operation: ['removeDuplicateInputItems'], compare: ['selectedFields'] } } },
    { displayName: 'Keep Items Where', name: 'logic', type: 'options', default: 'removeItemsWithAlreadySeenKeyValues', noDataExpression: true,
      displayOptions: { show: { operation: ['removeItemsSeenInPreviousExecutions'] } }, options: [
        { name: 'Value Is New', value: 'removeItemsWithAlreadySeenKeyValues' },
        { name: 'Value Is Higher than Any Previous Value', value: 'removeItemsUpToStoredIncrementalKey' },
        { name: 'Value Is a Date Later than Any Previous Date', value: 'removeItemsUpToStoredDate' },
      ] },
    { displayName: 'Value to Dedupe On', name: 'dedupeValue', type: 'string', default: '', required: true, placeholder: 'e.g. ID',
      displayOptions: { show: { operation: ['removeItemsSeenInPreviousExecutions'], logic: ['removeItemsWithAlreadySeenKeyValues'] } } },
    { displayName: 'Value to Dedupe On', name: 'incrementalDedupeValue', type: 'number', default: 0,
      displayOptions: { show: { operation: ['removeItemsSeenInPreviousExecutions'], logic: ['removeItemsUpToStoredIncrementalKey'] } } },
    { displayName: 'Value to Dedupe On', name: 'dateDedupeValue', type: 'dateTime', default: '',
      displayOptions: { show: { operation: ['removeItemsSeenInPreviousExecutions'], logic: ['removeItemsUpToStoredDate'] } } },
    { displayName: 'Mode', name: 'mode', type: 'options', default: 'cleanDatabase',
      description: 'How you want to modify the key values stored in the history',
      displayOptions: { show: { operation: ['clearDeduplicationHistory'] } },
      options: [{ name: 'Clean Database', value: 'cleanDatabase' }] },
    { displayName: 'Options', name: 'options', type: 'collection', default: {}, placeholder: 'Add Field', options: [
      { name: 'Disable Dot Notation', value: 'disableDotNotation', values: [{
        displayName: 'Disable Dot Notation', name: 'disableDotNotation', type: 'boolean', default: false,
        displayOptions: { show: { '/operation': ['removeDuplicateInputItems'] }, hide: { '/compare': ['allFields'] } },
      }] },
      { name: 'Remove Other Fields', value: 'removeOtherFields', values: [{
        displayName: 'Remove Other Fields', name: 'removeOtherFields', type: 'boolean', default: false,
        displayOptions: { show: { '/operation': ['removeDuplicateInputItems'] }, hide: { '/compare': ['allFields'] } },
      }] },
      { name: 'Scope', value: 'scope', values: [{ displayName: 'Scope', name: 'scope', type: 'options', default: 'node',
        displayOptions: { show: { '/operation': ['clearDeduplicationHistory', 'removeItemsSeenInPreviousExecutions'] } }, options: [
          { name: 'Workflow', value: 'workflow' }, { name: 'Node', value: 'node' },
        ] }] },
      { name: 'History Size', value: 'historySize', values: [{ displayName: 'History Size', name: 'historySize', type: 'number', default: 10000,
        displayOptions: { show: { '/operation': ['removeItemsSeenInPreviousExecutions'], '/logic': ['removeItemsWithAlreadySeenKeyValues'] } } }] },
    ] },
    { displayName: 'Legacy Fields', name: 'fields', type: 'string', default: '', description: 'Legacy workflow compatibility',
      displayOptions: { hide: { operation: ['removeDuplicateInputItems', 'removeItemsSeenInPreviousExecutions', 'clearDeduplicationHistory'] } } },
    { displayName: 'Legacy Keep', name: 'keep', type: 'string', default: 'first', description: 'Legacy workflow compatibility',
      displayOptions: { hide: { operation: ['removeDuplicateInputItems', 'removeItemsSeenInPreviousExecutions', 'clearDeduplicationHistory'] } } },
  ],
};
