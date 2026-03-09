<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Tag } from 'ant-design-vue'
import { HDFrameCache } from '@/config/sprites/hd/cache'
import { getHDSpriteById } from '@/config/sprites/hd/characters'
import { getHDAnimation } from '@/config/sprites/hd/animations'
import type { HDCharacterDef, HDPoseName } from '@/config/sprites/hd/types'
import { HD_GRID_W, HD_GRID_H } from '@/config/sprites/hd/constants'
const CANVAS_SCALE = 2
const TALK_FRAME_MS = 200

const props = defineProps<{
  agentId: string
  agentName: string
  characterId: string
  isSpeaking: boolean
  isThinking: boolean
  showVote: boolean
  vote: string | null
  isExileTarget: boolean
  exilePhase: 'none' | 'flashing' | 'dead' | 'faded'
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const character = computed<HDCharacterDef | null>(() => getHDSpriteById(props.characterId) ?? null)

let talkTimer: ReturnType<typeof setInterval> | null = null
let talkFrame = 0
const talkPoses = getHDAnimation('talk').poses

function drawPose(pose: HDPoseName) {
  const canvas = canvasRef.value
  const char = character.value
  if (!canvas || !char) return

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const srcCanvas = HDFrameCache.get(char, pose)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(srcCanvas, 0, 0, canvas.width, canvas.height)
}

function startTalkCycle() {
  stopTalkCycle()
  talkFrame = 0
  drawPose(talkPoses[0])
  talkTimer = setInterval(() => {
    talkFrame = (talkFrame + 1) % talkPoses.length
    drawPose(talkPoses[talkFrame])
  }, TALK_FRAME_MS)
}

function stopTalkCycle() {
  if (talkTimer) {
    clearInterval(talkTimer)
    talkTimer = null
  }
  talkFrame = 0
}

watch(() => props.isSpeaking, (speaking) => {
  if (speaking) {
    startTalkCycle()
  } else {
    stopTalkCycle()
    drawPose(props.isThinking ? 'think' : 'idle')
  }
})

watch(() => props.isThinking, (thinking) => {
  if (thinking && !props.isSpeaking) {
    stopTalkCycle()
    drawPose('think')
  } else if (!thinking && !props.isSpeaking) {
    drawPose('idle')
  }
})

watch(() => props.exilePhase, (phase) => {
  if (phase === 'dead') {
    stopTalkCycle()
    drawPose('dead')
  }
})

onMounted(() => {
  drawPose('idle')
  if (props.isSpeaking) startTalkCycle()
})

onUnmounted(() => {
  stopTalkCycle()
})
</script>

<template>
  <div
    class="meeting-seat flex flex-col items-center gap-1.5"
    :class="{
      'meeting-seat--speaking': isSpeaking,
      'meeting-seat--thinking': isThinking && !isSpeaking,
      'meeting-seat--exile-flash': exilePhase === 'flashing',
      'meeting-seat--exile-dead': exilePhase === 'dead',
      'meeting-seat--exile-faded': exilePhase === 'faded',
    }"
  >
    <!-- Glow ring behind canvas when speaking -->
    <div class="relative">
      <div
        v-if="isSpeaking"
        class="absolute inset-0 rounded-full bg-accent/20 blur-md animate-pulse"
        style="margin: -8px"
      />
      <div
        v-else-if="isThinking"
        class="absolute inset-0 rounded-full bg-indigo-400/20 blur-md meeting-seat__think-glow"
        style="margin: -8px"
      />
      <canvas
        ref="canvasRef"
        :width="HD_GRID_W * CANVAS_SCALE"
        :height="HD_GRID_H * CANVAS_SCALE"
        class="meeting-seat__canvas"
        :style="{ width: `${HD_GRID_W * CANVAS_SCALE}px`, height: `${HD_GRID_H * CANVAS_SCALE}px` }"
      />
    </div>

    <!-- Name label -->
    <span class="font-mono text-[10px] text-white/60 uppercase tracking-wider text-center leading-tight max-w-[80px] truncate">
      {{ agentName }}
    </span>

    <!-- Vote badge (revealed when agent's vote turn processes) -->
    <Transition name="vote-pop">
      <Tag
        v-if="showVote && vote"
        :color="vote === 'support' ? 'green' : 'red'"
        class="!text-[10px] !px-1.5 !py-0 !leading-tight"
      >
        {{ vote }}
      </Tag>
    </Transition>
  </div>
</template>

<style scoped>
.meeting-seat {
  transition: opacity 0.3s, transform 0.3s;
}

.meeting-seat__canvas {
  image-rendering: pixelated;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
}

.meeting-seat--speaking .meeting-seat__canvas {
  filter: drop-shadow(0 0 8px rgba(var(--color-accent-rgb, 200 180 140), 0.4));
}

.meeting-seat--exile-flash .meeting-seat__canvas {
  animation: exile-flash 0.15s ease-in-out 3;
}

.meeting-seat--exile-dead {
  filter: grayscale(0.8);
}

.meeting-seat--thinking .meeting-seat__canvas {
  filter: drop-shadow(0 0 6px rgba(129, 140, 248, 0.3));
  animation: think-bob 3s ease-in-out infinite;
}

.meeting-seat__think-glow {
  animation: think-glow-pulse 3s ease-in-out infinite;
}

@keyframes think-bob {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  30% { transform: translateY(-2px) rotate(-2deg); }
  70% { transform: translateY(1px) rotate(1deg); }
}

@keyframes think-glow-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}

.meeting-seat--exile-faded {
  opacity: 0;
  transform: scale(0);
  transition: opacity 0.8s, transform 0.8s;
}

@keyframes exile-flash {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(2) sepia(1) saturate(3) hue-rotate(-30deg); }
}

.vote-pop-enter-active {
  animation: pop-in 0.2s ease-out;
}

.vote-pop-leave-active {
  animation: pop-out 0.15s ease-in forwards;
}

@keyframes pop-in {
  0% { transform: scale(0); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes pop-out {
  to { transform: scale(0); opacity: 0; }
}
</style>
