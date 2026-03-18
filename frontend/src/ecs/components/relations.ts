/**
 * ECS Relations — CausedBy, Targets, Trusts, LocatedAt.
 */

import {
  createRelation,
  withAutoRemoveSubject,
  withStore,
  makeExclusive,
} from 'bitecs'

/** Consequence -> aggressor link. Auto-removes if aggressor entity is destroyed. */
export const CausedBy = createRelation(withAutoRemoveSubject)

/** Aggressor -> victim. Exclusive: one target per action at a time. */
export const Targets = createRelation(makeExclusive)

/** Social trust relationship with data store. */
export const Trusts = createRelation(withStore(() => ({ level: 0.5 })))

/** Agent -> location entity. Exclusive: one location at a time. */
export const LocatedAt = createRelation(makeExclusive)
