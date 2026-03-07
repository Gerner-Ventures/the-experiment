<script setup lang="ts">
import { computed } from 'vue'
import { Card, Slider, Typography, Flex, Progress } from 'ant-design-vue'
import { useLocale } from '@/locales'
import { RESOURCE_COLORS, type ResourceKey } from '@/config/resources'

const locale = useLocale()
const rounds = defineModel<number>('rounds', { required: true })
const resources = defineModel<number>('resources', { required: true })

const resourceItems = computed(() =>
  (Object.keys(RESOURCE_COLORS) as ResourceKey[]).map((key) => ({
    key,
    label: locale.parameters.resources[key],
    color: RESOURCE_COLORS[key],
    value: resources.value,
  }))
)
</script>

<template>
  <Card size="small" class="!border-white/[0.06]">
    <template #title>
      <span class="font-mono text-xs text-white/40 uppercase tracking-widest">
        {{ locale.parameters.title }}
      </span>
    </template>

    <div class="space-y-6">
      <!-- Rounds -->
      <div>
        <Flex justify="space-between" align="center" class="mb-1">
          <Typography.Text class="font-mono !text-[10px] !text-white/30 uppercase tracking-widest">
            {{ locale.parameters.totalRounds }}
          </Typography.Text>
          <Typography.Text class="font-mono !text-sm !text-accent/70">
            {{ rounds }}
          </Typography.Text>
        </Flex>
        <Slider
          v-model:value="rounds"
          :min="5"
          :max="30"
          :step="1"
          :tooltip="{ formatter: (v: number) => locale.parameters.roundsTooltip.replace('{value}', String(v)) }"
        />
      </div>

      <!-- Starting Resources -->
      <div>
        <Flex justify="space-between" align="center" class="mb-1">
          <Typography.Text class="font-mono !text-[10px] !text-white/30 uppercase tracking-widest">
            {{ locale.parameters.startingResources }}
          </Typography.Text>
          <Typography.Text class="font-mono !text-sm !text-accent/70">
            {{ resources }}%
          </Typography.Text>
        </Flex>
        <Slider
          v-model:value="resources"
          :min="30"
          :max="100"
          :step="5"
          :tooltip="{ formatter: (v: number) => locale.parameters.resourcesTooltip.replace('{value}', String(v)) }"
        />
      </div>

      <!-- Resource breakdown -->
      <div>
        <Typography.Text class="font-mono !text-[10px] !text-white/30 uppercase tracking-widest block mb-3">
          {{ locale.parameters.resourceLevels }}
        </Typography.Text>
        <div class="grid grid-cols-2 gap-2">
          <div
            v-for="item in resourceItems"
            :key="item.key"
            class="flex items-center gap-2 px-2.5 py-2 rounded-md bg-white/[0.05] border border-white/[0.10]"
          >
            <div class="w-1.5 h-1.5 rounded-full shrink-0" :style="{ backgroundColor: item.color }" />
            <span class="font-mono text-[10px] text-white/45">{{ item.label }}</span>
            <span class="font-mono text-[11px] ml-auto" :style="{ color: item.color + 'bb' }">
              {{ item.value }}%
            </span>
          </div>
        </div>
      </div>

      <!-- Threat meter -->
      <div class="p-3 rounded-lg bg-white/[0.04] border border-white/[0.10]">
        <Flex align="center" :gap="8" class="mb-2">
          <div class="w-1.5 h-1.5 rounded-full bg-accent animate-breathe" />
          <Typography.Text class="font-mono !text-[10px] !text-white/30 uppercase tracking-widest">
            {{ locale.parameters.threatLevel }}
          </Typography.Text>
        </Flex>
        <Progress
          :percent="0"
          :show-info="false"
          :stroke-color="'#00e5a0'"
          :trail-color="'rgba(255,255,255,0.04)'"
          size="small"
        />
        <Typography.Text class="font-mono !text-[9px] !text-white/15 block mt-1.5">
          {{ locale.parameters.threatDescription }}
        </Typography.Text>
      </div>
    </div>
  </Card>
</template>
