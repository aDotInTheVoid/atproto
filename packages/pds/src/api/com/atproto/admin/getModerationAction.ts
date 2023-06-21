import { Server } from '../../../../lexicon'
import AppContext from '../../../../context'
import { authPassthru } from './util'

export default function (server: Server, ctx: AppContext) {
  server.com.atproto.admin.getModerationAction({
    auth: ctx.moderatorVerifier,
    handler: async ({ req, params }) => {
      if (ctx.canProxyModeration()) {
        const { data: result } =
          await ctx.appviewAgent.com.atproto.admin.getModerationAction(
            params,
            authPassthru(req),
          )
        return {
          encoding: 'application/json',
          body: result,
        }
      }

      const { db, services } = ctx
      const { id } = params
      const moderationService = services.moderation(db)
      const result = await moderationService.getActionOrThrow(id)
      return {
        encoding: 'application/json',
        body: await moderationService.views.actionDetail(result),
      }
    },
  })
}
