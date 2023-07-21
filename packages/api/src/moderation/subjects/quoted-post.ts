import { AppBskyEmbedRecord, AppBskyEmbedRecordWithMedia } from '../../client'
import { ModerationCauseAccumulator } from '../accumulator'
import { ModerationApplyOpts, ModerationDecision } from '../types'
import { decideAccount } from './account'

export function decideQuotedPost(
  subject: AppBskyEmbedRecord.View,
  opts: ModerationApplyOpts,
): ModerationDecision {
  const acc = new ModerationCauseAccumulator()

  if (AppBskyEmbedRecord.isViewRecord(subject.record)) {
    acc.setIsMe(subject.record.author.did === opts.userDid)

    if (subject.record.labels?.length) {
      for (const label of subject.record.labels) {
        acc.addLabel(label, opts)
      }
    }
  }

  return acc.finalizeDecision(opts)
}

export function decideQuotedPostAccount(
  subject: AppBskyEmbedRecord.View,
  opts: ModerationApplyOpts,
): ModerationDecision {
  if (AppBskyEmbedRecord.isViewRecord(subject.record)) {
    return decideAccount(subject.record.author, opts)
  }
  return ModerationDecision.noop()
}

export function decideQuotedPostWithMedia(
  subject: AppBskyEmbedRecordWithMedia.View,
  opts: ModerationApplyOpts,
): ModerationDecision {
  const acc = new ModerationCauseAccumulator()

  if (AppBskyEmbedRecord.isViewRecord(subject.record.record)) {
    acc.setIsMe(subject.record.record.author.did === opts.userDid)

    if (subject.record.record.labels?.length) {
      for (const label of subject.record.record.labels) {
        acc.addLabel(label, opts)
      }
    }
  }

  return acc.finalizeDecision(opts)
}

export function decideQuotedPostWithMediaAccount(
  subject: AppBskyEmbedRecordWithMedia.View,
  opts: ModerationApplyOpts,
): ModerationDecision {
  if (AppBskyEmbedRecord.isViewRecord(subject.record.record)) {
    return decideAccount(subject.record.record.author, opts)
  }
  return ModerationDecision.noop()
}
