export type TrashGuardItem = { from: string; to: string }

declare module 'claude-code' {
  interface PluginState {
    'trash-guard': { moved: TrashGuardItem[] }
  }
}
