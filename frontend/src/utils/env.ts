/**
 * Jest-compatible dev mode check. Vite statically replaces `import.meta.env.DEV`
 * at build time (not available at runtime), so we check `process.env` first
 * (works in Node/Jest) and fall back to a globalThis check for edge cases.
 * In production Vite builds, both branches return false.
 */
export function isDevMode(): boolean {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') return true
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!(globalThis as any).import_meta_env?.DEV
}
