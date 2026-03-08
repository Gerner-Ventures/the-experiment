<script setup lang="ts">
import { ref } from 'vue'
import {
  Card, Collapse, CollapsePanel, Input,
  Tag, Button, Space, Tooltip, Typography, Flex,
} from 'ant-design-vue'
import {
  PlusOutlined, DeleteOutlined, UserOutlined, CheckCircleFilled,
  ExclamationCircleFilled,
} from '@ant-design/icons-vue'
import type { AgentConfig } from '@/types/agent'
import {
  PERSONALITY_TRAIT_KEYS, GOAL_PRESET_KEYS,
  MAX_PERSONALITY_TRAITS, MIN_AGENTS, MAX_AGENTS, DEFAULT_LLM_MODEL,
  DEFAULT_PERSONALITY_AXES, GOAL_ARCHETYPE_MAP,
  getTraitLabel, getGoalPreset,
  type PersonalityTrait,
} from '@/config/agent-options'
import { CHARACTERS } from '@/config/character-options'
import { getSpriteById } from '@/config/character-sprites'
import PixelCharacter from '@/components/ui/PixelCharacter.vue'
import { useLocale } from '@/locales'

const locale = useLocale()

const agents = defineModel<AgentConfig[]>('agents', { required: true })
const activeKeys = ref<string[]>([])

function getCharacter(id: string) {
  return CHARACTERS.find(c => c.id === id)
}

function usedCharacterIds() {
  return new Set(agents.value.map(a => a.characterId))
}

function selectCharacter(agent: AgentConfig, characterId: string) {
  agent.characterId = characterId
  const char = getCharacter(characterId)
  if (char) {
    agent.name = char.name
  }
}

function toggleTrait(agent: AgentConfig, trait: PersonalityTrait) {
  const idx = agent.personality.indexOf(trait)
  if (idx >= 0) {
    agent.personality.splice(idx, 1)
  } else if (agent.personality.length < MAX_PERSONALITY_TRAITS) {
    agent.personality.push(trait)
  }
}

function addAgent() {
  if (agents.value.length >= MAX_AGENTS) return
  const nextId = String(Date.now())
  const used = usedCharacterIds()
  const nextChar = CHARACTERS.find(c => !used.has(c.id)) ?? CHARACTERS[0]
  const agentIndex = agents.value.length
  const goalKey = GOAL_PRESET_KEYS[agentIndex % GOAL_PRESET_KEYS.length]
  const traitPairs: [number, number][] = [[0,14],[1,7],[2,4],[3,11],[5,12],[6,16]]
  const [t1, t2] = traitPairs[agentIndex % traitPairs.length]
  agents.value.push({
    id: nextId,
    name: nextChar.name,
    characterId: nextChar.id,
    personality: [PERSONALITY_TRAIT_KEYS[t1], PERSONALITY_TRAIT_KEYS[t2]],
    personalityAxes: { ...DEFAULT_PERSONALITY_AXES },
    secretGoal: getGoalPreset(goalKey).goal,
    goalArchetype: GOAL_ARCHETYPE_MAP[goalKey],
    llmModel: DEFAULT_LLM_MODEL,
  })
  activeKeys.value = [nextId]
}

function removeAgent(id: string) {
  if (agents.value.length <= MIN_AGENTS) return
  agents.value = agents.value.filter(a => a.id !== id)
}
</script>

