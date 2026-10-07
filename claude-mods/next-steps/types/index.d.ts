export type NextStepsList = string[]

declare module 'claude-code' {
  interface PluginState {
    'next-steps': { suggestions: NextStepsList; isLoading: boolean }
  }
}
