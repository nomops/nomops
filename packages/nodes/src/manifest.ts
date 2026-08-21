import type { ILoadableNodeType } from '@nomops/workflow';
import { setDescription } from './nodes/Set/Set.description.js';
import { noOpDescription } from './nodes/NoOp/NoOp.description.js';
import { manualTriggerDescription } from './nodes/ManualTrigger/ManualTrigger.description.js';
import { ifDescription } from './nodes/If/If.description.js';
import { switchDescription } from './nodes/Switch/Switch.description.js';
import { filterDescription } from './nodes/Filter/Filter.description.js';
import { splitOutDescription } from './nodes/SplitOut/SplitOut.description.js';
import { aggregateDescription } from './nodes/Aggregate/Aggregate.description.js';
import { sortDescription } from './nodes/Sort/Sort.description.js';
import { limitDescription } from './nodes/Limit/Limit.description.js';
import { removeDuplicatesDescription } from './nodes/RemoveDuplicates/RemoveDuplicates.description.js';
import { renameKeysDescription } from './nodes/RenameKeys/RenameKeys.description.js';
import { summarizeDescription } from './nodes/Summarize/Summarize.description.js';
import { compareDatasetsDescription } from './nodes/CompareDatasets/CompareDatasets.description.js';
import { dateTimeDescription } from './nodes/DateTime/DateTime.description.js';
import { cryptoDescription } from './nodes/Crypto/Crypto.description.js';
import { htmlDescription } from './nodes/Html/Html.description.js';
import { xmlDescription } from './nodes/Xml/Xml.description.js';
import { markdownDescription } from './nodes/Markdown/Markdown.description.js';
import { readWriteFileDescription } from './nodes/ReadWriteFile/ReadWriteFile.description.js';
import { extractFromFileDescription } from './nodes/ExtractFromFile/ExtractFromFile.description.js';
import { convertToFileDescription } from './nodes/ConvertToFile/ConvertToFile.description.js';
import { compressionDescription } from './nodes/Compression/Compression.description.js';
import { ftpDescription } from './nodes/Ftp/Ftp.description.js';
import { editImageDescription } from './nodes/EditImage/EditImage.description.js';
import { sshDescription } from './nodes/Ssh/Ssh.description.js';
import { sendEmailDescription } from './nodes/SendEmail/SendEmail.description.js';
import { emailTriggerDescription } from './nodes/EmailTrigger/EmailTrigger.description.js';
import { loopDescription } from './nodes/Loop/Loop.description.js';
import { mergeDescription } from './nodes/Merge/Merge.description.js';
import { codeDescription } from './nodes/Code/Code.description.js';
import { aiTransformDescription } from './nodes/AiTransform/AiTransform.description.js';
import { httpRequestDescription } from './nodes/HttpRequest/HttpRequest.description.js';
import { webhookDescription } from './nodes/Webhook/Webhook.description.js';
import { scheduleDescription } from './nodes/Schedule/Schedule.description.js';
import { executeWorkflowDescription } from './nodes/ExecuteWorkflow/ExecuteWorkflow.description.js';
import { aiAgentDescription } from './nodes/AiAgent/AiAgent.description.js';
import { waitDescription } from './nodes/Wait/Wait.description.js';
import { pollingTriggerDescription } from './nodes/PollingTrigger/PollingTrigger.description.js';
import { chatTriggerDescription } from './nodes/ChatTrigger/ChatTrigger.description.js';
import { evaluationTriggerDescription } from './nodes/EvaluationTrigger/EvaluationTrigger.description.js';
import { evaluationDescription } from './nodes/Evaluation/Evaluation.description.js';
import { errorTriggerDescription } from './nodes/ErrorTrigger/ErrorTrigger.description.js';
import { executeWorkflowTriggerDescription } from './nodes/ExecuteWorkflowTrigger/ExecuteWorkflowTrigger.description.js';
import { respondToWebhookDescription } from './nodes/RespondToWebhook/RespondToWebhook.description.js';
import { chatModelDescription } from './nodes/ChatModel/ChatModel.node.js';
import { setMetadataDescription } from './nodes/SetMetadata/SetMetadata.node.js';
import { httpToolDescription } from './nodes/HttpTool/HttpTool.node.js';
import { windowMemoryDescription } from './nodes/WindowMemory/WindowMemory.node.js';
import { stickyNoteDescription } from './nodes/StickyNote/StickyNote.node.js';
import { formTriggerDescription } from './nodes/FormTrigger/FormTrigger.description.js';
import { formDescription } from './nodes/Form/Form.description.js';
import { rssFeedReadDescription } from './nodes/RssFeedRead/RssFeedRead.description.js';
import { rssFeedReadTriggerDescription } from './nodes/RssFeedReadTrigger/RssFeedReadTrigger.description.js';
import { sseTriggerDescription } from './nodes/SseTrigger/SseTrigger.description.js';
import { stopAndErrorDescription } from './nodes/StopAndError/StopAndError.description.js';
import { executionDataDescription } from './nodes/ExecutionData/ExecutionData.description.js';
import { dataTableDescription } from './nodes/DataTable/DataTable.description.js';
import { nomopsDescription } from './nodes/Nomops/Nomops.description.js';
import { nomopsTriggerDescription } from './nodes/NomopsTrigger/NomopsTrigger.description.js';
import { totpDescription } from './nodes/Totp/Totp.description.js';
import { gitDescription } from './nodes/Git/Git.description.js';
import { declarative } from './nodes/integrations/declarative.js';
import { integrationDescriptions } from './nodes/integrations/integrations.js';

