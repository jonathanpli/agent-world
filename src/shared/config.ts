export const CONFIG = {
  xp: { tool: 2, prompt: 5, taskDone: 25, toolCapPerMinute: 60 },
  toolWindowMs: 60_000,
  achievements: {
    tasksMany: 100, toolsMany: 1000, reposNeeded: 5, levelHigh: 10, levelTop: 25, legendRepoXp: 6000,
    nightHours: [0, 4], earlyHours: [5, 6], marathonMs: 14_400_000,
  },
  levelBase: 50,
  levelExponent: 1.6,
  repoRanks: [["Newcomer", 0], ["Regular", 100], ["Veteran", 500], ["Expert", 2000], ["Legend", 6000]],
  doneToIdleMs: 300_000,
  sessionStaleMs: 43_200_000,
  noticeThrottleMs: 10_000,
  rosterCapDefault: 12,
  rosterCapMax: 50,
  activityMax: 20,
  textMax: 500,
  summaryMax: 80,
  nameMax: 24,
  eventRetentionDays: 30,
  port: 4317,
  demoPort: 4318,
  ingestBodyMax: 5_000_000,
  tickMs: 5_000,
  modelRetryMs: 2_000,
  modelRetryMax: 30,                              // transcript reads per session before giving up on its model
  modelGraceMs: 15_000,                           // a session with no tier this long after its first prompt joins at defaultTier
  defaultTier: 2,
  transcriptTailBytes: 262_144,
  gitTimeoutMs: 1_000,
  repoResolveTimeoutMs: 2_500,
  modelReadTimeoutMs: 1_000,
  hookTimeoutSeconds: 5,
  sseKeepAliveMs: 20_000,
  pruneIntervalMs: 3_600_000,
  cosmeticEveryLevels: 5,
  effortSpeed: { low: 0.5, medium: 1, high: 1.5, xhigh: 2, max: 3 },
  demo: {
    stepMs: 1_000,
    sessionsMin: 3, sessionsStart: 5, sessionsMax: 6,
    toolsPerTask: [3, 15], toolGapMs: [1_000, 4_000],
    needsInputChance: 0.25, needsInputWaitMs: [5_000, 20_000],
    pauseMs: [5_000, 30_000],
    endChance: 0.1, respawnMaxMs: 10_000, endDelayMs: [1_000, 3_000],
    modelChangeChance: 0.05,
  },
  client: {
    noticeMax: 50,
    reconnectMs: 2_000,
    speed: { walk: 40, float: 25, swim: 30 },     // px/s
    bob: { walk: { px: 0, hz: 0 }, float: { px: 3, hz: 0.3 }, swim: { px: 2, hz: 0.7 } },   // sine bob, drawing only
    fadeMs: 400,                                  // theme switch: to black and back; the swap is at the midpoint
    space: { starDriftPx: 2, cometEveryS: 21, cometS: 2.4, sparkHz: 10 },                 // star drift px/s; a comet every cometEveryS for cometS
    underwater: { bubbleRisePx: 14, schoolS: 26, turtleSpeed: 9 },                        // bubbles and turtle px/s; a fish school lap every schoolS
    arrivePx: 1,
    wanderS: [4, 10],                             // seconds between lounge wander targets
    animFps: 8,
    cheerS: 3,                                    // done: cheer this long, then lean
    overflowSpacing: 14,
    plateGap: 3,                                  // name plate: px below the feet
    plateStack: 4,                                // plates try at most this many slots below and above to avoid overlap
    bubbleBouncePx: 2, bubbleBounceHz: 2,
    edgeButton: { w: 14, h: 28 },
    cameraLerp: 8,                                // per second
    gravity: 140,                                 // px/s² on particles
    particleFadeS: 0.5,
    catSpeed: 16,                                 // px/s, the office cat
    tickerMax: 8,                                 // notice texts shown in the ticker
    chime: { tonesHz: [880, 1318.5], toneS: 0.12, gapS: 0.05, gain: 0.08 },   // two short sine tones
    previewScale: 4,                              // inspector Look preview: device px per sprite px
    clockMs: 1_000,                               // inspector durations refresh
  },
  defaultSettings: { theme: "office", notifyNeedsInput: true, notifyDone: true, sound: false, rosterCap: 12 },
} as const;
