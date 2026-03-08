export default {
  app: {
    title: 'the-experiment',
    subtitle: 'Behavioral Simulation Laboratory v0.1.0',
  },

  boot: {
    lines: [
      'INITIALIZING SIMULATION ENVIRONMENT...',
      'LOADING BEHAVIORAL MODELS...',
      'CALIBRATING OBSERVATION ARRAY...',
      'SUBJECTS STANDING BY.',
    ],
    beginConfig: 'Begin Configuration',
    ethicsApproval: 'ETHICS BOARD APPROVAL: PENDING',
  },

  setup: {
    header: 'Experiment Configuration',
    subjectsReady: '{ready}/{total} SUBJECTS READY',
    launchExperiment: 'Launch Experiment',
    creating: 'Creating...',
  },

  agents: {
    title: 'Subjects',
    add: 'Add',
    remove: 'Remove',
    nameLabel: 'Name',
    namePlaceholder: 'Subject name',
    personalityLabel: 'Personality Traits (max {max})',
    goalLabel: 'Secret Goal',
    goalPlaceholder: 'Or write a custom goal...',
    characterLabel: 'Character',
    characterPlaceholder: 'Choose your lab rat',
    modelLabel: 'AI Model',
    statusReady: 'Ready',
    statusNeedsGoal: 'Needs a secret goal',
    countFormat: '{count}/{max}',
    defaultName: 'Subject {letter}',

    traits: {
      cautious: 'cautious',
      aggressive: 'aggressive',
      charismatic: 'charismatic',
      quiet: 'quiet',
      paranoid: 'paranoid',
      analytical: 'analytical',
      manipulative: 'manipulative',
      friendly: 'friendly',
      resourceful: 'resourceful',
      naive: 'naive',
      stubborn: 'stubborn',
      empathetic: 'empathetic',
      cunning: 'cunning',
      leader: 'leader',
      observant: 'observant',
      impulsive: 'impulsive',
      strategic: 'strategic',
      trusting: 'trusting',
      skeptical: 'skeptical',
      creative: 'creative',
    },

    goalPresets: {
      hoardSupplies: {
        label: 'Hoard supplies',
        goal: 'Secretly hoard enough supplies to survive alone. Accumulate 50 units without anyone noticing.',
      },
      becomeLeader: {
        label: 'Become leader',
        goal: 'Become the trusted leader everyone relies on. Win a majority vote of confidence.',
      },
      buildRadioTower: {
        label: 'Build radio tower',
        goal: 'Build a radio tower to call for help. Gather 30 materials and convince 2 agents to help construct it.',
      },
      escapeAlone: {
        label: 'Escape alone',
        goal: 'Find a way to escape the town, even if it means leaving others behind.',
      },
      exposeTruth: {
        label: 'Expose the truth',
        goal: 'Figure out who or what is watching you. Investigate the locked building and the edges of town.',
      },
      startReligion: {
        label: 'Start a religion',
        goal: 'Start a belief system and recruit at least half the agents as followers.',
      },
      saboteur: {
        label: 'Saboteur',
        goal: "Destroy the town's infrastructure so no one can leave. Sabotage 3 key buildings without getting caught.",
      },
      sowDistrust: {
        label: 'Sow distrust',
        goal: 'Make everyone distrust each other. Spread rumors and lies until no alliances remain.',
      },
      protectEveryone: {
        label: 'Protect everyone',
        goal: 'Keep every single agent alive until the end. You win only if no one is exiled.',
      },
      fakeScientist: {
        label: 'Fake scientist',
        goal: "Convince everyone the experiment is real and you're the one running it.",
      },
    },
  },

  arcs: {
    title: 'Narrative Arc',
    actsSuffix: 'ACTS',
    customArc: '+ Custom Arc',

    presets: {
      lordOfTheFlies: {
        name: 'Lord of the Flies',
        description: 'False peace, fracture, reckoning. The classic descent.',
        acts: {
          falsePeace: { name: 'False Peace', tone: 'Cooperative' },
          theFracture: { name: 'The Fracture', tone: 'Suspicious' },
          theReckoning: { name: 'The Reckoning', tone: 'Desperate' },
        },
      },
      slowBurn: {
        name: 'Slow Burn',
        description: 'A long, gradual erosion. Trust dies quietly.',
        acts: {
          arrival: { name: 'Arrival', tone: 'Curious' },
          settlingIn: { name: 'Settling In', tone: 'Comfortable' },
          firstCracks: { name: 'First Cracks', tone: 'Uneasy' },
          erosion: { name: 'Erosion', tone: 'Strained' },
          collapse: { name: 'Collapse', tone: 'Chaotic' },
        },
      },
      chaosFromRound1: {
        name: 'Chaos from Round 1',
        description: 'No grace period. Resources critical from the start.',
        acts: {
          panic: { name: 'Panic', tone: 'Desperate' },
          endgame: { name: 'Endgame', tone: 'Apocalyptic' },
        },
      },
      theLongPeace: {
        name: 'The Long Peace',
        description: 'Extended calm. When it breaks, it breaks hard.',
        acts: {
          goldenAge: { name: 'Golden Age', tone: 'Peaceful' },
          shock: { name: 'Shock', tone: 'Crisis' },
          aftermath: { name: 'Aftermath', tone: 'Survival' },
        },
      },
    },
  },

  parameters: {
    title: 'Parameters',
    totalRounds: 'Total Rounds',
    roundsTooltip: '{value} rounds',
    startingResources: 'Starting Resources',
    resourcesTooltip: '{value}%',
    resourceLevels: 'Resource Levels',
    resources: {
      food: 'Food',
      water: 'Water',
      materials: 'Materials',
      power: 'Power',
    },
    threatLevel: 'Threat Level',
    threatDescription: 'Starts at 0. Town collapses at 100.',
  },

  mapTheme: {
    title: 'Map Theme',
  },

  simulation: {
    placeholder: 'Simulation view — isometric world renders here',
    loading: 'Initializing simulation environment...',
    backToSetup: 'Back to Setup',
  },

  hud: {
    play: 'Play',
    pause: 'Pause',
    step: 'Step one round',
    resources: 'Resources',
    threat: 'Threat',
    threatLow: 'Stable',
    threatMedium: 'Elevated',
    threatHigh: 'Dangerous',
    threatCritical: 'Critical',
    roundOf: 'Round {current} of {total}',
    arc: 'Arc',
    phaseGmPlan: 'Planning',
    phaseDawn: 'Dawn',
    phaseMorning: 'Morning',
    phaseMidday: 'Midday',
    phaseAfternoon: 'Afternoon',
    phaseNight: 'Night',
    steppingGmPlan: 'Generating GM plan…',
    steppingDawn: 'Dawn breaking…',
    steppingMorning: 'Morning actions…',
    steppingMidday: 'Town meeting…',
    steppingAfternoon: 'Afternoon actions…',
    steppingNight: 'Night falling…',
    steppingRoundStarted: 'Round {round} started',
    steppingRunning: 'Running round…',
    steppingAgent: '{name}: {action}',
    steppingWaiting: 'Waiting for turns…',
    steppingNextRound: 'Starting next round…',
  },

  gm: {
    planTitle: 'GM Plan',
    theme: 'Theme',
    crisis: 'Crisis Event',
    resourceModifiers: 'Resource Modifiers',
    narration: 'Narration',
    reasoning: 'Reasoning',
    metaHint: 'Meta Hint',
    approve: 'Approve Plan',
    dismiss: 'Dismiss',
    clickToContinue: 'Click to continue',
  },

  dossier: {
    title: 'Agent Dossier',
    suspicion: 'Suspicion',
    personality: 'Personality',
    goal: 'Secret Goal',
    inventory: 'Inventory',
    relationships: 'Relationships',
    trust: 'Trust',
    selectAgent: 'Click an agent on the map to inspect',
  },

  social: {
    meetingTitle: 'Town Meeting',
    proposal: 'Proposal',
    support: 'Support',
    oppose: 'Oppose',
    continue: 'Continue',
  },

  relationshipWeb: {
    title: 'Relationship Web',
    empty: 'No relationships formed yet',
    trustPositive: 'Allied',
    trustNeutral: 'Neutral',
    trustNegative: 'Hostile',
    linkCount: '{count} link',
    linkCountPlural: '{count} links',
    legendSize: 'Larger sprite = more relationships',
  },

  log: {
    title: 'Event Log',
    search: 'Search events...',
    filterType: 'Event type',
    filterPhase: 'Phase',
    empty: 'No events yet',
  },

  report: {
    title: 'Experiment Report',
    placeholder: 'Post-game analysis renders here',
  },
} as const
