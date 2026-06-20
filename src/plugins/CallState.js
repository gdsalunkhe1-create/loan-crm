/* eslint-disable */
import { registerPlugin } from '@capacitor/core'

/**
 * Custom inline Capacitor plugin for call-state detection.
 *
 * Usage:
 *   CallState.startListening()          – requests permission + starts callback
 *   CallState.stopListening()           – unregisters callback
 *   CallState.addListener('callStateChanged', cb)  – cb receives { state: 'RINGING'|'OFFHOOK'|'IDLE' }
 */
const CallState = registerPlugin('CallState', {
  // Minimal web stub so the app doesn't crash when opened in a browser
  web: () => ({
    startListening: async () => { console.warn('CallState: web stub') },
    stopListening:  async () => {},
    addListener:    async (_event, _cb) => ({ remove: async () => {} }),
  }),
})

export default CallState
