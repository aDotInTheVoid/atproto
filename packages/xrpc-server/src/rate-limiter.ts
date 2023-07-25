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
  RateLimiterI,
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
  ) {
    if (
      this.byPassSecret &&
      ctx.req.header('X-RateLimit-Bypass') === this.byPassSecret
    ) {
      return
    }

    const key = opts?.calcKey ? opts.calcKey(ctx) : this.calcKey(ctx)
    const points = opts?.calcPoints
      ? opts.calcPoints(ctx)
      : this.calcPoints(ctx)
    try {
      const res = await this.limiter.consume(key, points)
      ctx.res.setHeader('RateLimit-Limit', this.limiter.points)
      ctx.res.setHeader('RateLimit-Remaining', res.remainingPoints)
      ctx.res.setHeader(
        'RateLimit-Reset',
        Math.floor((Date.now() + res.msBeforeNext) / 1000),
      )
      ctx.res.setHeader(
        'RateLimit-Policy',
        `${this.limiter.points};w=${this.limiter.duration}`,
      )
    } catch (err) {
      if (err instanceof RateLimiterRes) {
        ctx.res.setHeader('RateLimit-Limit', this.limiter.points)
        ctx.res.setHeader('RateLimit-Remaining', err.remainingPoints)
        ctx.res.setHeader(
          'RateLimit-Reset',
          Math.floor((Date.now() + err.msBeforeNext) / 1000),
        )
        ctx.res.setHeader(
          'RateLimit-Policy',
          `${this.limiter.points};w=${this.limiter.duration}`,
        )
        throw new RateLimitExceededError()
      } else {
        throw err
      }
    }
  }
}

const defaultKey: CalcKeyFn = (ctx: XRPCReqContext) => ctx.req.ip
const defaultPoints: CalcPointsFn = () => 1
