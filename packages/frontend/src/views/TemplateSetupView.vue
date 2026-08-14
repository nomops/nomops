<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  api,
  type CredentialView,
  type TemplateCredentialRequirement,
  type TemplateSummary,
  type WorkflowRow,
} from '../api/client.js';
import CredentialModal from '../components/credentials/CredentialModal.vue';
import UiState from '../components/ui/UiState.vue';
import { chooseTemplateCredential } from '../lib/template-setup.js';
import { useUiStore } from '../stores/ui.js';

const route = useRoute();
const router = useRouter();
const ui = useUiStore();
const templateId = computed(() => String(route.params['id'] ?? ''));
const workflowId = computed(() => String(route.query['workflow'] ?? ''));

const template = ref<TemplateSummary | null>(null);
const workflow = ref<WorkflowRow | null>(null);
const credentials = ref<CredentialView[]>([]);
const selections = ref<Record<string, string>>({});
const autoSelected = ref<Set<string>>(new Set());
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const createFor = ref<TemplateCredentialRequirement | null>(null);

function availableCredentials(requirement: TemplateCredentialRequirement): CredentialView[] {
  return credentials.value
    .filter((credential) => credential.type === requirement.credentialType)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function setSelection(requirementId: string, credentialId: string) {
  selections.value = { ...selections.value, [requirementId]: credentialId };
  const next = new Set(autoSelected.value);
  next.delete(requirementId);
  autoSelected.value = next;
}

async function load() {
  loading.value = true;
  error.value = '';
  if (!workflowId.value) {
    error.value = 'Missing imported workflow. Return to Templates and import this template again.';
    loading.value = false;
    return;
  }
  try {
    const [templateResult, workflowResult, credentialResult] = await Promise.all([
      api.templates.get(templateId.value),
      api.workflows.get(workflowId.value),
      api.credentials.list(),
    ]);
    template.value = templateResult;
    workflow.value = workflowResult;
    credentials.value = credentialResult;
    const nextSelections: Record<string, string> = {};
    const nextAuto = new Set<string>();
    for (const requirement of templateResult.credentialRequirements) {
      const selected = chooseTemplateCredential(requirement, credentialResult);
      if (!selected) continue;
      nextSelections[requirement.id] = selected.id;
      nextAuto.add(requirement.id);
    }
    selections.value = nextSelections;
    autoSelected.value = nextAuto;
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const complete = computed(() =>
  Boolean(template.value) && template.value!.credentialRequirements.every(
    (requirement) => Boolean(selections.value[requirement.id]),
  ),
);

function openWorkflow() {
  if (workflow.value) void router.push({ name: 'canvas', params: { id: workflow.value.id } });
}

async function applySetup() {
  if (!workflow.value || !complete.value || saving.value) return;
  saving.value = true;
  error.value = '';
  try {
    await api.templates.setup(templateId.value, {
      workflowId: workflow.value.id,
      selections: selections.value,
    });
    ui.notify({ kind: 'success', title: 'Template setup complete', message: workflow.value.name });
    openWorkflow();
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    saving.value = false;
  }
}

function onCredentialCreated(credential: CredentialView) {
  credentials.value = [...credentials.value.filter((entry) => entry.id !== credential.id), credential];
  if (createFor.value) setSelection(createFor.value.id, credential.id);
  createFor.value = null;
}
</script>

<template>
  <main class="setup-page" data-test="template-setup">
    <UiState
      v-if="loading"
      kind="loading"
      title="Preparing template setup"
      description="Checking required credentials and existing project connections."
    />
    <UiState
      v-else-if="error && !template"
      kind="error"
      title="Could not prepare this template"
      :description="error"
      data-test="template-setup-error"
    >
      <button type="button" @click="load">Retry</button>
    </UiState>

    <template v-else-if="template && workflow">
      <header class="setup-head">
        <div>
          <p class="eyebrow">Template setup</p>
          <h1>Connect credentials for {{ template.name }}</h1>
          <p>{{ template.description }}</p>
        </div>
        <span class="progress" data-test="setup-progress">
          {{ Object.values(selections).filter(Boolean).length }} / {{ template.credentialRequirements.length }} ready
        </span>
      </header>

      <p v-if="error" class="setup-error" role="alert">{{ error }}</p>

      <section v-if="template.credentialRequirements.length" class="setup-cards" aria-label="Credential requirements">
        <article
          v-for="requirement in template.credentialRequirements"
          :key="requirement.id"
          class="setup-card"
          :data-test-requirement="requirement.id"
        >
          <div class="card-copy">
            <span class="step-check" :class="{ done: selections[requirement.id] }" aria-hidden="true">
              {{ selections[requirement.id] ? '✓' : '•' }}
            </span>
            <div>
              <h2>{{ requirement.credentialName }}</h2>
              <p>
                Used by {{ requirement.nodeNames.length }} node{{ requirement.nodeNames.length === 1 ? '' : 's' }}:
                {{ requirement.nodeNames.join(', ') }}
              </p>
            </div>
          </div>
          <label :for="`credential-${requirement.id}`">Credential</label>
          <select
            :id="`credential-${requirement.id}`"
            :value="selections[requirement.id] ?? ''"
            :data-test-credential="requirement.id"
            @change="setSelection(requirement.id, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">Select a credential</option>
            <option
              v-for="credential in availableCredentials(requirement)"
              :key="credential.id"
              :value="credential.id"
            >
              {{ credential.name }}
            </option>
          </select>
          <div class="card-foot">
            <span v-if="autoSelected.has(requirement.id)" class="auto-note">Selected automatically — only one unambiguous match</span>
            <span v-else-if="selections[requirement.id]" class="auto-note">Credential ready</span>
            <span v-else-if="availableCredentials(requirement).length === 0" class="missing-note">No matching credential exists yet</span>
            <span v-else />
            <button type="button" class="link-button" @click="createFor = requirement">Create new</button>
          </div>
        </article>
      </section>

      <UiState
        v-else
        compact
        title="No credentials required"
        description="This workflow is ready to open and run."
      />

      <footer class="setup-actions">
        <button type="button" class="secondary" data-test="skip-template-setup" @click="openWorkflow">
          Skip setup
        </button>
        <button
          type="button"
          class="primary"
          data-test="apply-template-setup"
          :disabled="!complete || saving"
          @click="applySetup"
        >
          {{ saving ? 'Applying…' : 'Apply and open workflow' }}
        </button>
      </footer>
    </template>

    <CredentialModal
      v-if="createFor"
      :create-type="createFor.credentialType"
      @created="onCredentialCreated"
      @close="createFor = null"
    />
  </main>
</template>

<style scoped>
.setup-page { width: min(880px, calc(100% - 48px)); margin: 0 auto; padding: 48px 0 64px; }
.setup-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 26px; }
.eyebrow { margin: 0 0 7px; color: var(--color--primary); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; }
.setup-head h1 { margin: 0; color: var(--color--text--shade-1); font-size: 25px; font-weight: 600; }
.setup-head p:not(.eyebrow) { max-width: 650px; margin: 8px 0 0; color: var(--color--text--tint-1); font-size: 14px; line-height: 1.55; }
.progress { flex: none; padding: 6px 10px; border: 1px solid var(--border-color); border-radius: 999px; color: var(--color--text); font-size: 12px; }
.setup-error { padding: 10px 12px; border: 1px solid var(--color--danger); border-radius: var(--radius); color: var(--color--danger); background: color-mix(in srgb, var(--color--danger) 8%, transparent); }
.setup-cards { display: grid; gap: 14px; }
.setup-card { padding: 18px; border: 1px solid var(--border-color); border-radius: var(--radius--lg); background: var(--color--background--light-3); }
.card-copy { display: flex; gap: 12px; margin-bottom: 16px; }
.step-check { display: grid; place-items: center; width: 24px; height: 24px; flex: none; border: 1px solid var(--border-color--strong); border-radius: 50%; color: var(--color--text--tint-1); }
.step-check.done { border-color: var(--color--success); background: var(--color--success); color: #fff; }
.card-copy h2 { margin: 1px 0 5px; color: var(--color--text--shade-1); font-size: 16px; }
.card-copy p { margin: 0; color: var(--color--text--tint-1); font-size: 12.5px; }
.setup-card label { display: block; margin-bottom: 6px; color: var(--color--text); font-size: 12px; }
.setup-card select { width: 100%; height: 38px; padding: 0 11px; border: 1px solid var(--border-color); border-radius: var(--radius); background: var(--color--background--light-2); color: var(--color--text--shade-1); }
.card-foot { display: flex; justify-content: space-between; align-items: center; min-height: 26px; margin-top: 8px; font-size: 11.5px; }
.auto-note { color: var(--color--success); }
.missing-note { color: var(--color--text--tint-1); }
.link-button { border: 0; background: none; color: var(--color--primary); cursor: pointer; }
.setup-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; }
.setup-actions button { height: 38px; padding: 0 16px; border-radius: var(--radius); cursor: pointer; }
.setup-actions .secondary { border: 1px solid var(--border-color); background: transparent; color: var(--color--text); }
.setup-actions .primary { border: 1px solid var(--color--primary); background: var(--color--primary); color: #fff; }
.setup-actions .primary:disabled { opacity: .45; cursor: not-allowed; }
@media (max-width: 680px) {
  .setup-page { width: min(100% - 28px, 880px); padding-top: 28px; }
  .setup-head { flex-direction: column; }
  .setup-actions { flex-direction: column-reverse; }
  .setup-actions button { width: 100%; }
}
</style>
