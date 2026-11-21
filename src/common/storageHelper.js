import storage from '@system.storage'
import { MATCH_MODES, MAX_UNDO_STACK, createInitialState } from './scoreboard'
import { DEFAULT_THRESHOLDS, normalizeThresholds } from './swingClassifier'

const SETTINGS_KEY = 'badminton_settings'
const STATS_KEY = 'badminton_stats'
const SCORE_KEY = 'badminton_score'
const MATCHES_KEY = 'badminton_matches'
const MAX_HISTORY_ITEMS = 20
const MAX_MATCH_RECORDS = 20

const DEFAULT_SETTINGS = {
  calibrationFactor: 2.2,
  sensitivity: 'medium',
  vibrate: true,
  keepScreenOn: true,
  minValidSpeed: DEFAULT_THRESHOLDS.minValidSpeed,
  clearThreshold: DEFAULT_THRESHOLDS.clearThreshold,
  smashThreshold: DEFAULT_THRESHOLDS.smashThreshold
}

const DEFAULT_STATS = {
  bestSpeed: 0,
  totalSwings: 0,
  sumSpeed: 0,
  history: []
}

function cloneFallback(fallback) {
  return Array.isArray(fallback) ? fallback.slice() : Object.assign({}, fallback)
}

function readJson(key, fallback) {
  return new Promise((resolve) => {
    storage.get({
      key,
      success(data) {
        if (!data) {
          resolve(cloneFallback(fallback))
          return
        }
        try {
          const parsed = JSON.parse(data)
          if (Array.isArray(fallback)) {
            resolve(Array.isArray(parsed) ? parsed : [])
          } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            resolve(Object.assign({}, fallback, parsed))
          } else {
            resolve(cloneFallback(fallback))
          }
        } catch (err) {
          resolve(cloneFallback(fallback))
        }
      },
      fail() {
        resolve(cloneFallback(fallback))
      }
    })
  })
}

function writeJson(key, value) {
  return new Promise((resolve) => {
    storage.set({
      key,
      value: JSON.stringify(value),
      success() {
        resolve(true)
      },
      fail() {
        resolve(false)
      }
    })
  })
}

function normalizeSettings(raw = {}) {
  const data = raw && typeof raw === 'object' ? raw : {}
  const k = Number(data.calibrationFactor)
  const calibrationFactor =
    Number.isFinite(k) && k >= 1.0 && k <= 4.0 ? Math.round(k * 10) / 10 : 2.2
  const sensitivity =
    data.sensitivity === 'low' || data.sensitivity === 'medium' || data.sensitivity === 'high'
      ? data.sensitivity
      : 'medium'
  const thresholds = normalizeThresholds(data)

  return {
    calibrationFactor,
    sensitivity,
    vibrate: data.vibrate !== false,
    keepScreenOn: data.keepScreenOn !== false,
    minValidSpeed: thresholds.minValidSpeed,
    clearThreshold: thresholds.clearThreshold,
    smashThreshold: thresholds.smashThreshold
  }
}

export async function loadSettings() {
  const data = await readJson(SETTINGS_KEY, DEFAULT_SETTINGS)
  return normalizeSettings(data)
}

export async function saveSettings(settings) {
  const normalized = normalizeSettings({
    calibrationFactor:
      Math.round(Math.max(1.0, Math.min(4.0, Number(settings.calibrationFactor) || 2.2)) * 10) / 10,
    sensitivity: settings.sensitivity || 'medium',
    vibrate: Boolean(settings.vibrate),
    keepScreenOn: Boolean(settings.keepScreenOn),
    minValidSpeed: settings.minValidSpeed,
    clearThreshold: settings.clearThreshold,
    smashThreshold: settings.smashThreshold
  })
  await writeJson(SETTINGS_KEY, normalized)
  return normalized
}

export async function resetSettingsToDefault() {
  const defaults = Object.assign({}, DEFAULT_SETTINGS)
  await writeJson(SETTINGS_KEY, defaults)
  return defaults
}

