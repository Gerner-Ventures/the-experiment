<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import type { HDPoseName } from '@/config/sprites/hd/types'
import { renderCharacter } from '@/config/sprites/hd/render'
import { HD_SILLY_ANIMATIONS } from '@/config/sprites/hd/animations'

const props = withDefaults(defineProps<{
  sprite: { id: string }
  scale?: number
  animate?: boolean
}>(), {
  scale: 3,
  animate: false,
})

const canvas = ref<HTMLCanvasElement>()
const timers: ReturnType<typeof setTimeout>[] = []
let animating = false

function draw(pose: HDPoseName = 'idle') {
  if (!canvas.value) return
  const ctx = canvas.value.getContext('2d')
  if (!ctx) return

  const pixels = renderCharacter(props.sprite, pose)
  const w = pixels[0].length
  const h = pixels.length

  canvas.value.width = w * props.scale
  canvas.value.height = h * props.scale

  ctx.clearRect(0, 0, canvas.value.width, canvas.value.height)
  ctx.imageSmoothingEnabled = false

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const color = pixels[y][x]
      if (color) {
        ctx.fillStyle = color
        ctx.fillRect(x * props.scale, y * props.scale, props.scale, props.scale)
      }
    }
  }
}

function playRandomAnimation() {
  if (!props.animate || animating) return
  animating = true

  const anim = HD_SILLY_ANIMATIONS[Math.floor(Math.random() * HD_SILLY_ANIMATIONS.length)]
  let frameIdx = 0
  const frameMs = Math.round(1000 / (60 * anim.speed))

  function nextFrame() {
    if (frameIdx >= anim.poses.length) {
      animating = false
      if (props.animate) {
        timers.push(setTimeout(playRandomAnimation, 1500 + Math.random() * 2500))
      }
      return
    }
    draw(anim.poses[frameIdx])
    frameIdx++
    timers.push(setTimeout(nextFrame, frameMs))
  }

  nextFrame()
}

function startAnimationLoop() {
  clearTimers()
  draw('idle')
  if (props.animate) {
    timers.push(setTimeout(playRandomAnimation, 500 + Math.random() * 1000))
  }
}

function clearTimers() {
  animating = false
  timers.forEach(clearTimeout)
  timers.length = 0
}

onMounted(() => {
  if (props.animate) {
    startAnimationLoop()
  } else {
    draw()
  }
})

watch(() => props.animate, (val) => {
  if (val) {
    startAnimationLoop()
  } else {
    clearTimers()
    draw('idle')
  }
})

watch(() => props.sprite, () => {
  if (props.animate) {
    startAnimationLoop()
  } else {
    draw()
  }
})

onUnmounted(clearTimers)
</script>

<template>
  <canvas
    ref="canvas"
    class="block"
    :style="{ imageRendering: 'pixelated' }"
  />
</template>
