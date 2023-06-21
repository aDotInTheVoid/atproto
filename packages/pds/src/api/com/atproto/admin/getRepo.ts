import { InvalidRequestError } from '@atproto/xrpc-server'
import { Server } from '../../../../lexicon'
import AppContext from '../../../../context'
import { RepoNotFoundError } from '@atproto/api/src/client/types/com/atproto/admin/getRepo'
import { authPassthru, mergeRepoViewPdsDetails } from './util'

export default function (server: Server, ctx: AppContext) {
  server.com.atproto.admin.getRepo({
    auth: ctx.moderatorVerifier,
    handler: async ({ req, params }) => {
      const { db, services } = ctx
      const { did } = params
      const result = await services.account(db).getAccount(did, true)
      const repoDetail =
        result && (await services.moderation(db).views.repoDetail(result))

      if (ctx.shouldProxyModeration()) {
        try {
          let { data: repoDetailAppview } =
            await ctx.appviewAgent.com.atproto.admin.getRepo(
              params,
              authPassthru(req),
            )
          if (repoDetail) {
            repoDetailAppview = mergeRepoViewPdsDetails(
              repoDetailAppview,
              repoDetail,
            )
          }
          return {
            encoding: 'application/json',
            body: repoDetailAppview,
          }
        } catch (err) {
          if (err instanceof RepoNotFoundError) {
            throw new InvalidRequestError('Repo not found', 'RepoNotFound')
          } else {
            throw err
          }
        }
      }

      if (!repoDetail) {
        throw new InvalidRequestError('Repo not found', 'RepoNotFound')
      }
      return {
        encoding: 'application/json',
        body: repoDetail,
      }
    },
  })
}
