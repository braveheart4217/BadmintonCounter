const test = require('node:test')
const assert = require('node:assert/strict')
const { GRAVITY, SwingDetector } = require('../src/common/swingDetector')

function feedStationary(detector, count, startTs, opts = {}) {
  const stepMs = opts.stepMs || 20
  const baseG = opts.inG ? 1.0 : GRAVITY
  const noiseAmp = opts.noiseAmp || 0
  const results = []
  let ts = startTs

  for (let i = 0; i < count; i++) {
    const noise = noiseAmp > 0 ? Math.sin(i * 1.7) * noiseAmp : 0
    const res = detector.processSample(0, 0, baseG + noise, ts)
    if (res) {
      results.push(res)
    }
    ts += stepMs
  }
  return { results, nextTs: ts }
}

function feedPulse(detector, startTs, peakDyn, durationMs, opts = {}) {
  const stepMs = opts.stepMs || 20
  const inG = Boolean(opts.inG)
  const scale = inG ? GRAVITY : 1.0
  const results = []
  let ts = startTs

  const steps = Math.max(1, Math.round(durationMs / stepMs))
  for (let i = 0; i <= steps; i++) {
    const phase = i / steps
    const dyn = Math.sin(Math.PI * phase) * peakDyn
    const totalMs2 = GRAVITY + dyn
    const res = detector.processSample(0, 0, totalMs2 / scale, ts)
    if (res) {
      results.push(res)
    }
    ts += stepMs
  }
  return { results, nextTs: ts }
}

test('静止与轻微日常抖动 (±0.3g) 不应误触发', () => {
  const detector = new SwingDetector()
  const { results } = feedStationary(detector, 100, 0, {
    noiseAmp: 0.3 * GRAVITY
  })
  assert.equal(results.length, 0)
  assert.equal(detector.getState(), 'IDLE')
})

test('中等挥拍与大力杀球均可识别，且杀球挥速显著高于中等挥拍', () => {
  const detector = new SwingDetector({ calibrationFactor: 2.2, sensitivity: 'medium' })
  let ts = 0

  const warmup = feedStationary(detector, 15, ts)
  ts = warmup.nextTs

  // 中等挥拍：峰值约 55 m/s² (~5.6g 动态)，持续 140ms
  const medium = feedPulse(detector, ts, 55, 140)
  ts = medium.nextTs
  assert.equal(medium.results.length, 1, '中等挥拍应触发一次')

  // 冷却期过后模拟大力杀球：峰值约 130 m/s² (~13.3g 动态)，持续 160ms
  const rest = feedStationary(detector, 35, ts)
  ts = rest.nextTs

  const smash = feedPulse(detector, ts, 130, 160)
  assert.equal(smash.results.length, 1, '大力杀球应触发一次')

  const medSpeed = medium.results[0].speedKmh
  const smashSpeed = smash.results[0].speedKmh
  assert.ok(medSpeed > 20, `中等挥速过低: ${medSpeed}`)
  assert.ok(smashSpeed > medSpeed * 1.8, `杀球挥速(${smashSpeed})应显著高于中等挥速(${medSpeed})`)
  assert.ok(smash.results[0].peakG > medium.results[0].peakG)
})

test('500ms 冷却期内回拍尖峰被屏蔽，冷却结束后可正常再次触发', () => {
  const detector = new SwingDetector({ cooldownMs: 500 })
  let ts = 0

  ts = feedStationary(detector, 15, ts).nextTs

  // 第一次挥拍
  const first = feedPulse(detector, ts, 90, 140)
  ts = first.nextTs
  assert.equal(first.results.length, 1)
  assert.equal(detector.getState(), 'COOLDOWN')

  // 100ms 后出现强烈回拍尖峰（仍在 500ms 冷却期内）
  ts = feedStationary(detector, 5, ts).nextTs
  const rebound = feedPulse(detector, ts, 100, 120)
  ts = rebound.nextTs
  assert.equal(rebound.results.length, 0, '冷却期内的回拍尖峰不应触发')

  // 补足等待超过冷却期
  ts = feedStationary(detector, 30, ts).nextTs
  assert.equal(detector.getState(), 'IDLE')

  // 冷却期结束后再次挥拍应正常触发
  const second = feedPulse(detector, ts, 90, 140)
  assert.equal(second.results.length, 1, '冷却结束后应恢复检测')
})

test('自动识别以 g 为单位的传感器输入，输出与 m/s² 输入基本一致', () => {
  const detMs2 = new SwingDetector()
  const detG = new SwingDetector()

  let ts1 = feedStationary(detMs2, 15, 0, { inG: false }).nextTs
  let ts2 = feedStationary(detG, 15, 0, { inG: true }).nextTs

  const resMs2 = feedPulse(detMs2, ts1, 100, 140, { inG: false }).results
  const resG = feedPulse(detG, ts2, 100, 140, { inG: true }).results

  assert.equal(resMs2.length, 1)
  assert.equal(resG.length, 1)
  assert.ok(
    Math.abs(resMs2[0].speedKmh - resG[0].speedKmh) < 0.2,
    `单位换算结果偏差过大: m/s²=${resMs2[0].speedKmh}, g=${resG[0].speedKmh}`
  )
})

test('持续时间短于 40ms 的单帧瞬时毛刺被过滤', () => {
  const detector = new SwingDetector({ minSwingMs: 40 })
  let ts = feedStationary(detector, 15, 0).nextTs

  // 仅 1 帧尖峰 (20ms 后立刻回到静止)
  assert.equal(detector.processSample(0, 0, GRAVITY + 60, ts), null)
  ts += 20
  assert.equal(detector.processSample(0, 0, GRAVITY, ts), null)
  assert.equal(detector.getState(), 'IDLE')
})

test('calibrationFactor 缩放与 maxSpeedKmh 上限保护生效', () => {
  const detLowCal = new SwingDetector({ calibrationFactor: 1.5 })
  const detHighCal = new SwingDetector({ calibrationFactor: 3.0 })
  const detCapped = new SwingDetector({ calibrationFactor: 4.0, maxSpeedKmh: 200 })

  const runOne = (det, peak = 120, duration = 160) => {
    const ts = feedStationary(det, 15, 0).nextTs
    return feedPulse(det, ts, peak, duration).results[0]
  }

  const r1 = runOne(detLowCal)
  const r2 = runOne(detHighCal)
  const r3 = runOne(detCapped, 180, 180)

  assert.ok(Math.abs(r2.speedKmh - r1.speedKmh * 2) <= 0.3, '双倍系数应产生约双倍读数')
  assert.equal(r3.speedKmh, 200, '超出 maxSpeedKmh 时应被钳位')
})

test('灵敏度档位切换 (low vs high) 对中等脉冲的响应符合预期', () => {
  // 峰值 16 m/s² 的轻挥脉冲：超过 high(10/13) 与 medium(15/18) 部分阈值，但低于 low(22/26)
  const detLow = new SwingDetector({ sensitivity: 'low' })
  const detHigh = new SwingDetector({ sensitivity: 'high' })

  const tsLow = feedStationary(detLow, 15, 0).nextTs
  const tsHigh = feedStationary(detHigh, 15, 0).nextTs

  const resLow = feedPulse(detLow, tsLow, 16, 120).results
  const resHigh = feedPulse(detHigh, tsHigh, 16, 120).results

  assert.equal(resLow.length, 0, '低灵敏度下轻挥不应触发')
  assert.equal(resHigh.length, 1, '高灵敏度下轻挥应触发')
})
