<script setup lang="ts">
import { ref } from 'vue'
import { Drawer, Button, Tag, Space, Collapse } from 'ant-design-vue'
import { CheckOutlined } from '@ant-design/icons-vue'
import AutoCountdownButton from '@/components/ui/AutoCountdownButton.vue'
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

const VALID_SEVERITIES: readonly string[] = ['low', 'medium', 'high', 'critical']

function severityColor(severity: string): string {
  const key = VALID_SEVERITIES.includes(severity) ? severity : 'critical'
  return `var(--color-threat-${key})`
}

const RESOURCE_COLORS: Record<string, string> = {
  food: 'var(--color-food)',
  water: 'var(--color-water)',
  materials: 'var(--color-materials)',
  power: 'var(--color-power)',
}

function resourceColor(key: string): string {
  return RESOURCE_COLORS[key] ?? 'var(--ant-color-text)'
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
      <div class="flex flex-col gap-5">
        <!-- Theme -->
        <div class="flex flex-col gap-1.5">
          <div class="font-mono text-[11px] uppercase tracking-widest text-[var(--ant-color-text-tertiary)]">{{ locale.gm.theme }}</div>
          <div class="font-display text-xl font-semibold text-[var(--ant-color-text)]">{{ plan.roundTheme }}</div>
        </div>

        <!-- Crisis Event -->
        <div
          class="rounded-lg border border-[var(--ant-color-border)] border-l-[3px] bg-white/[0.03] p-4"
          :style="{ borderLeftColor: severityColor(plan.crisisEvent.severity) }"
        >
          <div class="mb-1 font-mono text-[11px] uppercase tracking-widest text-[var(--ant-color-text-tertiary)]">{{ locale.gm.crisis }}</div>
          <div class="mb-2.5 flex items-center gap-2">
            <Tag
              :style="{
                background: severityColor(plan.crisisEvent.severity),
                color: 'var(--color-void)',
                border: 'none',
                fontWeight: 700,
                fontSize: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }"
            >
              {{ plan.crisisEvent.severity }}
            </Tag>
            <Tag class="capitalize">{{ plan.crisisEvent.type }}</Tag>
          </div>
          <div class="text-[var(--ant-color-text)] leading-relaxed">{{ plan.crisisEvent.description }}</div>
        </div>

        <!-- Resource Modifiers -->
        <div v-if="Object.keys(plan.resourceModifiers).length" class="flex flex-col gap-1.5">
          <div class="font-mono text-[11px] uppercase tracking-widest text-[var(--ant-color-text-tertiary)]">{{ locale.gm.resourceModifiers }}</div>
          <div class="grid grid-cols-2 gap-2">
            <div
              v-for="(val, key) in plan.resourceModifiers"
              :key="key"
              class="flex items-center justify-between rounded-md border border-[var(--ant-color-border)] bg-white/[0.03] px-3 py-2"
            >
              <span class="font-mono text-xs font-medium capitalize" :style="{ color: resourceColor(String(key)) }">
                {{ String(key) }}
              </span>
              <span
                class="font-mono text-sm font-bold"
                :style="{
                  color: (val as number) < 0
                    ? 'var(--ant-color-error)'
                    : (val as number) > 0
                      ? 'var(--ant-color-success)'
                      : 'var(--ant-color-text-secondary)',
                }"
              >
                {{ (val as number) > 0 ? '+' : '' }}{{ val }}
              </span>
            </div>
          </div>
        </div>

        <!-- Narration -->
        <div class="flex flex-col gap-1.5">
          <div class="font-mono text-[11px] uppercase tracking-widest text-[var(--ant-color-text-tertiary)]">{{ locale.gm.narration }}</div>
          <blockquote class="m-0 border-l-2 border-[var(--ant-color-border)] py-3 pl-4 italic leading-relaxed text-[var(--ant-color-text-secondary)]">
            "{{ plan.narration }}"
          </blockquote>
        </div>

        <!-- Reasoning (collapsible) -->
        <Collapse v-model:activeKey="reasoningOpen" ghost>
          <Collapse.Panel key="reasoning" :header="locale.gm.reasoning">
            <p class="m-0 text-[13px] leading-normal text-[var(--ant-color-text-tertiary)]">{{ plan.reasoning }}</p>
          </Collapse.Panel>
        </Collapse>

        <!-- Meta Hint -->
        <div
          v-if="plan.metaHint"
          class="rounded-lg border border-accent/20 bg-accent/[0.04] p-3"
        >
          <div class="font-mono text-[11px] uppercase tracking-widest text-[var(--ant-color-text-tertiary)]">{{ locale.gm.metaHint }}</div>
          <p class="m-0 mt-1.5 text-[13px] italic leading-normal text-accent-dim">{{ plan.metaHint }}</p>
        </div>
      </div>
    </template>

    <template #footer>
      <Space class="w-full justify-end items-center">
        <Button @click="emit('close')">{{ locale.gm.dismiss }}</Button>
        <AutoCountdownButton
          :delay="5000"
          :active="visible"
          type="primary"
          size="large"
          @fire="emit('approve')"
        >
          <template #icon><CheckOutlined /></template>
          {{ locale.gm.approve }}
        </AutoCountdownButton>
      </Space>
    </template>
  </Drawer>
</template>
