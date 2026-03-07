<script setup lang="ts">
import { Drawer, Button, Tag, Space, Typography, Descriptions } from 'ant-design-vue'
import { CheckOutlined } from '@ant-design/icons-vue'
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

function severityColor(severity: string): string {
  switch (severity) {
    case 'low': return 'green'
    case 'medium': return 'gold'
    case 'high': return 'orange'
    case 'critical': return 'red'
    default: return 'default'
  }
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
      <div class="space-y-4">
        <!-- Theme -->
        <div>
          <Typography.Text class="!text-white/40 font-mono !text-xs uppercase">{{ locale.gm.theme }}</Typography.Text>
          <Typography.Title :level="4" class="!mt-1 !mb-0">{{ plan.roundTheme }}</Typography.Title>
        </div>

        <!-- Crisis Event -->
        <div class="p-3 rounded-lg border border-white/[0.08] bg-white/[0.02]">
          <div class="flex items-center gap-2 mb-2">
            <Typography.Text class="!text-white/40 font-mono !text-xs uppercase">{{ locale.gm.crisis }}</Typography.Text>
            <Tag :color="severityColor(plan.crisisEvent.severity)">
              {{ plan.crisisEvent.severity.toUpperCase() }}
            </Tag>
            <Tag>{{ plan.crisisEvent.type }}</Tag>
          </div>
          <Typography.Paragraph class="!mb-0 !text-white/70">
            {{ plan.crisisEvent.description }}
          </Typography.Paragraph>
        </div>

        <!-- Resource Modifiers -->
        <div>
          <Typography.Text class="!text-white/40 font-mono !text-xs uppercase block mb-1">{{ locale.gm.resourceModifiers }}</Typography.Text>
          <Descriptions :column="2" size="small" bordered>
            <Descriptions.Item v-for="(val, key) in plan.resourceModifiers" :key="key" :label="String(key)">
              <span :class="(val as number) < 0 ? 'text-red-400' : 'text-green-400'">
                {{ (val as number) > 0 ? '+' : '' }}{{ val }}
              </span>
            </Descriptions.Item>
          </Descriptions>
        </div>

        <!-- Narration Preview -->
        <div>
          <Typography.Text class="!text-white/40 font-mono !text-xs uppercase block mb-1">{{ locale.gm.narration }}</Typography.Text>
          <Typography.Paragraph class="!text-white/60 italic">
            "{{ plan.narration }}"
          </Typography.Paragraph>
        </div>

        <!-- Reasoning -->
        <div>
          <Typography.Text class="!text-white/40 font-mono !text-xs uppercase block mb-1">{{ locale.gm.reasoning }}</Typography.Text>
          <Typography.Paragraph class="!text-white/50 !text-sm">
            {{ plan.reasoning }}
          </Typography.Paragraph>
        </div>

        <!-- Meta hint -->
        <div v-if="plan.metaHint">
          <Typography.Text class="!text-white/40 font-mono !text-xs uppercase block mb-1">{{ locale.gm.metaHint }}</Typography.Text>
          <Typography.Paragraph class="!text-accent/60 !text-sm italic">
            {{ plan.metaHint }}
          </Typography.Paragraph>
        </div>
      </div>
    </template>

    <template #footer>
      <Space class="w-full justify-end">
        <Button @click="emit('close')">{{ locale.gm.dismiss }}</Button>
        <Button type="primary" @click="emit('approve')">
          <template #icon><CheckOutlined /></template>
          {{ locale.gm.approve }}
        </Button>
      </Space>
    </template>
  </Drawer>
</template>