/**
 * 内置节点清单：description 静态常驻（轻量），节点类经 `load()` 懒加载（重量级 execute 代码）。
 * 这是节点加载器的数据源；社区包将来提供各自的清单。
 */
export const builtinNodeManifest: ILoadableNodeType[] = [
  {
    type: `nomops.${setDescription.name}`,
    description: setDescription,
    load: () => import('./nodes/Set/Set.node.js').then((m) => m.Set),
  },
  {
    type: `nomops.${noOpDescription.name}`,
    description: noOpDescription,
    load: () => import('./nodes/NoOp/NoOp.node.js').then((m) => m.NoOp),
  },
  {
    type: `nomops.${manualTriggerDescription.name}`,
    description: manualTriggerDescription,
    load: () => import('./nodes/ManualTrigger/ManualTrigger.node.js').then((m) => m.ManualTrigger),
  },
  {
    type: `nomops.${chatTriggerDescription.name}`,
    description: chatTriggerDescription,
    load: () => import('./nodes/ChatTrigger/ChatTrigger.node.js').then((m) => m.ChatTrigger),
  },
  {
    type: `nomops.${evaluationTriggerDescription.name}`,
    description: evaluationTriggerDescription,
    load: () => import('./nodes/EvaluationTrigger/EvaluationTrigger.node.js').then((m) => m.EvaluationTrigger),
  },
  {
    type: `nomops.${evaluationDescription.name}`,
    description: evaluationDescription,
    load: () => import('./nodes/Evaluation/Evaluation.node.js').then((m) => m.Evaluation),
  },
  {
    type: `nomops.${setMetadataDescription.name}`,
    description: setMetadataDescription,
    load: () => import('./nodes/SetMetadata/SetMetadata.node.js').then((m) => m.SetMetadata),
  },
  {
    type: `nomops.${executionDataDescription.name}`,
    description: executionDataDescription,
    load: () => import('./nodes/ExecutionData/ExecutionData.node.js').then((m) => m.ExecutionData),
  },
  {
    type: `nomops.${dataTableDescription.name}`,
    description: dataTableDescription,
    load: () => import('./nodes/DataTable/DataTable.node.js').then((m) => m.DataTable),
  },
  {
    type: `nomops.${nomopsDescription.name}`,
    description: nomopsDescription,
    load: () => import('./nodes/Nomops/Nomops.node.js').then((m) => m.Nomops),
  },
  {
    type: `nomops.${nomopsTriggerDescription.name}`,
    description: nomopsTriggerDescription,
    load: () => import('./nodes/NomopsTrigger/NomopsTrigger.node.js').then((m) => m.NomopsTrigger),
  },
  {
    type: `nomops.${stopAndErrorDescription.name}`,
    description: stopAndErrorDescription,
    load: () => import('./nodes/StopAndError/StopAndError.node.js').then((m) => m.StopAndError),
  },
  {
    type: `nomops.${totpDescription.name}`,
    description: totpDescription,
    load: () => import('./nodes/Totp/Totp.node.js').then((m) => m.Totp),
  },
  {
    type: `nomops.${gitDescription.name}`,
    description: gitDescription,
    load: () => import('./nodes/Git/Git.node.js').then((m) => m.Git),
  },
  {
    type: `nomops.${errorTriggerDescription.name}`,
    description: errorTriggerDescription,
    load: () => import('./nodes/ErrorTrigger/ErrorTrigger.node.js').then((m) => m.ErrorTrigger),
  },
  {
    type: `nomops.${executeWorkflowTriggerDescription.name}`,
    description: executeWorkflowTriggerDescription,
    load: () =>
      import('./nodes/ExecuteWorkflowTrigger/ExecuteWorkflowTrigger.node.js').then((m) => m.ExecuteWorkflowTrigger),
  },
  {
    type: `nomops.${respondToWebhookDescription.name}`,
    description: respondToWebhookDescription,
    load: () => import('./nodes/RespondToWebhook/RespondToWebhook.node.js').then((m) => m.RespondToWebhook),
  },
  {
    type: `nomops.${ifDescription.name}`,
    description: ifDescription,
    load: () => import('./nodes/If/If.node.js').then((m) => m.If),
  },
  {
    type: `nomops.${switchDescription.name}`,
    description: switchDescription,
    load: () => import('./nodes/Switch/Switch.node.js').then((m) => m.Switch),
  },
  {
    type: `nomops.${filterDescription.name}`,
    description: filterDescription,
    load: () => import('./nodes/Filter/Filter.node.js').then((m) => m.Filter),
  },
  {
    type: `nomops.${splitOutDescription.name}`,
    description: splitOutDescription,
    load: () => import('./nodes/SplitOut/SplitOut.node.js').then((m) => m.SplitOut),
  },
  {
    type: `nomops.${aggregateDescription.name}`,
    description: aggregateDescription,
    load: () => import('./nodes/Aggregate/Aggregate.node.js').then((m) => m.Aggregate),
  },
  {
    type: `nomops.${sortDescription.name}`,
    description: sortDescription,
    load: () => import('./nodes/Sort/Sort.node.js').then((m) => m.Sort),
  },
  {
    type: `nomops.${limitDescription.name}`,
    description: limitDescription,
    load: () => import('./nodes/Limit/Limit.node.js').then((m) => m.Limit),
  },
  {
    type: `nomops.${removeDuplicatesDescription.name}`,
    description: removeDuplicatesDescription,
    load: () => import('./nodes/RemoveDuplicates/RemoveDuplicates.node.js').then((m) => m.RemoveDuplicates),
  },
  {
    type: `nomops.${renameKeysDescription.name}`,
    description: renameKeysDescription,
    load: () => import('./nodes/RenameKeys/RenameKeys.node.js').then((m) => m.RenameKeys),
  },
  {
    type: `nomops.${summarizeDescription.name}`,
    description: summarizeDescription,
    load: () => import('./nodes/Summarize/Summarize.node.js').then((m) => m.Summarize),
  },
  {
    type: `nomops.${compareDatasetsDescription.name}`,
    description: compareDatasetsDescription,
    load: () => import('./nodes/CompareDatasets/CompareDatasets.node.js').then((m) => m.CompareDatasets),
  },
  {
    type: `nomops.${dateTimeDescription.name}`,
    description: dateTimeDescription,
    load: () => import('./nodes/DateTime/DateTime.node.js').then((m) => m.DateTime),
  },
  {
    type: `nomops.${cryptoDescription.name}`,
    description: cryptoDescription,
    load: () => import('./nodes/Crypto/Crypto.node.js').then((m) => m.Crypto),
  },
  {
    type: `nomops.${htmlDescription.name}`,
    description: htmlDescription,
    load: () => import('./nodes/Html/Html.node.js').then((m) => m.Html),
  },
  {
    type: `nomops.${xmlDescription.name}`,
    description: xmlDescription,
    load: () => import('./nodes/Xml/Xml.node.js').then((m) => m.Xml),
  },
  {
    type: `nomops.${markdownDescription.name}`,
    description: markdownDescription,
    load: () => import('./nodes/Markdown/Markdown.node.js').then((m) => m.Markdown),
  },
  {
    type: `nomops.${readWriteFileDescription.name}`,
    description: readWriteFileDescription,
    load: () => import('./nodes/ReadWriteFile/ReadWriteFile.node.js').then((m) => m.ReadWriteFile),
  },
  {
    type: `nomops.${extractFromFileDescription.name}`,
    description: extractFromFileDescription,
    load: () => import('./nodes/ExtractFromFile/ExtractFromFile.node.js').then((m) => m.ExtractFromFile),
  },
  {
    type: `nomops.${convertToFileDescription.name}`,
    description: convertToFileDescription,
    load: () => import('./nodes/ConvertToFile/ConvertToFile.node.js').then((m) => m.ConvertToFile),
  },
  {
    type: `nomops.${compressionDescription.name}`,
    description: compressionDescription,
    load: () => import('./nodes/Compression/Compression.node.js').then((m) => m.Compression),
  },
  {
    type: `nomops.${ftpDescription.name}`,
    description: ftpDescription,
    load: () => import('./nodes/Ftp/Ftp.node.js').then((m) => m.Ftp),
  },
  {
    type: `nomops.${editImageDescription.name}`,
    description: editImageDescription,
    load: () => import('./nodes/EditImage/EditImage.node.js').then((m) => m.EditImage),
  },
  {
    type: `nomops.${sshDescription.name}`,
    description: sshDescription,
    load: () => import('./nodes/Ssh/Ssh.node.js').then((m) => m.Ssh),
  },
  {
    type: `nomops.${sendEmailDescription.name}`,
    description: sendEmailDescription,
    load: () => import('./nodes/SendEmail/SendEmail.node.js').then((m) => m.SendEmail),
  },
  {
    type: `nomops.${emailTriggerDescription.name}`,
    description: emailTriggerDescription,
    load: () => import('./nodes/EmailTrigger/EmailTrigger.node.js').then((m) => m.EmailTrigger),
  },
  {
    type: `nomops.${loopDescription.name}`,
    description: loopDescription,
    load: () => import('./nodes/Loop/Loop.node.js').then((m) => m.Loop),
  },
  {
    type: `nomops.${mergeDescription.name}`,
    description: mergeDescription,
    load: () => import('./nodes/Merge/Merge.node.js').then((m) => m.Merge),
  },
  {
    type: `nomops.${codeDescription.name}`,
    description: codeDescription,
    load: () => import('./nodes/Code/Code.node.js').then((m) => m.Code),
  },
  {
    type: `nomops.${aiTransformDescription.name}`,
    description: aiTransformDescription,
    load: () => import('./nodes/AiTransform/AiTransform.node.js').then((m) => m.AiTransform),
  },
  {
    type: `nomops.${httpRequestDescription.name}`,
    description: httpRequestDescription,
    load: () => import('./nodes/HttpRequest/HttpRequest.node.js').then((m) => m.HttpRequest),
  },
  {
    type: `nomops.${webhookDescription.name}`,
    description: webhookDescription,
    load: () => import('./nodes/Webhook/Webhook.node.js').then((m) => m.Webhook),
  },
  {
    type: `nomops.${scheduleDescription.name}`,
    description: scheduleDescription,
    load: () => import('./nodes/Schedule/Schedule.node.js').then((m) => m.Schedule),
  },
  {
    type: `nomops.${executeWorkflowDescription.name}`,
    description: executeWorkflowDescription,
    load: () => import('./nodes/ExecuteWorkflow/ExecuteWorkflow.node.js').then((m) => m.ExecuteWorkflow),
  },
  {
    type: `nomops.${aiAgentDescription.name}`,
    description: aiAgentDescription,
    load: () => import('./nodes/AiAgent/AiAgent.node.js').then((m) => m.AiAgent),
  },
  {
    type: `nomops.${waitDescription.name}`,
    description: waitDescription,
    load: () => import('./nodes/Wait/Wait.node.js').then((m) => m.Wait),
  },
  {
    type: `nomops.${pollingTriggerDescription.name}`,
    description: pollingTriggerDescription,
    load: () => import('./nodes/PollingTrigger/PollingTrigger.node.js').then((m) => m.PollingTrigger),
  },
  {
    type: `nomops.${chatModelDescription.name}`,
    description: chatModelDescription,
    load: () => import('./nodes/ChatModel/ChatModel.node.js').then((m) => m.ChatModel),
  },
  {
    type: `nomops.${httpToolDescription.name}`,
    description: httpToolDescription,
    load: () => import('./nodes/HttpTool/HttpTool.node.js').then((m) => m.HttpTool),
  },
  {
    type: `nomops.${windowMemoryDescription.name}`,
    description: windowMemoryDescription,
    load: () => import('./nodes/WindowMemory/WindowMemory.node.js').then((m) => m.WindowMemory),
  },
  {
    type: `nomops.${stickyNoteDescription.name}`,
    description: stickyNoteDescription,
    load: () => import('./nodes/StickyNote/StickyNote.node.js').then((m) => m.StickyNote),
  },
  {
    type: `nomops.${formTriggerDescription.name}`,
    description: formTriggerDescription,
    load: () => import('./nodes/FormTrigger/FormTrigger.node.js').then((m) => m.FormTrigger),
  },
  {
    type: `nomops.${formDescription.name}`,
    description: formDescription,
    load: () => import('./nodes/Form/Form.node.js').then((m) => m.Form),
  },
  {
    type: `nomops.${rssFeedReadDescription.name}`,
    description: rssFeedReadDescription,
    load: () => import('./nodes/RssFeedRead/RssFeedRead.node.js').then((m) => m.RssFeedRead),
  },
  {
    type: `nomops.${rssFeedReadTriggerDescription.name}`,
    description: rssFeedReadTriggerDescription,
    load: () => import('./nodes/RssFeedReadTrigger/RssFeedReadTrigger.node.js').then((m) => m.RssFeedReadTrigger),
  },
  {
    type: `nomops.${sseTriggerDescription.name}`,
    description: sseTriggerDescription,
    load: () => import('./nodes/SseTrigger/SseTrigger.node.js').then((m) => m.SseTrigger),
  },
  // 声明式集成节点：纯描述驱动（无 execute），引擎 routing 执行器负责发请求
  ...integrationDescriptions.map(declarative),
];
