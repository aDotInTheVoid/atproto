import { InvalidRequestError } from '@atproto/xrpc-server'
import { AtUri } from '@atproto/uri'
import { ModerationAction } from '../../../../db/tables/moderation'
import { ModerationReport } from '../../../../db/tables/moderation'
import { InputSchema as ReportInput } from '../../../../lexicon/types/com/atproto/moderation/createReport'
import { InputSchema as ActionInput } from '../../../../lexicon/types/com/atproto/admin/takeModerationAction'
import {
  ACKNOWLEDGE,
  FLAG,
  TAKEDOWN,
  ESCALATE,
} from '../../../../lexicon/types/com/atproto/admin/defs'
import {
  REASONOTHER,
  REASONSPAM,
  REASONMISLEADING,
  REASONRUDE,
  REASONSEXUAL,
  REASONVIOLATION,
} from '../../../../lexicon/types/com/atproto/moderation/defs'
import { parseCidParam } from '../../../../util/params'

type SubjectInput = ReportInput['subject'] | ActionInput['subject']

export const getSubject = (subject: SubjectInput) => {
  if (
    subject.$type === 'com.atproto.admin.defs#repoRef' &&
    typeof subject.did === 'string'
  ) {
    return { did: subject.did }
  }
  if (
    subject.$type === 'com.atproto.repo.strongRef' &&
    typeof subject.uri === 'string' &&
    typeof subject.cid === 'string'
  ) {
    return {
      uri: new AtUri(subject.uri),
      cid: parseCidParam(subject.cid),
    }
  }
  throw new InvalidRequestError('Invalid subject')
}

export const getReasonType = (reasonType: ReportInput['reasonType']) => {
  if (reasonTypes.has(reasonType)) {
    return reasonType as ModerationReport['reasonType']
  }
  throw new InvalidRequestError('Invalid reason type')
}

export const getAction = (action: ActionInput['action']) => {
  if (
    action === TAKEDOWN ||
    action === FLAG ||
    action === ACKNOWLEDGE ||
    action === ESCALATE
  ) {
    return action as ModerationAction['action']
  }
  throw new InvalidRequestError('Invalid action')
}

const reasonTypes = new Set([
  REASONOTHER,
  REASONSPAM,
  REASONMISLEADING,
  REASONRUDE,
  REASONSEXUAL,
  REASONVIOLATION,
])
