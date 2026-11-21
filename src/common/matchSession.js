const { DEFAULT_THRESHOLDS, normalizeThresholds, classifySwing } = require('./swingClassifier')

const MAX_SWINGS_PER_MATCH = 120

/**
 * 创建单局对局采样会话
 */
function createMatchSession(modeId = '21', thresholds = DEFAULT_THRESHOLDS, startedAt = Date.now()) {
  const ts = typeof startedAt === 'number' && Number.isFinite(startedAt) ? startedAt : Date.now()
  return {
    id: `match_${ts}`,
    version: 1,
    startedAt: ts,
    mode: modeId || '21',
    thresholdsSnapshot: normalizeThresholds(thresholds),
    totalSwings: 0,
    smashCount: 0,
    clearCount: 0,
    normalCount: 0,
    invalidCount: 0,
    sumSpeed: 0,
    maxSpeedKmh: 0,
    lastSwing: null,
    swings: []
  }
}

/**
 * 将单次检测到的挥拍记入当前对局会话
 */
function recordMatchSwing(session, swingResult, thresholds) {
  const activeThresholds = thresholds ? normalizeThresholds(thresholds) : session.thresholdsSnapshot
  const speed = swingResult && typeof swingResult.speedKmh === 'number' ? swingResult.speedKmh : NaN
  const classification = classifySwing(speed, activeThresholds)

  if (!classification.isValid) {
    return {
      session: Object.assign({}, session, {
        invalidCount: (session.invalidCount || 0) + 1
      }),
      classification,
      recorded: false
    }
  }

  const ts =
    swingResult && typeof swingResult.timestamp === 'number' && Number.isFinite(swingResult.timestamp)
      ? swingResult.timestamp
      : Date.now()
  const peakG = swingResult && Number.isFinite(Number(swingResult.peakG)) ? Number(swingResult.peakG) : 0
  const durationMs =
    swingResult && Number.isFinite(Number(swingResult.durationMs)) ? Number(swingResult.durationMs) : 0

  const nextSwings = Array.isArray(session.swings) ? session.swings.slice() : []
  if (nextSwings.length < MAX_SWINGS_PER_MATCH) {
    nextSwings.push({
      t: Math.max(0, ts - session.startedAt),
      speedKmh: classification.speedKmh,
      peakG,
      durationMs,
      type: classification.type
    })
  }

  const nextTotal = (session.totalSwings || 0) + 1
  const nextSumSpeed = Math.round(((session.sumSpeed || 0) + classification.speedKmh) * 10) / 10
  const nextMaxSpeed = Math.max(session.maxSpeedKmh || 0, classification.speedKmh)

  const nextSession = Object.assign({}, session, {
    thresholdsSnapshot: activeThresholds,
    totalSwings: nextTotal,
    smashCount: (session.smashCount || 0) + (classification.type === 'smash' ? 1 : 0),
    clearCount: (session.clearCount || 0) + (classification.type === 'clear' ? 1 : 0),
    normalCount: (session.normalCount || 0) + (classification.type === 'normal' ? 1 : 0),
    sumSpeed: nextSumSpeed,
    maxSpeedKmh: Math.round(nextMaxSpeed * 10) / 10,
    lastSwing: {
      speedKmh: classification.speedKmh,
      peakG,
      durationMs,
      type: classification.type,
      label: classification.label,
      timestamp: ts
    },
    swings: nextSwings
  })

  return {
    session: nextSession,
    classification,
    recorded: true
  }
}

/**
 * 生成可本地持久化及同步手机端查看的单局结算记录
 */
function finalizeMatchRecord(session, scoreState, endedAt = Date.now(), endReason = 'manual') {
  const endTs = typeof endedAt === 'number' && Number.isFinite(endedAt) ? endedAt : Date.now()
  const startTs = session && Number.isFinite(session.startedAt) ? session.startedAt : endTs
  const durationSec = Math.max(0, Math.round((endTs - startTs) / 1000))

  const myScore = Math.max(0, Math.floor(Number(scoreState && scoreState.myScore) || 0))
  const oppScore = Math.max(0, Math.floor(Number(scoreState && scoreState.oppScore) || 0))

  let winner = 'draw'
  if (scoreState && (scoreState.winner === 'my' || scoreState.winner === 'opp')) {
    winner = scoreState.winner
  } else if (myScore > oppScore) {
    winner = 'my'
  } else if (oppScore > myScore) {
    winner = 'opp'
  }

  const totalSwings = Math.max(0, Math.floor(Number(session && session.totalSwings) || 0))
  const sumSpeed = Number(session && session.sumSpeed) || 0
  const avgSpeedKmh = totalSwings > 0 ? Math.round((sumSpeed / totalSwings) * 10) / 10 : 0
  const maxSpeedKmh = Math.round((Number(session && session.maxSpeedKmh) || 0) * 10) / 10

  return {
    id: (session && session.id) || `match_${startTs}`,
    version: 1,
    startedAt: startTs,
    endedAt: endTs,
    durationSec,
    mode: (scoreState && scoreState.mode) || (session && session.mode) || '21',
    myScore,
    oppScore,
    winner,
    endReason: endReason || 'manual',
    thresholdsSnapshot: normalizeThresholds(session && session.thresholdsSnapshot),
    summary: {
      totalSwings,
      smashCount: Math.max(0, Math.floor(Number(session && session.smashCount) || 0)),
      clearCount: Math.max(0, Math.floor(Number(session && session.clearCount) || 0)),
      normalCount: Math.max(0, Math.floor(Number(session && session.normalCount) || 0)),
      maxSpeedKmh,
      avgSpeedKmh
    },
    swings: Array.isArray(session && session.swings)
      ? session.swings.slice(0, MAX_SWINGS_PER_MATCH)
      : []
  }
}

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`
}

/**
 * 格式化时长 (MM:SS 或 H:MM:SS)
 */
function formatDuration(durationSec) {
  const total = Math.max(0, Math.floor(Number(durationSec) || 0))
  const hours = Math.floor(total / 3600)
  const mins = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) {
    return `${hours}:${pad2(mins)}:${pad2(secs)}`
  }
  return `${pad2(mins)}:${pad2(secs)}`
}

/**
 * 格式化对局时间戳 (MM-DD HH:mm)
 */
function formatMatchTime(timestampMs) {
  const ts = Number(timestampMs)
  if (!Number.isFinite(ts) || ts <= 0) {
    return '--'
  }
  const d = new Date(ts)
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

module.exports = {
  MAX_SWINGS_PER_MATCH,
  createMatchSession,
  recordMatchSwing,
  finalizeMatchRecord,
  formatDuration,
  formatMatchTime
}