<template>
  <Card
    size="small"
    class="!border-white/[0.06]"
  >
    <template #title>
      <Flex align="center" justify="space-between">
        <span class="font-mono text-xs text-white/40 uppercase tracking-widest">
          {{ locale.agents.title }}
        </span>
        <Space>
          <Typography.Text class="font-mono !text-[10px] !text-white/20">
            {{ agents.length }}/{{ MAX_AGENTS }}
          </Typography.Text>
          <Button
            size="small"
            :disabled="agents.length >= MAX_AGENTS"
            @click="addAgent"
          >
            <template #icon><PlusOutlined /></template>
            {{ locale.agents.add }}
          </Button>
        </Space>
      </Flex>
    </template>

    <Collapse
      v-model:activeKey="activeKeys"
      ghost
      :bordered="false"
    >
      <CollapsePanel
        v-for="agent in agents"
        :key="agent.id"
      >
        <template #header>
          <Flex align="center" :gap="12" class="w-full pr-4">
            <!-- Avatar -->
            <div class="w-10 h-10 rounded bg-elevated border border-white/[0.12] flex items-center justify-center shrink-0 overflow-hidden">
              <PixelCharacter
                v-if="getSpriteById(agent.characterId)"
                :sprite="getSpriteById(agent.characterId)!"
                :scale="2"
              />
            </div>

            <!-- Name -->
            <span class="font-display text-sm text-white/80 w-32 truncate">
              {{ agent.name }}
            </span>

            <!-- Traits -->
            <Flex :gap="4" class="flex-1 overflow-hidden">
              <Tag
                v-for="trait in agent.personality"
                :key="trait"
                class="!text-[10px] !m-0 !bg-accent/10 !text-accent/70 !border-accent/20"
              >
                {{ getTraitLabel(trait) }}
              </Tag>
            </Flex>

            <!-- Status -->
            <Tooltip :title="agent.secretGoal ? locale.agents.statusReady : locale.agents.statusNeedsGoal">
              <CheckCircleFilled v-if="agent.secretGoal" class="!text-accent/50 text-sm" />
              <ExclamationCircleFilled v-else class="!text-threat-medium/60 text-sm" />
            </Tooltip>
          </Flex>
        </template>

        <div class="space-y-5 pl-10">
          <!-- Character picker -->
          <div>
            <label class="font-mono text-[10px] text-white/30 uppercase tracking-widest mb-2 block">
              {{ locale.agents.characterLabel }}
            </label>
            <div class="grid grid-cols-4 gap-2 max-h-80 overflow-y-auto pr-1">
              <div
                v-for="char in CHARACTERS"
                :key="char.id"
                class="relative p-2 rounded-lg border cursor-pointer transition-all duration-150 group"
                :class="
                  agent.characterId === char.id
                    ? 'bg-accent/[0.08] border-accent/30'
                    : usedCharacterIds().has(char.id) && agent.characterId !== char.id
                      ? 'bg-white/[0.02] border-white/[0.06] opacity-30 cursor-not-allowed'
                      : 'bg-white/[0.04] border-white/[0.10] hover:bg-white/[0.08] hover:border-white/[0.20]'
                "
                @click="!usedCharacterIds().has(char.id) || agent.characterId === char.id ? selectCharacter(agent, char.id) : null"
              >
                <div class="flex flex-col items-center text-center">
                  <!-- Pixel sprite -->
                  <div class="mb-1.5">
                    <PixelCharacter
                      v-if="getSpriteById(char.id)"
                      :sprite="getSpriteById(char.id)!"
                      :scale="3"
                      :animate="agent.characterId === char.id"
                    />
                  </div>
                  <div
                    class="font-display text-[11px] leading-tight"
                    :class="agent.characterId === char.id ? 'text-accent' : 'text-white/70'"
                  >
                    {{ char.name }}
                  </div>
                  <div class="font-mono text-[9px] text-white/30 mt-0.5 leading-tight line-clamp-2">
                    {{ char.description }}
                  </div>
                </div>
                <!-- Tags -->
                <Flex :gap="2" justify="center" class="mt-1.5">
                  <span
                    v-for="tag in char.tags"
                    :key="tag"
                    class="font-mono text-[8px] px-1 py-0.5 rounded bg-white/[0.06] text-white/30"
                  >
                    {{ tag }}
                  </span>
                </Flex>
              </div>
            </div>
          </div>

          <!-- Name input -->
          <div>
            <label class="font-mono text-[10px] text-white/30 uppercase tracking-widest mb-1.5 block">
              {{ locale.agents.nameLabel }}
            </label>
            <Input
              v-model:value="agent.name"
              :prefix-icon="UserOutlined"
              :placeholder="locale.agents.namePlaceholder"
              class="max-w-xs"
            />
          </div>

          <!-- Personality traits -->
          <div>
            <label class="font-mono text-[10px] text-white/30 uppercase tracking-widest mb-2 block">
              {{ locale.agents.personalityLabel.replace('{max}', String(MAX_PERSONALITY_TRAITS)) }}
            </label>
            <Flex wrap="wrap" :gap="6">
              <Tag
                v-for="trait in PERSONALITY_TRAIT_KEYS"
                :key="trait"
                class="cursor-pointer select-none !text-[11px]"
                :class="agent.personality.includes(trait)
                  ? '!bg-accent/15 !text-accent !border-accent/30'
                  : '!bg-white/[0.06] !text-white/50 !border-white/[0.12] hover:!bg-white/[0.10] hover:!text-white/70 hover:!border-white/[0.20]'"
                @click="toggleTrait(agent, trait)"
              >
                {{ getTraitLabel(trait) }}
              </Tag>
            </Flex>
          </div>

          <!-- Secret goal -->
          <div>
            <label class="font-mono text-[10px] text-white/30 uppercase tracking-widest mb-2 block">
              {{ locale.agents.goalLabel }}
            </label>
            <Flex wrap="wrap" :gap="6" class="mb-2">
              <Tag
                v-for="key in GOAL_PRESET_KEYS"
                :key="key"
                class="cursor-pointer select-none !text-[10px]"
                :class="agent.secretGoal === getGoalPreset(key).goal
                  ? '!bg-accent/15 !text-accent !border-accent/30'
                  : '!bg-white/[0.06] !text-white/50 !border-white/[0.12] hover:!bg-white/[0.10] hover:!text-white/70 hover:!border-white/[0.20]'"
                @click="agent.secretGoal = getGoalPreset(key).goal; agent.goalArchetype = GOAL_ARCHETYPE_MAP[key]"
              >
                {{ getGoalPreset(key).label }}
              </Tag>
            </Flex>
            <Input.TextArea
              v-model:value="agent.secretGoal"
              :placeholder="locale.agents.goalPlaceholder"
              :rows="2"
              :auto-size="{ minRows: 2, maxRows: 4 }"
            />
          </div>

          <!-- Remove -->
          <Flex align="center" justify="end">
            <Button
              v-if="agents.length > MIN_AGENTS"
              danger
              size="small"
              @click="removeAgent(agent.id)"
            >
              <template #icon><DeleteOutlined /></template>
              {{ locale.agents.remove }}
            </Button>
          </Flex>
        </div>
      </CollapsePanel>
    </Collapse>
  </Card>
</template>
