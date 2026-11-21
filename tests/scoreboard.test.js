const test = require('node:test')
const assert = require('node:assert/strict')
const {
  createInitialState,
  evaluateWinner,
  getGamePointSide,
  getServeCourt,
  addPoint,
  undoPoint,
  startNextGame,
  toggleSwap,
  cycleMode,
  resetMatch
} = require('../src/common/scoreboard')

function scoreMany(state, side, count) {
  let s = state
  for (let i = 0; i < count; i++) {
    s = addPoint(s, side)
  }
  return s
}

test('21分制正常 21:18 判胜并累计局分，胜出后继续点击不再加分', () => {
  let s = createInitialState('21')
  s = scoreMany(s, 'my', 20)
  s = scoreMany(s, 'opp', 18)
  assert.equal(s.winner, null)
  assert.equal(getGamePointSide(s.myScore, s.oppScore, s.mode), 'my')

  s = addPoint(s, 'my')
  assert.equal(s.myScore, 21)
  assert.equal(s.oppScore, 18)
  assert.equal(s.winner, 'my')
  assert.equal(s.myGames, 1)
  assert.equal(s.oppGames, 0)

  // 胜出后不可再加分
  const afterExtra = addPoint(s, 'opp')
  assert.equal(afterExtra.oppScore, 18)
  assert.equal(afterExtra.myGames, 1)
})

test('20:20 追平需领先 2 分，29:29 时 30:29 封顶判胜', () => {
  assert.equal(evaluateWinner(21, 20, '21'), null)
  assert.equal(evaluateWinner(22, 20, '21'), 'my')
  assert.equal(evaluateWinner(29, 28, '21'), null)
  assert.equal(evaluateWinner(30, 29, '21'), 'my')
  assert.equal(getGamePointSide(29, 29, '21'), 'both')
})

test('发球权与发球区奇偶切换准确', () => {
  let s = createInitialState('21')
  assert.equal(s.server, 'my')
  assert.equal(getServeCourt(s), '右区(偶)')

  s = addPoint(s, 'my')
  assert.equal(s.myScore, 1)
  assert.equal(s.server, 'my')
  assert.equal(getServeCourt(s), '左区(奇)')

  s = addPoint(s, 'opp')
  assert.equal(s.oppScore, 1)
  assert.equal(s.server, 'opp')
  assert.equal(getServeCourt(s), '左区(奇)')

  s = addPoint(s, 'opp')
  assert.equal(s.oppScore, 2)
  assert.equal(getServeCourt(s), '右区(偶)')
})

test('撤销功能可完整恢复比分、发球权与局分（包括撤销制胜分）', () => {
  let s = createInitialState('11')
  s = scoreMany(s, 'my', 10)
  s = scoreMany(s, 'opp', 5)
  s = addPoint(s, 'my') // 11:5 我方胜
  assert.equal(s.winner, 'my')
  assert.equal(s.myGames, 1)

  s = undoPoint(s)
  assert.equal(s.myScore, 10)
  assert.equal(s.oppScore, 5)
  assert.equal(s.winner, null)
  assert.equal(s.myGames, 0)
  assert.equal(s.server, 'opp')

  // 继续撤销到 10:4
  s = undoPoint(s)
  assert.equal(s.oppScore, 4)
})

test('startNextGame 保留局分和换边状态并清空小分', () => {
  let s = createInitialState('11')
  s = toggleSwap(s)
  s = scoreMany(s, 'opp', 11)
  assert.equal(s.winner, 'opp')
  assert.equal(s.oppGames, 1)

  const next = startNextGame(s)
  assert.equal(next.myScore, 0)
  assert.equal(next.oppScore, 0)
  assert.equal(next.myGames, 0)
  assert.equal(next.oppGames, 1)
  assert.equal(next.swapped, true)
  assert.equal(next.winner, null)
  assert.equal(next.server, 'opp')
  assert.equal(next.undoStack.length, 0)
})

test('赛制切换、自由模式与重置比赛符合预期', () => {
  let s = createInitialState('21')
  s = cycleMode(s)
  assert.equal(s.mode, '15')
  s = cycleMode(s)
  assert.equal(s.mode, '11')
  s = cycleMode(s)
  assert.equal(s.mode, 'free')

  // 自由模式下高分也不自动结束
  s = scoreMany(s, 'my', 35)
  assert.equal(s.winner, null)
  assert.equal(getGamePointSide(s.myScore, s.oppScore, s.mode), null)

  // 切回 21 分制时根据当前比分判胜
  s = cycleMode(s)
  assert.equal(s.mode, '21')
  assert.equal(s.winner, 'my')
  assert.equal(s.myGames, 1)

  const reset = resetMatch(s)
  assert.equal(reset.mode, '21')
  assert.equal(reset.myScore, 0)
  assert.equal(reset.oppScore, 0)
  assert.equal(reset.myGames, 0)
  assert.equal(reset.oppGames, 0)
  assert.equal(reset.winner, null)
})
