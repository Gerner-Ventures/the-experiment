<script setup lang="ts">
import { Card, Button, Typography, Flex, Space, Progress } from 'ant-design-vue'
import { getArcPresets } from '@/config/arc-presets'
import { useLocale } from '@/locales'

const locale = useLocale()
const selectedArc = defineModel<string>({ required: true })
const arcPresets = getArcPresets()
</script>

<template>
  <Card size="small" class="!border-white/[0.06]">
    <template #title>
      <span class="font-mono text-xs text-white/40 uppercase tracking-widest">
        {{ locale.arcs.title }}
      </span>
    </template>

    <Space direction="vertical" :size="8" class="w-full">
      <div
        v-for="arc in arcPresets"
        :key="arc.id"
        class="p-3 rounded-lg border cursor-pointer transition-all duration-200"
        :class="
          selectedArc === arc.id
            ? 'bg-accent/[0.06] border-accent/25'
            : 'bg-white/[0.04] border-white/[0.10] hover:bg-white/[0.07] hover:border-white/[0.18]'
        "
        @click="selectedArc = arc.id"
      >
        <Flex justify="space-between" align="center" class="mb-1">
          <Typography.Text
            strong
            class="!text-sm"
            :class="selectedArc === arc.id ? '!text-accent' : '!text-white/80'"
          >
            {{ arc.name }}
          </Typography.Text>
          <Typography.Text class="font-mono !text-[10px] !text-white/20">
            {{ arc.acts }} {{ locale.arcs.actsSuffix }}
          </Typography.Text>
        </Flex>

        <Typography.Text class="!text-xs !text-white/40 block mb-2">
          {{ arc.description }}
        </Typography.Text>

        <!-- Timeline bar -->
        <Flex :gap="2" class="h-1.5 rounded-full overflow-hidden">
          <div
            v-for="act in arc.timeline"
            :key="act.name"
            class="flex-1 rounded-full"
            :style="{ backgroundColor: act.color + '33' }"
          />
        </Flex>

        <!-- Expanded details -->
        <Transition name="fade">
          <div v-if="selectedArc === arc.id" class="mt-3 space-y-1">
            <Flex
              v-for="act in arc.timeline"
              :key="act.name"
              align="center"
              :gap="12"
              class="font-mono text-[11px]"
            >
              <span class="text-white/20 w-12 shrink-0">{{ act.rounds }}</span>
              <div class="w-1.5 h-1.5 rounded-full shrink-0" :style="{ backgroundColor: act.color }" />
              <span class="text-white/50">{{ act.name }}</span>
              <span class="text-white/20 ml-auto">{{ act.tone }}</span>
            </Flex>
          </div>
        </Transition>
      </div>

      <Button block type="dashed" size="small" class="!text-white/20 !border-white/[0.06]">
        {{ locale.arcs.customArc }}
      </Button>
    </Space>
  </Card>
</template>
