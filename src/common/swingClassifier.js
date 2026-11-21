const DEFAULT_THRESHOLDS = {
  minValidSpeed: 40,
  clearThreshold: 100,
  smashThreshold: 150
}

const THRESHOLD_LIMITS = {
  minValidSpeed: { min: 10, max: 120, step: 5 },
  clearThreshold: { min: 50, max: 250, step: 5 },
  smashThreshold: { min: 80, max: 350, step: 5 }
}

const SHOT_TYPES = {
  invalid: { type: 'invalid', label: '无效挥拍', shortLabel: '无效', isValid: false },
  normal: { type: 'normal', label: '普通挥拍', shortLabel: '普通', isValid: true },
  clear: { type: 'clear', label: '高远球', shortLabel: '高远', isValid: true },
  smash: { type: 'smash', label: '杀球', shortLabel: '杀球', isValid: true }
}

function clampInt(val, min, max, fallback) {
  const num = Number(val)
  if (!Number.isFinite(num)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.round(num)))
}

/**
 * 规范化挥拍判定速度阈值并确保三档严格递增（最小间隔 5 km/h）
 */
function normalizeThresholds(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {}

  const minValidSpeed = clampInt(
    src.minValidSpeed,
    THRESHOLD_LIMITS.minValidSpeed.min,
    THRESHOLD_LIMITS.minValidSpeed.max,
    DEFAULT_THRESHOLDS.minValidSpeed
  )

  const clearMin = Math.max(THRESHOLD_LIMITS.clearThreshold.min, minValidSpeed + 5)
  const clearThreshold = clampInt(
    src.clearThreshold,
    clearMin,
    THRESHOLD_LIMITS.clearThreshold.max,
    Math.max(clearMin, DEFAULT_THRESHOLDS.clearThreshold)
  )

  const smashMin = Math.max(THRESHOLD_LIMITS.smashThreshold.min, clearThreshold + 5)
  const smashThreshold = clampInt(
    src.smashThreshold,
    smashMin,
    THRESHOLD_LIMITS.smashThreshold.max,
    Math.max(smashMin, DEFAULT_THRESHOLDS.smashThreshold)
  )

  return {
    minValidSpeed,
    clearThreshold,
    smashThreshold
  }
}

/**
 * 步进调整单个阈值并保持各档位关系合法
 */
function adjustThreshold(current, key, delta) {
  const normalized = normalizeThresholds(current)
  if (!THRESHOLD_LIMITS[key]) {
    return normalized
  }
  const stepDelta = Number(delta)
  if (!Number.isFinite(stepDelta)) {
    return normalized
  }
  const next = Object.assign({}, normalized, {
    [key]: normalized[key] + stepDelta
  })
  return normalizeThresholds(next)
}

/**
 * 根据挥速和阈值判定击球类型
 */
function classifySwing(speedKmh, rawThresholds = DEFAULT_THRESHOLDS) {
  const thresholds = normalizeThresholds(rawThresholds)
  const validNum = typeof speedKmh === 'number' && Number.isFinite(speedKmh)
  const roundedSpeed = validNum ? Math.round(speedKmh * 10) / 10 : 0

  let meta
  if (!validNum || speedKmh < thresholds.minValidSpeed) {
    meta = SHOT_TYPES.invalid
  } else if (speedKmh > thresholds.smashThreshold) {
    meta = SHOT_TYPES.smash
  } else if (speedKmh > thresholds.clearThreshold) {
    meta = SHOT_TYPES.clear
  } else {
    meta = SHOT_TYPES.normal
  }

  return Object.assign({}, meta, {
    speedKmh: roundedSpeed
  })
}

module.exports = {
  DEFAULT_THRESHOLDS,
  THRESHOLD_LIMITS,
  SHOT_TYPES,
  normalizeThresholds,
  adjustThreshold,
  classifySwing
}
