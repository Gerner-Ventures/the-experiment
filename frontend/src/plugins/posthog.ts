import posthog from 'posthog-js'
import type { App } from 'vue'

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string) || 'https://us.posthog.com'

export function initPostHog(_app: App): void {
  if (!POSTHOG_KEY) return

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
  })

  window.addEventListener('error', (event) => {
    posthog.capture('$exception', {
      $exception_message: event.message,
      $exception_source: event.filename,
      $exception_lineno: event.lineno,
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    posthog.capture('$exception', {
      $exception_message: String(event.reason),
      $exception_type: 'unhandled_promise_rejection',
    })
  })
}

export { posthog }
