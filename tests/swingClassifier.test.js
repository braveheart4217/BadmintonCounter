const test = require('node:test')
const assert = require('node:assert/strict')
const {
  DEFAULT_THRESHOLDS,
  normalizeThresholds,
  adjustThreshold,
  classifySwing
} = require('../src/common/swingClassifier')

test('默认阈值下边界判定准确 (<40 无效, 40-100 普通, >100 高远球, >150 杀球)', () => {
  const belowMin = classifySwing(39.9, DEFAULT_THRESHOLDS)
  assert.equal(belowMin.type, 'invalid')
  assert.equal(belowMin.isValid, false)
  assert.equal(belowMin.label, '无效挥拍')
  assert.equal(belowMin.speedKmh, 39.9)

  const atMin = classifySwing(40, DEFAULT_THRESHOLDS)
  assert.equal(atMin.type, 'normal')
  assert.equal(atMin.isValid, true)
  assert.equal(atMin.label, '普通挥拍')

  const atClearBoundary = classifySwing(100, DEFAULT_THRESHOLDS)
  assert.equal(atClearBoundary.type, 'normal')
  assert.equal(atClearBoundary.isValid, true)

  const aboveClear = classifySwing(100.1, DEFAULT_THRESHOLDS)
  assert.equal(aboveClear.type, 'clear')
  assert.equal(aboveClear.isValid, true)
  assert.equal(aboveClear.label, '高远球')

  const atSmashBoundary = classifySwing(150, DEFAULT_THRESHOLDS)
  assert.equal(atSmashBoundary.type, 'clear')
  assert.equal(atSmashBoundary.isValid, true)

  const aboveSmash = classifySwing(150.1, DEFAULT_THRESHOLDS)
  assert.equal(aboveSmash.type, 'smash')
  assert.equal(aboveSmash.isValid, true)
  assert.equal(aboveSmash.label, '杀球')
})

test('非法速度输入被安全判定为无效挥拍', () => {
  for (const bad of [NaN, Infinity, -5, null, undefined]) {
    const res = classifySwing(bad, DEFAULT_THRESHOLDS)
    assert.equal(res.type, 'invalid')
    assert.equal(res.isValid, false)
  }
})

test('自定义阈值生效', () => {
  const custom = { minValidSpeed: 30, clearThreshold: 80, smashThreshold: 130 }
  assert.equal(classifySwing(29.5, custom).type, 'invalid')
  assert.equal(classifySwing(35, custom).type, 'normal')
  assert.equal(classifySwing(85, custom).type, 'clear')
  assert.equal(classifySwing(135, custom).type, 'smash')
})

test('normalizeThresholds 强制范围内整数与严格递增间隔 (>= 5 km/h)', () => {
  const clampedLow = normalizeThresholds({
    minValidSpeed: 1,
    clearThreshold: 10,
    smashThreshold: 20
  })
  assert.deepEqual(clampedLow, {
    minValidSpeed: 10,
    clearThreshold: 50,
    smashThreshold: 80
  })

  const inverted = normalizeThresholds({
    minValidSpeed: 100,
    clearThreshold: 90,
    smashThreshold: 95
  })
  assert.deepEqual(inverted, {
    minValidSpeed: 100,
    clearThreshold: 105,
    smashThreshold: 110
  })

  const clampedHigh = normalizeThresholds({
    minValidSpeed: 200,
    clearThreshold: 400,
    smashThreshold: 999
  })
  assert.deepEqual(clampedHigh, {
    minValidSpeed: 120,
    clearThreshold: 250,
    smashThreshold: 350
  })
})

test('adjustThreshold 支持步进调整并联动保护阈值大小顺序', () => {
  let th = Object.assign({}, DEFAULT_THRESHOLDS)
  th = adjustThreshold(th, 'smashThreshold', 5)
  assert.equal(th.smashThreshold, 155)

  th = adjustThreshold(th, 'clearThreshold', -5)
  assert.equal(th.clearThreshold, 95)

  // 提高 minValidSpeed 至接近 clearThreshold 时应自动顶高 clearThreshold
  const tight = { minValidSpeed: 95, clearThreshold: 100, smashThreshold: 105 }
  const pushed = adjustThreshold(tight, 'minValidSpeed', 5)
  assert.deepEqual(pushed, {
    minValidSpeed: 100,
    clearThreshold: 105,
    smashThreshold: 110
  })

  // 降低 smashThreshold 不应破坏 clearThreshold + 5 下限
  const stopped = adjustThreshold(pushed, 'smashThreshold', -5)
  assert.equal(stopped.smashThreshold, 110)
})
