import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Volume2,
  VolumeX,
  Music,
  Music2,
  Maximize,
  Minimize,
  RotateCcw,
  Trophy,
  Info,
  ChevronRight,
  Users,
  Bot,
  Shield,
} from 'lucide-react';
import './styles/animations.css';
import {
  Cell,
  Player,
  COORDS,
  MILLS,
  PIECES_PER_PLAYER,
  opponent,
  countPieces,
  millsFormedAt,
  removablePieces,
  isFlying,
  destinationsFor,
  hasAnyMove,
  getPhase,
  checkWin,
} from './game/nineMensMorris';
import { playSound, toggleMusic, toggleSfx, isMusicOn, isSfxOn, initAudio } from './audio/sounds';
import {
  AILevel,
  aiLevelName,
  chooseAIAction,
} from './ai/nineMensMorrisAI';

/* ------------------------------------------------------------------ */
/* Types & constants                                                  */
/* ------------------------------------------------------------------ */

interface GameState {
  board: Cell[];
  turn: Player;
  placed: Record<Player, number>;
  mustRemove: boolean;
  selected: number | null;
  winner: Player | null;
  winReason: string;
  lastMillCells: number[];
  lastAction: number[];
  history: { board: Cell[]; placed: Record<Player, number> }[];
}

interface AppSettings {
  gameMode: 'pvp' | 'ai';
  aiLevel: AILevel;
  playerSide: Player;
}

type Screen = 'menu' | 'game' | 'victory';

const NAME: Record<Player, string> = { W: 'Blanc', B: 'Noir' };

const PAD = 46;
const GAP = 78;
const SIZE = PAD * 2 + GAP * 6;
const px = (i: number) => PAD + COORDS[i][0] * GAP;
const py = (i: number) => PAD + COORDS[i][1] * GAP;

const LEVELS: AILevel[] = [1, 2, 3, 4, 5];
const LEVEL_DESC: Record<AILevel, string> = {
  1: 'Coups aléatoires : parfait pour apprendre',
  2: 'Évite les erreurs grossières',
  3: 'Pense un coup à l\'avance',
  4: 'Minimax profond 3 : sérieux',
  5: 'Minimax profond 5 : bonne chance !',
};

function initialGameState(): GameState {
  return {
    board: Array(24).fill(null),
    turn: 'W',
    placed: { W: 0, B: 0 },
    mustRemove: false,
    selected: null,
    winner: null,
    winReason: '',
    lastMillCells: [],
    lastAction: [],
    history: [],
  };
}

