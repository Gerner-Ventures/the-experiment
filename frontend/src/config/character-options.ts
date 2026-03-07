export interface CharacterOption {
  id: string
  name: string
  description: string
  tags: string[]
}

export const CHARACTERS: CharacterOption[] = [
  // Lab rats
  { id: 'intern', name: 'The Intern', description: 'Was told this was a team-building exercise.', tags: ['naive', 'expendable'] },
  { id: 'patient-zero', name: 'Patient Zero', description: 'Doesn\'t remember signing a waiver.', tags: ['confused', 'suspicious'] },
  { id: 'volunteer', name: 'The Volunteer', description: 'Answered a Craigslist ad. Regrets everything.', tags: ['desperate', 'optimistic'] },
  { id: 'whistleblower', name: 'The Whistleblower', description: 'Knows too much. Trusted too little.', tags: ['paranoid', 'righteous'] },

  // Authority figures
  { id: 'middle-mgmt', name: 'Middle Management', description: 'Will form a committee about the apocalypse.', tags: ['bureaucratic', 'delusional'] },
  { id: 'hall-monitor', name: 'The Hall Monitor', description: 'Rules are rules, even at the end of the world.', tags: ['authoritarian', 'petty'] },
  { id: 'influencer', name: 'The Influencer', description: 'Live-streaming the collapse for engagement.', tags: ['narcissistic', 'connected'] },
  { id: 'politician', name: 'The Politician', description: 'Promises solutions. Delivers speeches.', tags: ['charismatic', 'hollow'] },

  // Survivors
  { id: 'prepper', name: 'The Prepper', description: 'Has been waiting for this. Almost disappointed it\'s not worse.', tags: ['prepared', 'unhinged'] },
  { id: 'medic', name: 'The Medic', description: 'Will save your life. Will also judge your choices.', tags: ['skilled', 'judgemental'] },
  { id: 'engineer', name: 'The Engineer', description: 'Can fix anything except human relationships.', tags: ['useful', 'antisocial'] },
  { id: 'chef', name: 'The Chef', description: 'Knows 47 uses for a knife. Cooking is just one.', tags: ['resourceful', 'menacing'] },

  // Wildcards
  { id: 'philosopher', name: 'The Philosopher', description: 'Questions reality. Unhelpful during crises.', tags: ['intellectual', 'useless'] },
  { id: 'child', name: 'The Kid', description: 'Somehow wandered in. Creepily calm about everything.', tags: ['innocent', 'unsettling'] },
  { id: 'therapist', name: 'The Therapist', description: 'Wants to talk about your feelings while the building burns.', tags: ['empathetic', 'tone-deaf'] },
  { id: 'con-artist', name: 'The Con Artist', description: 'Has three fake IDs and zero genuine emotions.', tags: ['deceptive', 'charming'] },

  // Dark humor specials
  { id: 'nihilist', name: 'The Nihilist', description: 'Nothing matters. Especially your survival plan.', tags: ['apathetic', 'honest'] },
  { id: 'optimist', name: 'The Optimist', description: 'Everything is fine. The fire is cozy, actually.', tags: ['delusional', 'cheerful'] },
  { id: 'conspiracy', name: 'The Theorist', description: 'Was right about everything. Nobody listened.', tags: ['paranoid', 'vindicated'] },
  { id: 'sleeper', name: 'The Sleeper', description: 'Slept through orientation. Might sleep through the apocalypse.', tags: ['oblivious', 'lucky'] },
  { id: 'clone', name: 'The Clone', description: 'Pretty sure they\'ve been here before. Déjà vu is an understatement.', tags: ['meta', 'existential'] },
  { id: 'mascot', name: 'The Mascot', description: 'Wore the costume ironically. Can\'t get it off now.', tags: ['absurd', 'trapped'] },
]

export const DEFAULT_CHARACTER_ID = 'volunteer'
