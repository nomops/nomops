import type { INodeTypeDescription } from '@nomops/workflow';

export const mergeDescription: INodeTypeDescription = {
  displayName: 'Merge',
  name: 'merge',
  group: ['transform'],
  categories: ['flow', 'dataTransformation'],
  version: 1,
  description: 'Merges data from multiple streams once data from all inputs is available',
  defaults: { name: 'Merge' },
  inputs: ['main', 'main'],
  outputs: ['main'],
  properties: [
    {
      displayName: 'Mode', name: 'mode', type: 'options', default: 'append',
      options: [
        { name: 'Append', value: 'append', description: 'Output items of each input, one after the other' },
        { name: 'Combine', value: 'combine', description: 'Merge matching items together' },
        { name: 'SQL Query', value: 'combineBySql', description: 'Write a query to do the merge' },
        { name: 'Choose Branch', value: 'chooseBranch', description: 'Output data from a specific branch, without modifying it' },
      ],
    },
    {
      displayName: 'Number of Inputs', name: 'numberInputs', type: 'number', default: 2,
      description: 'The number of inputs to wait for',
      typeOptions: { minValue: 2, maxValue: 10 },
    },
    {
      displayName: 'Combine By', name: 'combineBy', type: 'options', default: 'matchingFields',
      displayOptions: { show: { mode: ['combine'] } },
      options: [
        { name: 'Matching Fields', value: 'matchingFields' },
        { name: 'Position', value: 'position' },
        { name: 'All Possible Combinations', value: 'all' },
      ],
    },
    {
      displayName: 'Fields To Match Have Different Names', name: 'differentFields', type: 'boolean', default: false,
      displayOptions: { show: { mode: ['combine'], combineBy: ['matchingFields'] } },
    },
    {
      displayName: 'Fields to Match', name: 'fieldsToMatchString', type: 'string', default: '',
      placeholder: 'e.g. id, name',
      displayOptions: { show: { mode: ['combine'], combineBy: ['matchingFields'], differentFields: [false] } },
    },
    {
      displayName: 'Input 1 Fields', name: 'fieldsToMatchStringInput1', type: 'string', default: '',
      placeholder: 'e.g. customerId',
      displayOptions: { show: { mode: ['combine'], combineBy: ['matchingFields'], differentFields: [true] } },
    },
    {
      displayName: 'Input 2 Fields', name: 'fieldsToMatchStringInput2', type: 'string', default: '',
      placeholder: 'e.g. id',
      displayOptions: { show: { mode: ['combine'], combineBy: ['matchingFields'], differentFields: [true] } },
    },
    {
      displayName: 'Output Type', name: 'joinMode', type: 'options', default: 'keepMatches',
      displayOptions: { show: { mode: ['combine'], combineBy: ['matchingFields'] } },
      options: [
        { name: 'Keep Matches', value: 'keepMatches' },
        { name: 'Keep Non-Matches', value: 'keepNonMatches' },
        { name: 'Keep Everything', value: 'keepEverything' },
        { name: 'Enrich Input 1', value: 'enrichInput1' },
        { name: 'Enrich Input 2', value: 'enrichInput2' },
      ],
    },
    {
      displayName: 'Output Data From', name: 'outputDataFrom', type: 'options', default: 'both',
      displayOptions: { show: { mode: ['combine'], combineBy: ['matchingFields'], joinMode: ['keepMatches'] } },
      options: [
        { name: 'Both Inputs Merged Together', value: 'both' },
        { name: 'Input 1', value: 'input1' },
        { name: 'Input 2', value: 'input2' },
      ],
    },
    {
      displayName: 'Query', name: 'query', type: 'string',
      default: 'SELECT * FROM input1 LEFT JOIN input2 ON input1.name = input2.id',
      description: 'Input data is available as tables input1, input2, and so on',
      typeOptions: { rows: 5, editor: 'sql' },
      displayOptions: { show: { mode: ['combineBySql'] } },
    },
    {
      displayName: 'Output Type', name: 'chooseBranchMode', type: 'options', default: 'waitForAll',
      displayOptions: { show: { mode: ['chooseBranch'] } },
      options: [
        { name: 'Wait for All Inputs to Arrive', value: 'waitForAll' },
        { name: 'Use Input That Ran Last', value: 'latestInput' },
      ],
    },
    {
      displayName: 'Output', name: 'output', type: 'options', default: 'specifiedInput',
      displayOptions: { show: { mode: ['chooseBranch'] } },
      options: [
        { name: 'Data of Specified Input', value: 'specifiedInput' },
        { name: 'A Single, Empty Item', value: 'empty' },
      ],
    },
    {
      displayName: 'Use Data of Input', name: 'useDataOfInput', type: 'number', default: 1,
      displayOptions: { show: { mode: ['chooseBranch'], output: ['specifiedInput'] } },
    },
    {
      displayName: 'Options', name: 'options', type: 'collection', default: {}, options: [
        { name: 'Clash Handling', value: 'clashHandling', description: 'Choose which input wins when fields have the same name' },
        { name: 'Fuzzy Compare', value: 'fuzzyCompare', description: 'Coerce values before comparing matching fields' },
        { name: 'Disable Dot Notation', value: 'disableDotNotation' },
        { name: 'Empty Query Result', value: 'emptyQueryResult', values: [{
          displayName: 'Empty Query Result', name: 'emptyQueryResult', type: 'options', default: 'empty',
          options: [{ name: 'Empty Result', value: 'empty' }, { name: 'Success', value: 'success' }],
        }] },
      ],
    },
  ],
};