export async function loadMatchRecords() {
  const list = await readJson(MATCHES_KEY, [])
  if (!Array.isArray(list)) {
    return []
  }
  return list
    .filter((item) => item && typeof item === 'object' && item.id)
    .slice(0, MAX_MATCH_RECORDS)
}

export async function saveMatchRecord(record) {
  if (!record || !record.id) {
    return loadMatchRecords()
  }
  const current = await loadMatchRecords()
  const filtered = current.filter((item) => item && item.id !== record.id)
  const updated = [record].concat(filtered).slice(0, MAX_MATCH_RECORDS)
  await writeJson(MATCHES_KEY, updated)
  return updated
}

export async function getMatchRecordById(id) {
  if (!id) {
    return null
  }
  const records = await loadMatchRecords()
  return records.find((item) => item.id === id) || null
}

export async function deleteMatchRecord(id) {
  const current = await loadMatchRecords()
  const updated = current.filter((item) => item.id !== id)
  await writeJson(MATCHES_KEY, updated)
  return updated
}

export async function clearMatchRecords() {
  await writeJson(MATCHES_KEY, [])
  return []
}

export async function loadStats() {
  const data = await readJson(STATS_KEY, DEFAULT_STATS)
  return {
    bestSpeed: Number(data.bestSpeed) || 0,
    totalSwings: Number(data.totalSwings) || 0,
    sumSpeed: Number(data.sumSpeed) || 0,
    history: Array.isArray(data.history) ? data.history.slice(0, MAX_HISTORY_ITEMS) : []
  }
}

export async function saveStats(stats) {
  const normalized = {
    bestSpeed: Math.round((Number(stats.bestSpeed) || 0) * 10) / 10,
    totalSwings: Math.max(0, Math.floor(Number(stats.totalSwings) || 0)),
    sumSpeed: Math.round((Number(stats.sumSpeed) || 0) * 10) / 10,
    history: Array.isArray(stats.history) ? stats.history.slice(0, MAX_HISTORY_ITEMS) : []
  }
  await writeJson(STATS_KEY, normalized)
  return normalized
}

export async function clearHistory() {
  const current = await loadStats()
  const updated = {
    bestSpeed: current.bestSpeed,
    totalSwings: 0,
    sumSpeed: 0,
    history: []
  }
  await saveStats(updated)
  return updated
}

export async function resetBest() {
  const current = await loadStats()
  const updated = {
    bestSpeed: 0,
    totalSwings: current.totalSwings,
    sumSpeed: current.sumSpeed,
    history: current.history
  }
  await saveStats(updated)
  return updated
}

function normalizeScoreState(raw) {
  const base = createInitialState(raw && MATCH_MODES[raw.mode] ? raw.mode : '21')
  if (!raw || typeof raw !== 'object') {
    return base
  }
  return {
    mode: base.mode,
    myScore: Math.max(0, Math.floor(Number(raw.myScore) || 0)),
    oppScore: Math.max(0, Math.floor(Number(raw.oppScore) || 0)),
    myGames: Math.max(0, Math.floor(Number(raw.myGames) || 0)),
    oppGames: Math.max(0, Math.floor(Number(raw.oppGames) || 0)),
    server: raw.server === 'opp' ? 'opp' : 'my',
    swapped: Boolean(raw.swapped),
    winner: raw.winner === 'my' || raw.winner === 'opp' ? raw.winner : null,
    undoStack: Array.isArray(raw.undoStack) ? raw.undoStack.slice(-MAX_UNDO_STACK) : []
  }
}

export async function loadScoreState() {
  const data = await readJson(SCORE_KEY, createInitialState('21'))
  return normalizeScoreState(data)
}

export async function saveScoreState(state) {
  const normalized = normalizeScoreState(state)
  await writeJson(SCORE_KEY, normalized)
  return normalized
}

export { DEFAULT_SETTINGS, DEFAULT_STATS, MAX_HISTORY_ITEMS, MAX_MATCH_RECORDS }
