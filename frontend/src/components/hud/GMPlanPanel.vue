<script setup lang="ts">
import { ref } from 'vue'
import { Drawer, Button, Tag, Space, Collapse } from 'ant-design-vue'
import { CheckOutlined, DownOutlined, RightOutlined } from '@ant-design/icons-vue'
import type { GMPlan } from '@/types/gm'
import { useLocale } from '@/locales'

const locale = useLocale()

defineProps<{
  plan: GMPlan | null
  visible: boolean
}>()

const emit = defineEmits<{
  approve: []
  close: []
}>()

const reasoningOpen = ref<string[]>([])

function severityColor(severity: string): string {
  return `var(--color-threat-${severity})`
}

function resourceColor(key: string): string {
  const colors: Record<string, string> = {
    food: 'var(--color-food)',
    water: 'var(--color-water)',
    materials: 'var(--color-materials)',
    power: 'var(--color-power)',
  }
  return colors[key] ?? 'var(--ant-color-text)'
}
</script>

<template>
  <Drawer
    :open="visible"
    :title="locale.gm.planTitle"
    placement="right"
    :width="420"
    :closable="true"
    @close="emit('close')"
  >
    <template v-if="plan">
      <div class="gm-panel">
        <!-- Theme -->
        <div class="gm-section">
          <div class="gm-label">{{ locale.gm.theme }}</div>
          <div class="gm-theme-title">{{ plan.roundTheme }}</div>
        </div>

        <!-- Crisis Event -->
        <div
          class="gm-crisis-card"
          :style="{ borderLeftColor: severityColor(plan.crisisEvent.severity) }"
        >
          <div class="gm-crisis-header">
            <Tag
              :style="{
                background: severityColor(plan.crisisEvent.severity),
                color: '#050507',
                border: 'none',
                fontWeight: 700,
                fontSize: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }"
            >
              {{ plan.crisisEvent.severity }}
            </Tag>
            <Tag class="gm-type-tag">{{ plan.crisisEvent.type }}</Tag>
          </div>
          <div class="gm-crisis-label">{{ locale.gm.crisis }}</div>
          <div class="gm-crisis-description">{{ plan.crisisEvent.description }}</div>
        </div>

        <!-- Resource Modifiers -->
        <div class="gm-section">
          <div class="gm-label">{{ locale.gm.resourceModifiers }}</div>
          <div class="gm-resource-grid">
            <div
              v-for="(val, key) in plan.resourceModifiers"
              :key="key"
              class="gm-resource-item"
            >
              <span class="gm-resource-name" :style="{ color: resourceColor(String(key)) }">
                {{ String(key) }}
              </span>
              <span
                class="gm-resource-value"
                :style="{
                  color: (val as number) < 0
                    ? 'var(--ant-color-error)'
                    : 'var(--ant-color-success)',
                }"
              >
                {{ (val as number) > 0 ? '+' : '' }}{{ val }}
              </span>
            </div>
          </div>
        </div>

        <!-- Narration -->
        <div class="gm-section">
          <div class="gm-label">{{ locale.gm.narration }}</div>
          <blockquote class="gm-narration">
            "{{ plan.narration }}"
          </blockquote>
        </div>

        <!-- Reasoning (collapsible) -->
        <Collapse v-model:activeKey="reasoningOpen" ghost>
          <Collapse.Panel key="reasoning" :header="locale.gm.reasoning">
            <template #extra>
              <component
                :is="reasoningOpen.includes('reasoning') ? DownOutlined : RightOutlined"
                class="gm-collapse-icon"
              />
            </template>
            <p class="gm-reasoning">{{ plan.reasoning }}</p>
          </Collapse.Panel>
        </Collapse>

        <!-- Meta Hint -->
        <div v-if="plan.metaHint" class="gm-meta-hint">
          <div class="gm-label">{{ locale.gm.metaHint }}</div>
          <p class="gm-meta-hint-text">{{ plan.metaHint }}</p>
        </div>
      </div>
    </template>

    <template #footer>
      <Space class="w-full justify-end">
        <Button @click="emit('close')">{{ locale.gm.dismiss }}</Button>
        <Button type="primary" size="large" @click="emit('approve')">
          <template #icon><CheckOutlined /></template>
          {{ locale.gm.approve }}
        </Button>
      </Space>
    </template>
  </Drawer>
</template>

<style scoped>
.gm-panel {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.gm-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.gm-label {
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ant-color-text-tertiary);
}

.gm-theme-title {
  font-family: var(--font-display);
  font-size: 20px;
  font-weight: 600;
  color: var(--ant-color-text);
}

/* Crisis card */
.gm-crisis-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--ant-color-border);
  border-left: 3px solid;
  border-radius: 8px;
  padding: 16px;
}

.gm-crisis-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.gm-type-tag {
  text-transform: capitalize;
}

.gm-crisis-label {
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ant-color-text-tertiary);
  margin-bottom: 4px;
}

.gm-crisis-description {
  color: var(--ant-color-text);
  line-height: 1.6;
}

/* Resource grid */
.gm-resource-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.gm-resource-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--ant-color-border);
  border-radius: 6px;
}

.gm-resource-name {
  font-family: var(--font-mono);
  font-size: 12px;
  text-transform: capitalize;
  font-weight: 500;
}

.gm-resource-value {
  font-family: var(--font-mono);
  font-size: 14px;
  font-weight: 700;
}

/* Narration */
.gm-narration {
  margin: 0;
  padding: 12px 16px;
  border-left: 2px solid var(--ant-color-border);
  color: var(--ant-color-text-secondary);
  font-style: italic;
  line-height: 1.6;
}

/* Reasoning */
.gm-reasoning {
  margin: 0;
  color: var(--ant-color-text-tertiary);
  font-size: 13px;
  line-height: 1.5;
}

.gm-collapse-icon {
  color: var(--ant-color-text-tertiary);
  font-size: 10px;
}

/* Meta hint */
.gm-meta-hint {
  padding: 12px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--color-accent) 20%, transparent);
  background: color-mix(in srgb, var(--color-accent) 4%, transparent);
}

.gm-meta-hint-text {
  margin: 0;
  color: var(--color-accent-dim);
  font-size: 13px;
  font-style: italic;
  line-height: 1.5;
}
</style>
