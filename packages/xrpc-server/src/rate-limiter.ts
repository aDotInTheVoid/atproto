import {
  RateLimiterAbstract,
  RateLimiterMemory,
  RateLimiterRedis,
  RateLimiterRes,
} from 'rate-limiter-flexible'
import {
  CalcKeyFn,
  CalcPointsFn,
  RateLimitExceededError,
  RateLimiterConsume,
  RateLimiterI,
  RateLimiterStatus,
  XRPCReqContext,
} from './types'

export type RateLimiterOpts = {
  keyPrefix: string
  durationMs: number
  points: number
  bypassSecret?: string
  calcKey?: CalcKeyFn
  calcPoints?: CalcPointsFn
}

export class RateLimiter implements RateLimiterI {
  public limiter: RateLimiterAbstract
  private byPassSecret?: string
  public calcKey: CalcKeyFn
  public calcPoints: CalcPointsFn

  constructor(limiter: RateLimiterAbstract, opts: RateLimiterOpts) {
    this.limiter = limiter
    this.calcKey = opts.calcKey ?? defaultKey
    this.calcPoints = opts.calcPoints ?? defaultPoints
  }

  static memory(opts: RateLimiterOpts): RateLimiter {
    const limiter = new RateLimiterMemory({
      keyPrefix: opts.keyPrefix,
      duration: Math.floor(opts.durationMs / 1000),
      points: opts.points,
    })
    return new RateLimiter(limiter, opts)
  }

  static redis(storeClient: unknown, opts: RateLimiterOpts): RateLimiter {
    const limiter = new RateLimiterRedis({
      storeClient,
      keyPrefix: opts.keyPrefix,
      duration: Math.floor(opts.durationMs / 1000),
      points: opts.points,
    })
    return new RateLimiter(limiter, opts)
  }

  async consume(
    ctx: XRPCReqContext,
    opts?: { calcKey?: CalcKeyFn; calcPoints?: CalcPointsFn },
  ): Promise<RateLimiterStatus> {
    // @TODO fix
    // if (
    //   this.byPassSecret &&
    //   ctx.req.header('X-RateLimit-Bypass') === this.byPassSecret
    // ) {
    //   return
    // }
    const key = opts?.calcKey ? opts.calcKey(ctx) : this.calcKey(ctx)
    const points = opts?.calcPoints
      ? opts.calcPoints(ctx)
      : this.calcPoints(ctx)
    try {
      const res = await this.limiter.consume(key, points)
      return formatLimiterStatus(this.limiter, res)
    } catch (err) {
      // yes this library rejects with a res not an error
      if (err instanceof RateLimiterRes) {
        const status = formatLimiterStatus(this.limiter, err)
        throw new RateLimitExceededError(status)
      } else {
        // @TODO fail open
        throw err
      }
    }
  }
}

const formatLimiterStatus = (
  limiter: RateLimiterAbstract,
  res: RateLimiterRes,
): RateLimiterStatus => {
  return {
    limit: limiter.points,
    duration: limiter.duration,
    remainingPoints: res.remainingPoints,
    msBeforeNext: res.msBeforeNext,
    consumedPoints: res.consumedPoints,
    isFirstInDuration: res.isFirstInDuration,
  }
}

export const consumeMany = async (
  ctx: XRPCReqContext,
  fns: RateLimiterConsume[],
): Promise<void> => {
  if (fns.length === 0) return
  const results = await Promise.all(fns.map((fn) => fn(ctx)))
  const tightestLimit = getTightestLimit(results)
  setResHeaders(ctx, tightestLimit)
}

export const setResHeaders = (
  ctx: XRPCReqContext,
  status: RateLimiterStatus,
) => {
  ctx.res.setHeader('RateLimit-Limit', status.limit)
  ctx.res.setHeader('RateLimit-Remaining', status.remainingPoints)
  ctx.res.setHeader(
    'RateLimit-Reset',
    Math.floor((Date.now() + status.msBeforeNext) / 1000),
  )
  ctx.res.setHeader('RateLimit-Policy', `${status.limit};w=${status.duration}`)
}

export const getTightestLimit = (
  resps: RateLimiterStatus[],
): RateLimiterStatus => {
  let lowest = resps[0]
  for (const resp of resps) {
    if (resp.remainingPoints < lowest.remainingPoints) {
      lowest = resp
    }
  }
  return lowest
}

const defaultKey: CalcKeyFn = (ctx: XRPCReqContext) => ctx.req.ip
const defaultPoints: CalcPointsFn = () => 1
