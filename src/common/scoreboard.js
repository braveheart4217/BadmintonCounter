const MATCH_MODES = {
  '21': { id: '21', label: '21分制', target: 21, cap: 30, winByTwo: true },
  '15': { id: '15', label: '15分制', target: 15, cap: 21, winByTwo: true },
  '11': { id: '11', label: '11分制', target: 11, cap: 15, winByTwo: true },
  free: { id: 'free', label: '自由', target: 0, cap: 0, winByTwo: false }
}

const MODE_ORDER = ['21', '15', '11', 'free']
const MAX_UNDO_STACK = 30

function resolveMode(modeId) {
  return MATCH_MODES[modeId] ? modeId : '21'
}

function createInitialState(modeId = '21') {
  return {
    mode: resolveMode(modeId),
    myScore: 0,
    oppScore: 0,
    myGames: 0,
    oppGames: 0,
    server: 'my',
    swapped: false,
    winner: null,
    undoStack: []
  }
}

function evaluateWinner(myScore, oppScore, modeId) {
  const mode = MATCH_MODES[resolveMode(modeId)]
  if (!mode.target) {
    return null
  }
  if (myScore >= mode.cap && myScore > oppScore) {
    return 'my'
  }
  if (oppScore >= mode.cap && oppScore > myScore) {
    return 'opp'
  }
  if (myScore >= mode.target && (!mode.winByTwo || myScore - oppScore >= 2)) {
    return 'my'
  }
  if (oppScore >= mode.target && (!mode.winByTwo || oppScore - myScore >= 2)) {
    return 'opp'
  }
  return null
}

function getGamePointSide(myScore, oppScore, modeId) {
  const mode = MATCH_MODES[resolveMode(modeId)]
  if (!mode.target || evaluateWinner(myScore, oppScore, mode.id) !== null) {
    return null
  }
  const myCanWin = evaluateWinner(myScore + 1, oppScore, mode.id) === 'my'
  const oppCanWin = evaluateWinner(myScore, oppScore + 1, mode.id) === 'opp'
  if (myCanWin && oppCanWin) {
    return 'both'
  }
  if (myCanWin) {
    return 'my'
  }
  if (oppCanWin) {
    return 'opp'
  }
  return null
}

function getServeCourt(state) {
  const score = state.server === 'opp' ? state.oppScore : state.myScore
  return score % 2 === 0 ? '右区(偶)' : '左区(奇)'
}

function addPoint(state, side) {
  if (state.winner || (side !== 'my' && side !== 'opp')) {
    return state
  }

  const snapshot = {
    myScore: state.myScore,
    oppScore: state.oppScore,
    myGames: state.myGames,
    oppGames: state.oppGames,
    server: state.server,
    winner: state.winner
  }
  const nextUndo = (Array.isArray(state.undoStack) ? state.undoStack : [])
    .concat([snapshot])
    .slice(-MAX_UNDO_STACK)

  const nextMy = side === 'my' ? state.myScore + 1 : state.myScore
  const nextOpp = side === 'opp' ? state.oppScore + 1 : state.oppScore
  const nextWinner = evaluateWinner(nextMy, nextOpp, state.mode)
  const nextMyGames = nextWinner === 'my' ? state.myGames + 1 : state.myGames
  const nextOppGames = nextWinner === 'opp' ? state.oppGames + 1 : state.oppGames

  return Object.assign({}, state, {
    myScore: nextMy,
    oppScore: nextOpp,
    myGames: nextMyGames,
    oppGames: nextOppGames,
    server: side,
    winner: nextWinner,
    undoStack: nextUndo
  })
}

function undoPoint(state) {
  if (!Array.isArray(state.undoStack) || state.undoStack.length === 0) {
    return state
  }
  const nextUndo = state.undoStack.slice()
  const prev = nextUndo.pop()
  return Object.assign({}, state, {
    myScore: prev.myScore,
    oppScore: prev.oppScore,
    myGames: prev.myGames,
    oppGames: prev.oppGames,
    server: prev.server,
    winner: prev.winner,
    undoStack: nextUndo
  })
}

function startNextGame(state) {
  const nextServer = state.winner === 'opp' ? 'opp' : 'my'
  return {
    mode: resolveMode(state.mode),
    myScore: 0,
    oppScore: 0,
    myGames: state.myGames || 0,
    oppGames: state.oppGames || 0,
    server: nextServer,
    swapped: Boolean(state.swapped),
    winner: null,
    undoStack: []
  }
}

function toggleSwap(state) {
  return Object.assign({}, state, {
    swapped: !state.swapped
  })
}

function cycleMode(state) {
  const currentMode = resolveMode(state.mode)
  const idx = MODE_ORDER.indexOf(currentMode)
  const nextMode = MODE_ORDER[(idx + 1) % MODE_ORDER.length]

  let nextWinner = state.winner
  let nextMyGames = state.myGames
  let nextOppGames = state.oppGames

  if (!state.winner) {
    const evaluated = evaluateWinner(state.myScore, state.oppScore, nextMode)
    if (evaluated === 'my') {
      nextWinner = 'my'
      nextMyGames += 1
    } else if (evaluated === 'opp') {
      nextWinner = 'opp'
      nextOppGames += 1
    }
  }

  return Object.assign({}, state, {
    mode: nextMode,
    winner: nextWinner,
    myGames: nextMyGames,
    oppGames: nextOppGames
  })
}

function resetMatch(state) {
  return createInitialState(state && state.mode)
}

module.exports = {
  MATCH_MODES,
  MODE_ORDER,
  MAX_UNDO_STACK,
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
}
