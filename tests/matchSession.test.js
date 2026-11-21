const test = require('node:test')
const assert = require('node:assert/strict')
const { DEFAULT_THRESHOLDS } = require('../src/common/swingClassifier')
const {
  MAX_SWINGS_PER_MATCH,
  createMatchSession,
  recordMatchSwing,
  finalizeMatchRecord,
  formatDuration,
  formatMatchTime
} = require('../src/common/matchSession')

test('createMatchSession 创建初始对局会话结构', () => {
  const session = createMatchSession('15', DEFAULT_THRESHOLDS, 1700000000000)
  assert.equal(session.id, 'match_1700000000000')
  assert.equal(session.version, 1)
  assert.equal(session.startedAt, 1700000000000)
  assert.equal(session.mode, '15')
  assert.deepEqual(session.thresholdsSnapshot, DEFAULT_THRESHOLDS)
  assert.equal(session.totalSwings, 0)
  assert.equal(session.smashCount, 0)
  assert.equal(session.clearCount, 0)
  assert.equal(session.normalCount, 0)
  assert.equal(session.invalidCount, 0)
  assert.equal(session.swings.length, 0)
})

test('recordMatchSwing 正确归类杀球/高远球/普通挥拍并忽略 <40 无效挥拍', () => {
  const t0 = 1700000000000
  let session = createMatchSession('21', DEFAULT_THRESHOLDS, t0)

  // 无效挥拍 (<40)
  const invalidRes = recordMatchSwing(
    session,
    { speedKmh: 35.4, peakG: 2.8, durationMs: 60, timestamp: t0 + 1000 },
    DEFAULT_THRESHOLDS
  )
  assert.equal(invalidRes.recorded, false)
  assert.equal(invalidRes.classification.type, 'invalid')
  session = invalidRes.session
  assert.equal(session.invalidCount, 1)
  assert.equal(session.totalSwings, 0)
  assert.equal(session.swings.length, 0)

  // 普通挥拍 (40 - 100)
  const normalRes = recordMatchSwing(
    session,
    { speedKmh: 80.0, peakG: 6.5, durationMs: 120, timestamp: t0 + 5000 },
    DEFAULT_THRESHOLDS
  )
  assert.equal(normalRes.recorded, true)
  assert.equal(normalRes.classification.type, 'normal')
  session = normalRes.session

  // 高远球 (>100 - 150)
  const clearRes = recordMatchSwing(
    session,
    { speedKmh: 120.5, peakG: 9.8, durationMs: 140, timestamp: t0 + 10000 },
    DEFAULT_THRESHOLDS
  )
  assert.equal(clearRes.recorded, true)
  assert.equal(clearRes.classification.type, 'clear')
  session = clearRes.session

  // 杀球 (>150)
  const smashRes = recordMatchSwing(
    session,
    { speedKmh: 165.5, peakG: 14.2, durationMs: 160, timestamp: t0 + 15000 },
    DEFAULT_THRESHOLDS
  )
  assert.equal(smashRes.recorded, true)
  assert.equal(smashRes.classification.type, 'smash')
  session = smashRes.session

  assert.equal(session.totalSwings, 3)
  assert.equal(session.normalCount, 1)
  assert.equal(session.clearCount, 1)
  assert.equal(session.smashCount, 1)
  assert.equal(session.maxSpeedKmh, 165.5)
  assert.equal(session.sumSpeed, 366)
  assert.equal(session.swings.length, 3)
  assert.equal(session.swings[2].t, 15000)
  assert.equal(session.swings[2].type, 'smash')
  assert.equal(session.lastSwing.label, '杀球')
})

test('finalizeMatchRecord 生成完整汇总与手机同步结构', () => {
  const t0 = 1700000000000
  let session = createMatchSession('21', DEFAULT_THRESHOLDS, t0)
  session = recordMatchSwing(
    session,
    { speedKmh: 160.0, peakG: 13.0, durationMs: 150, timestamp: t0 + 2000 },
    DEFAULT_THRESHOLDS
  ).session
  session = recordMatchSwing(
    session,
    { speedKmh: 110.0, peakG: 9.0, durationMs: 130, timestamp: t0 + 4000 },
    DEFAULT_THRESHOLDS
  ).session

  const recordWin = finalizeMatchRecord(
    session,
    { mode: '21', myScore: 21, oppScore: 17, winner: 'my' },
    t0 + 625000,
    'win'
  )

  assert.equal(recordWin.id, session.id)
  assert.equal(recordWin.version, 1)
  assert.equal(recordWin.durationSec, 625)
  assert.equal(recordWin.mode, '21')
  assert.equal(recordWin.myScore, 21)
  assert.equal(recordWin.oppScore, 17)
  assert.equal(recordWin.winner, 'my')
  assert.equal(recordWin.endReason, 'win')
  assert.deepEqual(recordWin.summary, {
    totalSwings: 2,
    smashCount: 1,
    clearCount: 1,
    normalCount: 0,
    maxSpeedKmh: 160,
    avgSpeedKmh: 135
  })
  assert.equal(recordWin.swings.length, 2)

  // 手动提前结束时，根据比分推断 winner 或 draw
  const recordDraw = finalizeMatchRecord(
    session,
    { mode: '21', myScore: 10, oppScore: 10, winner: null },
    t0 + 120000,
    'manual'
  )
  assert.equal(recordDraw.winner, 'draw')

  const recordOppLead = finalizeMatchRecord(
    session,
    { mode: '21', myScore: 9, oppScore: 14, winner: null },
    t0 + 120000,
    'manual'
  )
  assert.equal(recordOppLead.winner, 'opp')
})

test('swings 明细上限 MAX_SWINGS_PER_MATCH 生效，统计计数仍继续累加', () => {
  const t0 = 1700000000000
  let session = createMatchSession('21', DEFAULT_THRESHOLDS, t0)
  for (let i = 0; i < MAX_SWINGS_PER_MATCH + 15; i++) {
    session = recordMatchSwing(
      session,
      { speedKmh: 155, peakG: 12, durationMs: 140, timestamp: t0 + i * 1000 },
      DEFAULT_THRESHOLDS
    ).session
  }
  assert.equal(session.swings.length, MAX_SWINGS_PER_MATCH)
  assert.equal(session.totalSwings, MAX_SWINGS_PER_MATCH + 15)
  assert.equal(session.smashCount, MAX_SWINGS_PER_MATCH + 15)
})

test('formatDuration 与 formatMatchTime 格式化输出正确', () => {
  assert.equal(formatDuration(0), '00:00')
  assert.equal(formatDuration(65), '01:05')
  assert.equal(formatDuration(3665), '1:01:05')
  assert.equal(formatMatchTime(0), '--')
  assert.match(formatMatchTime(1700000000000), /^\d{2}-\d{2} \d{2}:\d{2}$/)
})
