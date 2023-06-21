import { AtUri } from '@atproto/uri'
import { InvalidRequestError } from '@atproto/xrpc-server'
import { isRepoRef } from '@atproto/api/src/client/types/com/atproto/admin/defs'
import { isMain as isStrongRef } from '@atproto/api/src/client/types/com/atproto/repo/strongRef'
import { Server } from '../../../../lexicon'
import AppContext from '../../../../context'
import { TAKEDOWN } from '../../../../lexicon/types/com/atproto/admin/defs'
import { authPassthru } from './util'

export default function (server: Server, ctx: AppContext) {
  server.com.atproto.admin.reverseModerationAction({
    auth: ctx.adminVerifier,
    handler: async ({ req, input }) => {
      const { db, services } = ctx
      if (ctx.shouldProxyModeration()) {
        const { data: result } =
          await ctx.appviewAgent.com.atproto.admin.reverseModerationAction(
            input.body,
            authPassthru(req, true),
          )

        const transact = db.transaction(async (dbTxn) => {
          const moderationTxn = services.moderation(dbTxn)
          const labelTxn = services.appView.label(dbTxn)
          // reverse takedowns
          if (result.action === TAKEDOWN && isRepoRef(result.subject)) {
            await moderationTxn.reverseTakedownRepo({
              did: result.subject.did,
            })
          }
          if (result.action === TAKEDOWN && isStrongRef(result.subject)) {
            await moderationTxn.reverseTakedownRecord({
              uri: new AtUri(result.subject.uri),
            })
          }
          // invert label creation & negations
          const reverseLabels = (uri: string, cid: string | null) =>
            labelTxn.formatAndCreate(ctx.cfg.labelerDid, uri, cid, {
              create: result.negateLabelVals,
              negate: result.createLabelVals,
            })
          if (isRepoRef(result.subject)) {
            await reverseLabels(result.subject.did, null)
          }
          if (isStrongRef(result.subject)) {
            await reverseLabels(result.subject.uri, result.subject.cid)
          }
        })

        try {
          await transact
        } catch (err) {
          req.log.error(
            { err, actionId: input.body.id },
            'proxied moderation action reversal failed',
          )
        }

        return {
          encoding: 'application/json',
          body: result,
        }
      }

      const moderationService = services.moderation(db)
      const { id, createdBy, reason } = input.body

      const moderationAction = await db.transaction(async (dbTxn) => {
        const moderationTxn = services.moderation(dbTxn)
        const labelTxn = services.appView.label(dbTxn)
        const now = new Date()

        const existing = await moderationTxn.getAction(id)
        if (!existing) {
          throw new InvalidRequestError('Moderation action does not exist')
        }
        if (existing.reversedAt !== null) {
          throw new InvalidRequestError(
            'Moderation action has already been reversed',
          )
        }

        const result = await moderationTxn.logReverseAction({
          id,
          createdAt: now,
          createdBy,
          reason,
        })

        if (
          result.action === TAKEDOWN &&
          result.subjectType === 'com.atproto.admin.defs#repoRef' &&
          result.subjectDid
        ) {
          await moderationTxn.reverseTakedownRepo({
            did: result.subjectDid,
          })
        }

        if (
          result.action === TAKEDOWN &&
          result.subjectType === 'com.atproto.repo.strongRef' &&
          result.subjectUri
        ) {
          await moderationTxn.reverseTakedownRecord({
            uri: new AtUri(result.subjectUri),
          })
        }

        // invert creates & negates
        const { createLabelVals, negateLabelVals } = result
        const negate =
          createLabelVals && createLabelVals.length > 0
            ? createLabelVals.split(' ')
            : undefined
        const create =
          negateLabelVals && negateLabelVals.length > 0
            ? negateLabelVals.split(' ')
            : undefined
        await labelTxn.formatAndCreate(
          ctx.cfg.labelerDid,
          result.subjectUri ?? result.subjectDid,
          result.subjectCid,
          { create, negate },
        )

        return result
      })

      return {
        encoding: 'application/json',
        body: await moderationService.views.action(moderationAction),
      }
    },
  })
}