function initialSettings(): AppSettings {
  return {
    gameMode: 'ai',
    aiLevel: 1,
    playerSide: 'W',
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function isAITurn(settings: AppSettings, gs: GameState): boolean {
  return settings.gameMode === 'ai' && gs.turn !== settings.playerSide && !gs.winner;
}

function isHumanTurn(settings: AppSettings, gs: GameState): boolean {
  return settings.gameMode === 'pvp' || gs.turn === settings.playerSide;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('menu');
  const [settings, setSettings] = useState<AppSettings>(initialSettings());
  const [gs, setGs] = useState<GameState>(initialGameState());
  const [music, setMusic] = useState(isMusicOn());
  const [sfx, setSfx] = useState(isSfxOn());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [captureEffects, setCaptureEffects] = useState<{ id: number; x: number; y: number }[]>([]);
  const [scores, setScores] = useState<Record<Player, number>>({ W: 0, B: 0 });
  const boardRef = useRef<HTMLDivElement>(null);
  const effectId = useRef(0);
  const hoverSoundTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { board, turn, placed, mustRemove, selected, winner } = gs;
  const phase = getPhase(board, turn, placed);
  const allPlaced = placed.W >= PIECES_PER_PLAYER && placed.B >= PIECES_PER_PLAYER;

  /* ----------------------- audio & fullscreen ---------------------- */

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFull = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // ignore
    }
  };

  const setMusicState = (on: boolean) => {
    initAudio();
    setMusic(toggleMusic(on));
  };

  const setSfxState = (on: boolean) => {
    initAudio();
    setSfx(toggleSfx(on));
  };

  /* ------------------------- AI turn -------------------------------- */

  useEffect(() => {
    if (screen !== 'game') return;
    if (!isAITurn(settings, gs)) return;
    if (gs.winner) return;

    const timer = setTimeout(() => {
      initAudio();
      const action = chooseAIAction(
        { board: gs.board, turn: gs.turn, placed: gs.placed },
        gs.mustRemove,
        settings.aiLevel
      );
      if (!action) return;

      if (action.type === 'capture') {
        handlePointClick(action.target);
      } else if (action.type === 'place') {
        handlePointClick(action.to);
      } else {
        setGs((prev) => ({ ...prev, selected: action.from }));
        setTimeout(() => handlePointClick(action.to), 180);
      }
    }, 750);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gs, settings, screen]);

  /* ------------------------- derived UI ---------------------------- */

  const removeTargets = useMemo(
    () => (mustRemove && !winner ? removablePieces(board, opponent(turn)) : []),
    [board, mustRemove, turn, winner]
  );

  const flying = !winner && phase === 'flying';

  const moveTargets = useMemo(() => {
    if (selected === null || mustRemove || winner) return [];
    return destinationsFor(board, selected, flying);
  }, [board, selected, mustRemove, flying, winner]);

  const millSegments = useMemo(() => {
    const set = new Set(gs.lastMillCells);
    return MILLS.filter((m) => m.every((p) => set.has(p)));
  }, [gs.lastMillCells]);

  /* ------------------------- actions ------------------------------- */

  function addCaptureEffect(pos: number) {
    if (!boardRef.current) return;
    const rect = boardRef.current.getBoundingClientRect();
    const scale = rect.width / SIZE;
    const cx = px(pos) * scale;
    const cy = py(pos) * scale;
    const id = ++effectId.current;
    const effects = Array.from({ length: 8 }).map((_, i) => ({
      id: id * 10 + i,
      x: cx + Math.cos((i / 8) * Math.PI * 2) * 18,
      y: cy + Math.sin((i / 8) * Math.PI * 2) * 18,
    }));
    setCaptureEffects((prev) => [...prev, ...effects]);
    setTimeout(() => {
      setCaptureEffects((prev) => prev.filter((e) => e.id < id * 10 || e.id >= id * 10 + 8));
    }, 800);
  }

  function handleWin(next: Partial<GameState> & { board: Cell[]; placed?: Record<Player, number> }) {
    const nb = next.board;
    const nplaced = next.placed ?? placed;
    const nextPlayer = opponent(turn);
    const nextAllPlaced = nplaced.W >= PIECES_PER_PLAYER && nplaced.B >= PIECES_PER_PLAYER;
    const blocked =
      nextAllPlaced &&
      nplaced[nextPlayer] >= PIECES_PER_PLAYER &&
      !hasAnyMove(nb, nextPlayer, isFlying(nb, nextPlayer, nextAllPlaced));

    const { winner: w, reason } = checkWin(nb, nplaced, turn, blocked);
    if (w) {
      playSound(w === settings.playerSide || settings.gameMode === 'pvp' ? 'win' : 'lose');
      setScores((prev) => ({ ...prev, [w]: prev[w] + 1 }));
      setGs({
        ...gs,
        ...next,
        placed: nplaced,
        selected: null,
        mustRemove: false,
        winner: w,
        winReason: reason,
      });
      setTimeout(() => setScreen('victory'), 900);
      return true;
    }
    return false;
  }

  function endTurn(next: Partial<GameState> & { board: Cell[]; placed?: Record<Player, number> }) {
    if (handleWin(next)) return;

    const nplaced = next.placed ?? placed;
    setGs({
      ...gs,
      ...next,
      placed: nplaced,
      turn: opponent(turn),
      selected: null,
      mustRemove: false,
      history: [...gs.history, { board: gs.board, placed: { ...gs.placed } }],
    });
  }

  function handlePointClick(i: number) {
    if (winner) return;
    if (!isHumanTurn(settings, gs) && !isAITurn(settings, gs)) return;

    initAudio();

    if (mustRemove) {
      if (!removeTargets.includes(i)) {
        playSound('invalid');
        return;
      }
      playSound('capture');
      addCaptureEffect(i);
      const nb = [...board];
      nb[i] = null;
      const opp = opponent(turn);
      const oppAllPlaced = placed[opp] >= PIECES_PER_PLAYER;
      if (oppAllPlaced && countPieces(nb, opp) < 3) {
        playSound('win');
        setGs({
          ...gs,
          board: nb,
          mustRemove: false,
          selected: null,
          winner: turn,
          winReason: `${NAME[opp]} est réduit à 2 pièces`,
          lastAction: [i],
        });
        setTimeout(() => setScreen('victory'), 800);
        return;
      }
      endTurn({ board: nb, lastAction: [i], lastMillCells: gs.lastMillCells });
      return;
    }

    if (phase === 'placing') {
      if (board[i] !== null) {
        playSound('invalid');
        return;
      }
      playSound('place');
      const nb = [...board];
      nb[i] = turn;
      const nplaced = { ...placed, [turn]: placed[turn] + 1 };
      const mills = millsFormedAt(nb, i, turn);
      if (mills.length > 0 && removablePieces(nb, opponent(turn)).length > 0) {
        playSound('mill');
        setGs({
          ...gs,
          board: nb,
          placed: nplaced,
          mustRemove: true,
          selected: null,
          lastMillCells: mills.flatMap((mi) => MILLS[mi]),
          lastAction: [i],
        });
      } else {
        endTurn({
          board: nb,
          placed: nplaced,
          lastMillCells: [],
          lastAction: [i],
        });
      }
      return;
    }

    // moving / flying
    if (board[i] === turn) {
      if (selected === i) {
        setGs({ ...gs, selected: null });
      } else {
        playSound('select');
        setGs({ ...gs, selected: i });
      }
      return;
    }
    if (selected !== null && board[i] === null) {
      if (!moveTargets.includes(i)) {
        playSound('invalid');
        return;
      }
      playSound('move');
      const nb = [...board];
      nb[selected] = null;
      nb[i] = turn;
      const mills = millsFormedAt(nb, i, turn);
      if (mills.length > 0 && removablePieces(nb, opponent(turn)).length > 0) {
        playSound('mill');
        setGs({
          ...gs,
          board: nb,
          mustRemove: true,
          selected: null,
          lastMillCells: mills.flatMap((mi) => MILLS[mi]),
          lastAction: [selected, i],
        });
      } else {
        endTurn({ board: nb, lastMillCells: [], lastAction: [selected, i] });
      }
    }
  }

  function startGame() {
    initAudio();
    setGs(initialGameState());
    setScreen('game');
  }

  function restart() {
    setGs(initialGameState());
    setScreen('game');
  }

  function backToMenu() {
    setScreen('menu');
  }

  /* ------------------------- status text --------------------------- */

  let status: string;
  if (winner) {
    status = `${NAME[winner]} a gagné !`;
  } else if (mustRemove) {
    status = `Moulin ! ${NAME[turn]} doit capturer une pièce ${NAME[opponent(turn)].toLowerCase()}`;
  } else if (phase === 'placing') {
    status = `${NAME[turn]} place une pièce · ${PIECES_PER_PLAYER - placed[turn]} restantes`;
  } else if (phase === 'flying') {
    status = `${NAME[turn]} vole ! (3 pièces restantes)`;
  } else {
    status = `${NAME[turn]} déplace une pièce`;
  }

  const phaseLabel =
    phase === 'placing'
      ? 'Phase 1 : Placement'
      : phase === 'flying'
        ? 'Phase 3 : Vol'
        : 'Phase 2 : Déplacement';

  /* ------------------------------------------------------------------ */
  /* MENU SCREEN                                                        */
  /* ------------------------------------------------------------------ */

  if (screen === 'menu') {
    return (
      <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#292524_0%,_#0c0a09_60%)] text-stone-100 flex flex-col items-center justify-center px-4 py-8 overflow-hidden relative">
        <div className="absolute inset-0 grain" />
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
          className="relative z-10 w-full max-w-2xl"
        >
          <div className="glass-card rounded-3xl p-8 sm:p-12 shadow-2xl shadow-black/70 text-center">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, type: 'spring' }}
              className="mb-2"
            >
              <Shield className="w-16 h-16 mx-auto text-amber-400 mb-3" />
            </motion.div>
            <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight mb-2 animate-title-shine bg-gradient-to-r from-amber-100 via-amber-400 via-amber-200 via-amber-500 to-amber-100 bg-clip-text text-transparent">
              Le Jeu du Moulin
            </h1>
            <p className="text-stone-400 text-sm sm:text-base mb-8">
              Un classique millénaire de stratégie
            </p>

            <div className="grid gap-5 text-left">
              <div>
                <label className="text-xs uppercase tracking-widest text-amber-500/80 font-bold ml-1">
                  Mode de jeu
                </label>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setSettings({ ...settings, gameMode: 'ai' })}
                    className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border transition-all ${
                      settings.gameMode === 'ai'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-100 shadow-lg shadow-amber-900/30'
                        : 'bg-stone-800/60 border-stone-700 text-stone-400 hover:border-stone-500'
                    }`}
                  >
                    <Bot size={18} /> Contre l&apos;IA
                  </button>
                  <button
                    onClick={() => setSettings({ ...settings, gameMode: 'pvp' })}
                    className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border transition-all ${
                      settings.gameMode === 'pvp'
                        ? 'bg-amber-500/20 border-amber-500 text-amber-100 shadow-lg shadow-amber-900/30'
                        : 'bg-stone-800/60 border-stone-700 text-stone-400 hover:border-stone-500'
                    }`}
                  >
                    <Users size={18} /> 2 Joueurs
                  </button>
                </div>
              </div>

              {settings.gameMode === 'ai' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="overflow-hidden"
                >
                  <label className="text-xs uppercase tracking-widest text-amber-500/80 font-bold ml-1">
                    Difficulté progressive
                  </label>
                  <div className="mt-2 grid gap-2">
                    {LEVELS.map((lvl) => (
                      <button
                        key={lvl}
                        onClick={() => setSettings({ ...settings, aiLevel: lvl })}
                        className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                          settings.aiLevel === lvl
                            ? 'bg-gradient-to-r from-amber-600/30 to-amber-900/30 border-amber-500 text-amber-100'
                            : 'bg-stone-800/40 border-stone-700 text-stone-300 hover:bg-stone-800/70'
                        }`}
                      >
                        <span className="font-semibold flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              lvl === 1
                                ? 'bg-green-400'
                                : lvl === 2
                                  ? 'bg-emerald-400'
                                  : lvl === 3
                                    ? 'bg-amber-400'
                                    : lvl === 4
                                      ? 'bg-orange-400'
                                      : 'bg-red-500'
                            }`}
                          />
                          {aiLevelName(lvl)}
                        </span>
                        <span className="text-xs text-stone-400">{LEVEL_DESC[lvl]}</span>
                      </button>
                    ))}
                  </div>

                  <label className="text-xs uppercase tracking-widest text-amber-500/80 font-bold ml-1 mt-5 block">
                    Votre couleur
                  </label>
                  <div className="mt-2 grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setSettings({ ...settings, playerSide: 'W' })}
                      className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border transition-all ${
                        settings.playerSide === 'W'
                          ? 'bg-stone-100 text-stone-900 border-stone-100 shadow-lg'
                          : 'bg-stone-800/60 border-stone-700 text-stone-300 hover:border-stone-500'
                      }`}
                    >
                      <span className="w-4 h-4 rounded-full bg-stone-100 border border-stone-400" />
                      Blancs
                    </button>
                    <button
                      onClick={() => setSettings({ ...settings, playerSide: 'B' })}
                      className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border transition-all ${
                        settings.playerSide === 'B'
                          ? 'bg-stone-900 text-stone-100 border-stone-500 shadow-lg'
                          : 'bg-stone-800/60 border-stone-700 text-stone-300 hover:border-stone-500'
                      }`}
                    >
                      <span className="w-4 h-4 rounded-full bg-stone-900 border border-stone-500" />
                      Noirs
                    </button>
                  </div>
                </motion.div>
              )}

              <button
                onClick={startGame}
                className="mt-4 group relative overflow-hidden px-8 py-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-700 text-stone-950 font-extrabold text-lg shadow-xl shadow-amber-950/40 hover:shadow-amber-900/60 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <span className="relative z-10 flex items-center justify-center gap-2">
                  Commencer la partie <ChevronRight size={20} />
                </span>
              </button>
            </div>
          </div>

          <div className="mt-6 text-center text-xs text-stone-500">
            Créé par <span className="text-amber-400 font-semibold">Hylst - Geoffroy</span> avec l&apos;aide d&apos;une IA
          </div>
        </motion.div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /* GAME SCREEN                                                        */
  /* ------------------------------------------------------------------ */

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#292524_0%,_#0c0a09_60%)] text-stone-100 flex flex-col items-center px-3 py-4 sm:py-6 relative overflow-hidden">
      <div className="absolute inset-0 grain" />

      {/* Top toolbar */}
      <div className="relative z-20 w-full max-w-6xl flex items-center justify-between mb-4">
        <button
          onClick={backToMenu}
          className="text-sm font-semibold text-stone-400 hover:text-amber-300 transition-colors flex items-center gap-1"
        >
          ← Menu
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSfxState(!sfx)}
            className="p-2 rounded-lg bg-stone-800/80 border border-stone-700 hover:border-amber-500/50 transition-colors"
            title={sfx ? 'Désactiver les effets' : 'Activer les effets'}
          >
            {sfx ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
          <button
            onClick={() => setMusicState(!music)}
            className="p-2 rounded-lg bg-stone-800/80 border border-stone-700 hover:border-amber-500/50 transition-colors"
            title={music ? 'Couper la musique' : 'Musique d\'ambiance'}
          >
            {music ? <Music2 size={18} /> : <Music size={18} />}
          </button>
          <button
            onClick={toggleFull}
            className="p-2 rounded-lg bg-stone-800/80 border border-stone-700 hover:border-amber-500/50 transition-colors"
            title="Plein écran"
          >
            {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
          <button
            onClick={restart}
            className="p-2 rounded-lg bg-stone-800/80 border border-stone-700 hover:border-amber-500/50 transition-colors"
            title="Recommencer"
          >
            <RotateCcw size={18} />
          </button>
        </div>
      </div>

      <header className="relative z-10 text-center mb-4">
        <motion.h1
          key={phase}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl sm:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-amber-200 via-amber-400 to-amber-200 bg-clip-text text-transparent"
        >
          Le Jeu du Moulin
        </motion.h1>
      </header>

      <div className="relative z-10 flex flex-col xl:flex-row items-center xl:items-start gap-5 w-full max-w-6xl justify-center">
        {/* White panel */}
        <PlayerPanel
          player="W"
          board={board}
          placed={placed}
          active={!winner && turn === 'W'}
          winner={winner}
          allPlaced={allPlaced}
          isAI={settings.gameMode === 'ai' && settings.playerSide !== 'W'}
          score={scores.W}
        />

        {/* Board container */}
        <div ref={boardRef} className="relative">
          <motion.div
            layout
            className={`rounded-2xl sm:rounded-3xl p-3 sm:p-5 shadow-2xl border-2 transition-colors duration-300 relative overflow-hidden ${
              mustRemove
                ? 'border-red-500/70 shadow-red-900/50'
                : 'border-amber-700/50 shadow-black/70'
            } bg-gradient-to-br from-[#8c653c] via-[#6e4d2a] to-[#4a3218] animate-wood-shimmer`}
            style={{
              backgroundImage:
                'linear-gradient(135deg, #9c7344 0%, #7a5530 25%, #5c3d20 50%, #7a5530 75%, #9c7344 100%)',
            }}
          >
            {/* inner bevel */}
            <div className="absolute inset-2 rounded-xl border border-amber-950/30 pointer-events-none" />
            <div className="absolute inset-0 rounded-2xl shadow-[inset_0_0_60px_rgba(0,0,0,0.45)] pointer-events-none" />

            <svg
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              className="w-[min(90vw,540px)] h-[min(90vw,540px)] block relative z-10"
            >
              <defs>
                {/* wood grain filter */}
                <filter id="woodGrain" x="0%" y="0%" width="100%" height="100%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.04 0.008" numOctaves="4" result="noise" />
                  <feColorMatrix type="saturate" values="0.3" in="noise" result="desat" />
                  <feBlend in="SourceGraphic" in2="desat" mode="multiply" />
                </filter>

                {/* piece gradients */}
                <radialGradient id="pw" cx="32%" cy="28%" r="80%">
                  <stop offset="0%" stopColor="#ffffff" />
                  <stop offset="35%" stopColor="#f5f5f4" />
                  <stop offset="70%" stopColor="#d6d3d1" />
                  <stop offset="100%" stopColor="#a8a29e" />
                </radialGradient>
                <radialGradient id="pb" cx="32%" cy="28%" r="80%">
                  <stop offset="0%" stopColor="#44403c" />
                  <stop offset="40%" stopColor="#292524" />
                  <stop offset="85%" stopColor="#0c0a09" />
                  <stop offset="100%" stopColor="#000000" />
                </radialGradient>

                {/* glow filter */}
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3.5" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {/* board lines */}
              {MILLS.map((m, idx) => (
                <motion.line
                  key={idx}
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1, delay: idx * 0.04 }}
                  x1={px(m[0])}
                  y1={py(m[0])}
                  x2={px(m[2])}
                  y2={py(m[2])}
                  stroke="#2a1a0d"
                  strokeWidth={6}
                  strokeLinecap="round"
                  opacity={0.95}
                />
              ))}

              {/* mill glow */}
              {millSegments.map((m, idx) => (
                <motion.line
                  key={`g${idx}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  x1={px(m[0])}
                  y1={py(m[0])}
                  x2={px(m[2])}
                  y2={py(m[2])}
                  stroke="#fbbf24"
                  strokeWidth={9}
                  strokeLinecap="round"
                  filter="url(#glow)"
                  className="animate-pulse-glow"
                />
              ))}

              {/* node dots */}
              {COORDS.map((_, i) => (
                <circle
                  key={`n${i}`}
                  cx={px(i)}
                  cy={py(i)}
                  r={8}
                  fill="#1c120a"
                  stroke="#5c3d20"
                  strokeWidth={1}
                />
              ))}

              {/* destination markers */}
              {moveTargets.map((i) => (
                <motion.circle
                  key={`d${i}`}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  cx={px(i)}
                  cy={py(i)}
                  r={13}
                  fill="none"
                  stroke="#4ade80"
                  strokeWidth={3}
                  strokeDasharray="4 3"
                  className="animate-pulse"
                />
              ))}

              {/* placement hints */}
              {!winner && !mustRemove && phase === 'placing' &&
                board.map((c, i) =>
                  c === null ? (
                    <circle
                      key={`h${i}`}
                      cx={px(i)}
                      cy={py(i)}
                      r={12}
                      fill={turn === 'W' ? '#f5f5f4' : '#1c1917'}
                      opacity={0.12}
                    />
                  ) : null
                )}

              {/* pieces */}
              <AnimatePresence>
                {board.map((c, i) =>
                  c ? (
                    <motion.g
                      key={`p${i}`}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ x: 0, y: 0, scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{
                        type: 'spring',
                        stiffness: 260,
                        damping: 18,
                      }}
                    >
                      {selected === i && (
                        <circle
                          cx={px(i)}
                          cy={py(i)}
                          r={28}
                          fill="none"
                          stroke="#4ade80"
                          strokeWidth={4}
                          filter="url(#glow)"
                          className="animate-ring-pulse"
                        />
                      )}
                      {removeTargets.includes(i) && (
                        <circle
                          cx={px(i)}
                          cy={py(i)}
                          r={28}
                          fill="none"
                          stroke="#f87171"
                          strokeWidth={4}
                          filter="url(#glow)"
                          className="animate-ring-pulse"
                        />
                      )}
                      <ellipse
                        cx={px(i)}
                        cy={py(i) + 5}
                        rx={22}
                        ry={22}
                        fill="black"
                        opacity={0.35}
                      />
                      <circle
                        cx={px(i)}
                        cy={py(i)}
                        r={22}
                        fill={c === 'W' ? 'url(#pw)' : 'url(#pb)'}
                        stroke={c === 'W' ? '#d6d3d1' : '#000000'}
                        strokeWidth={2}
                      />
                      <circle
                        cx={px(i)}
                        cy={py(i)}
                        r={14}
                        fill="none"
                        stroke={c === 'W' ? '#a8a29e' : '#44403c'}
                        strokeWidth={2}
                        opacity={0.7}
                      />
                      <circle
                        cx={px(i)}
                        cy={py(i)}
                        r={6}
                        fill={c === 'W' ? '#d6d3d1' : '#292524'}
                        opacity={0.5}
                      />
                    </motion.g>
                  ) : null
                )}
              </AnimatePresence>

              {/* click areas */}
              {COORDS.map((_, i) => {
                const clickable =
                  !winner &&
                  isHumanTurn(settings, gs) &&
                  (mustRemove
                    ? removeTargets.includes(i)
                    : phase === 'placing'
                      ? board[i] === null
                      : board[i] === turn || moveTargets.includes(i));
                return (
                  <circle
                    key={`c${i}`}
                    cx={px(i)}
                    cy={py(i)}
                    r={28}
                    fill="transparent"
                    onClick={() => handlePointClick(i)}
                    onMouseEnter={() => {
                      if (!clickable) return;
                      if (hoverSoundTimer.current) clearTimeout(hoverSoundTimer.current);
                      hoverSoundTimer.current = setTimeout(() => playSound('hover'), 60);
                    }}
                    style={{ cursor: clickable ? 'pointer' : 'default' }}
                  />
                );
              })}
            </svg>
          </motion.div>

          {/* capture particles */}
          <AnimatePresence>
            {captureEffects.map((eff) => (
              <motion.div
                key={eff.id}
                initial={{ opacity: 1, scale: 1 }}
                animate={{ opacity: 0, scale: 0, x: (eff.x - SIZE / 2) * 0.3, y: (eff.y - SIZE / 2) * 0.3 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.7 }}
                className="sparkle"
                style={{ left: eff.x, top: eff.y }}
              />
            ))}
          </AnimatePresence>
        </div>

        {/* Black panel */}
        <PlayerPanel
          player="B"
          board={board}
          placed={placed}
          active={!winner && turn === 'B'}
          winner={winner}
          allPlaced={allPlaced}
          isAI={settings.gameMode === 'ai' && settings.playerSide !== 'B'}
          score={scores.B}
        />
      </div>

      {/* Status */}
      <motion.div
        key={status}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={`relative z-10 mt-5 px-6 sm:px-8 py-3 rounded-2xl border text-center font-semibold shadow-xl backdrop-blur-sm transition-colors duration-300 ${
          winner
            ? 'bg-amber-500/15 border-amber-500/60 text-amber-300'
            : mustRemove
              ? 'bg-red-500/15 border-red-500/60 text-red-300'
              : 'glass-card text-stone-200'
        }`}
      >
        <div className="flex items-center justify-center gap-3">
          {!winner && (
            <span
              className={`inline-block w-4 h-4 rounded-full border shadow ${
                turn === 'W'
                  ? 'bg-gradient-to-br from-white to-stone-400 border-stone-300'
                  : 'bg-gradient-to-br from-stone-700 to-black border-stone-600'
              }`}
            />
          )}
          <span>{status}</span>
        </div>
        <div className="text-[11px] text-stone-400 mt-1 uppercase tracking-wider">
          {phaseLabel}
          {settings.gameMode === 'ai' && (
            <span className="ml-2">
              · IA : {aiLevelName(settings.aiLevel)}
            </span>
          )}
        </div>
      </motion.div>

      <div className="relative z-10 flex gap-3 mt-4">
        <button
          onClick={() => setShowRules(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-stone-800/80 hover:bg-stone-700 border border-stone-700 text-stone-300 text-sm font-medium transition-colors"
        >
          <Info size={16} /> Règles
        </button>
        <button
          onClick={restart}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-stone-800/80 hover:bg-stone-700 border border-stone-700 text-stone-300 text-sm font-medium transition-colors"
        >
          <RotateCcw size={16} /> Recommencer
        </button>
      </div>

      <div className="relative z-10 mt-3 text-[10px] text-stone-600">
        Hylst - Geoffroy avec l&apos;aide d&apos;une IA
      </div>

      {/* Rules modal */}
      <AnimatePresence>
        {showRules && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowRules(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass-card max-w-md w-full rounded-2xl p-6 border border-amber-700/40 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-xl font-bold text-amber-300 mb-3">Règles du Jeu du Moulin</h2>
              <ul className="space-y-2 text-sm text-stone-300 list-disc list-inside">
                <li><b>Placement</b> : posez à tour de rôle vos 9 pions sur les intersections libres.</li>
                <li><b>Moulin</b> : alignez 3 pions pour capturer un pion adverse. Les pions dans un moulin sont protégés sauf s&apos;ils sont tous en moulin.</li>
                <li><b>Déplacement</b> : une fois tous les pions posés, glissez un pion vers une case adjacente.</li>
                <li><b>Vol</b> : s&apos;il vous reste 3 pions, vous pouvez voler n&apos;importe où.</li>
                <li><b>Victoire</b> : gagnez si l&apos;adversaire n&apos;a plus que 2 pions ou est bloqué.</li>
              </ul>
              <button
                onClick={() => setShowRules(false)}
                className="mt-5 w-full py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-stone-950 font-semibold"
              >
                J&apos;ai compris
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Victory overlay */}
      <AnimatePresence>
        {screen === 'victory' && winner && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
          >
            <Confetti />
            <motion.div
              initial={{ scale: 0.6, opacity: 0, y: 40 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ type: 'spring', damping: 14 }}
              className="glass-card max-w-md w-full rounded-3xl p-8 text-center border border-amber-500/40 shadow-2xl shadow-amber-900/40"
            >
              <motion.div
                animate={{ rotate: [0, 10, -10, 0], scale: [1, 1.2, 1] }}
                transition={{ duration: 1, repeat: Infinity, repeatDelay: 1 }}
                className="inline-block mb-4"
              >
                <Trophy className="w-20 h-20 text-amber-400 mx-auto" />
              </motion.div>
              <h2 className="text-3xl font-extrabold text-amber-100 mb-1">{NAME[winner]} gagne !</h2>
              <p className="text-stone-400 mb-6">{gs.winReason}</p>
              <div className="grid gap-3">
                <button
                  onClick={restart}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-amber-700 text-stone-950 font-bold hover:shadow-lg transition-all"
                >
                  Rejouer
                </button>
                <button
                  onClick={backToMenu}
                  className="w-full py-3 rounded-xl bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-300 font-semibold transition-all"
                >
                  Retour au menu
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Player panel                                                       */
/* ------------------------------------------------------------------ */

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 60 }).map((_, i) => ({
        id: i,
        x: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 1.5 + Math.random() * 1.5,
        color: ['#fbbf24', '#f87171', '#4ade80', '#60a5fa', '#a78bfa'][Math.floor(Math.random() * 5)],
        size: 6 + Math.random() * 8,
        rotation: Math.random() * 360,
      })),
    []
  );

  return (
    <div className="fixed inset-0 pointer-events-none z-[60] overflow-hidden">
      {pieces.map((p) => (
        <motion.div
          key={p.id}
          initial={{ y: -20, x: `${p.x}vw`, opacity: 1, rotate: 0 }}
          animate={{
            y: '110vh',
            rotate: p.rotation + 720,
            x: `${p.x + (Math.random() - 0.5) * 30}vw`,
          }}
          transition={{ duration: p.duration, delay: p.delay, ease: 'linear' }}
          className="absolute rounded-sm"
          style={{
            backgroundColor: p.color,
            width: p.size,
            height: p.size * 0.6,
          }}
        />
      ))}
    </div>
  );
}

function PlayerPanel({
  player,
  board,
  placed,
  active,
  winner,
  allPlaced,
  isAI,
  score,
}: {
  player: Player;
  board: Cell[];
  placed: Record<Player, number>;
  active: boolean;
  winner: Player | null;
  allPlaced: boolean;
  isAI: boolean;
  score: number;
}) {
  const inHand = PIECES_PER_PLAYER - placed[player];
  const onBoard = countPieces(board, player);
  const lost = placed[player] - onBoard;
  const fly = isFlying(board, player, allPlaced);

  return (
    <motion.div
      animate={active ? { scale: 1.02 } : { scale: 1 }}
      className={`w-full max-w-xs xl:w-52 rounded-2xl border p-4 transition-all duration-300 backdrop-blur-sm ${
        active
          ? 'border-amber-500/60 bg-stone-800/85 shadow-xl shadow-amber-900/20'
          : 'border-stone-800 bg-stone-900/60'
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`w-8 h-8 rounded-full border-2 shadow-lg ${
            player === 'W'
              ? 'bg-gradient-to-br from-white to-stone-400 border-stone-200'
              : 'bg-gradient-to-br from-stone-700 to-black border-stone-600'
          }`}
        />
        <div>
          <span className="font-bold block leading-tight">{NAME[player]}</span>
          <span className="text-[10px] text-stone-500">{isAI ? 'Contrôlé par l\'IA' : 'Joueur humain'}</span>
        </div>
        <div className="ml-auto text-center">
          <div className="text-lg font-bold leading-none text-amber-400">{score}</div>
          <div className="text-[9px] text-stone-500 uppercase">victoires</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-widest text-stone-500 mb-2 flex justify-between">
          <span>En main</span>
          <span>{inHand}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 min-h-[18px]">
          {Array.from({ length: inHand }).map((_, i) => (
            <motion.span
              key={i}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: i * 0.03 }}
              className={`w-4 h-4 rounded-full shadow ${
                player === 'W'
                  ? 'bg-gradient-to-br from-white to-stone-400'
                  : 'bg-gradient-to-br from-stone-600 to-black border border-stone-700'
              }`}
            />
          ))}
          {inHand === 0 && <span className="text-xs text-stone-600">aucun</span>}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-stone-800/80 py-2 border border-stone-700/50">
          <div className="text-xl font-bold leading-none">{onBoard}</div>
          <div className="text-[9px] text-stone-500 uppercase tracking-wider mt-1">sur le plateau</div>
        </div>
        <div className="rounded-xl bg-stone-800/80 py-2 border border-stone-700/50">
          <div className="text-xl font-bold leading-none text-red-400/90">{lost}</div>
          <div className="text-[9px] text-stone-500 uppercase tracking-wider mt-1">capturés</div>
        </div>
      </div>

      {fly && !winner && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-3 text-center text-[11px] font-bold text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-lg py-1.5"
        >
          ✈ Mode vol activé
        </motion.div>
      )}
    </motion.div>
  );
}
