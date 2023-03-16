import { once, EventEmitter } from 'events'
import AtpAgent, {
  ComAtprotoServerCreateAccount,
  ComAtprotoServerResetPassword,
} from '@atproto/api'
import { DidResolver } from '@atproto/did-resolver'
import * as crypto from '@atproto/crypto'
import Mail from 'nodemailer/lib/mailer'
import { AppContext, Database } from '../src'
import * as util from './_util'
import { ServerMailer } from '../src/mailer'

const email = 'alice@test.com'
const handle = 'alice.test'
const password = 'test123'
const passwordAlt = 'test456'
const minsToMs = 60 * 1000

const createInviteCode = async (
  agent: AtpAgent,
  uses: number,
): Promise<string> => {
  const res = await agent.api.com.atproto.server.createInviteCode(
    { useCount: uses },
    {
      headers: { authorization: util.adminAuth() },
      encoding: 'application/json',
    },
  )
  return res.data.code
}

describe('account', () => {
  let serverUrl: string
  let ctx: AppContext
  let repoSigningKey: string
  let agent: AtpAgent
  let close: util.CloseFn
  let mailer: ServerMailer
  let db: Database
  let didResolver: DidResolver
  const mailCatcher = new EventEmitter()
  let _origSendMail

  beforeAll(async () => {
    const server = await util.runTestServer({
      inviteRequired: true,
      termsOfServiceUrl: 'https://example.com/tos',
      privacyPolicyUrl: '/privacy-policy',
      dbPostgresSchema: 'account',
    })
    close = server.close
    mailer = server.ctx.mailer
    db = server.ctx.db
    ctx = server.ctx
    serverUrl = server.url
    repoSigningKey = server.ctx.repoSigningKey.did()
    didResolver = new DidResolver({ plcUrl: ctx.cfg.didPlcUrl })
    agent = new AtpAgent({ service: serverUrl })

    // Catch emails for use in tests
    _origSendMail = mailer.transporter.sendMail
    mailer.transporter.sendMail = async (opts) => {
      const result = await _origSendMail.call(mailer.transporter, opts)
      mailCatcher.emit('mail', opts)
      return result
    }
  })

  afterAll(async () => {
    mailer.transporter.sendMail = _origSendMail
    if (close) {
      await close()
    }
  })

  let inviteCode: string

  it('creates an invite code', async () => {
    inviteCode = await createInviteCode(agent, 1)
    const split = inviteCode.split('-')
    const host = split.slice(0, -1).join('.')
    const code = split.at(-1)
    expect(host).toBe('pds.public.url') // Hostname of public url
    expect(code?.length).toBe(5)
  })

  it('serves the accounts system config', async () => {
    const res = await agent.api.com.atproto.server.describeServer({})
    expect(res.data.inviteCodeRequired).toBe(true)
    expect(res.data.availableUserDomains[0]).toBe('.test')
    expect(typeof res.data.inviteCodeRequired).toBe('boolean')
    expect(res.data.links?.privacyPolicy).toBe(
      'https://pds.public.url/privacy-policy',
    )
    expect(res.data.links?.termsOfService).toBe('https://example.com/tos')
  })

  it('fails on invalid handles', async () => {
    const promise = agent.api.com.atproto.server.createAccount({
      email: 'bad-handle@test.com',
      handle: 'did:bad-handle.test',
      password: 'asdf',
      inviteCode,
    })
    await expect(promise).rejects.toThrow(
      ComAtprotoServerCreateAccount.InvalidHandleError,
    )
  })

  it('fails on bad invite code', async () => {
    const promise = agent.api.com.atproto.server.createAccount({
      email,
      handle,
      password,
      inviteCode: 'fake-invite',
    })
    await expect(promise).rejects.toThrow(
      ComAtprotoServerCreateAccount.InvalidInviteCodeError,
    )
  })

  let did: string
  let jwt: string

  it('creates an account', async () => {
    const res = await agent.api.com.atproto.server.createAccount({
      email,
      handle,
      password,
      inviteCode,
    })
    did = res.data.did
    jwt = res.data.accessJwt

    expect(typeof jwt).toBe('string')
    expect(did.startsWith('did:plc:')).toBeTruthy()
    expect(res.data.handle).toEqual(handle)
  })

  it('generates a properly formatted PLC DID', async () => {
    const didData = await didResolver.resolveAtpData(did)

    expect(didData.did).toBe(did)
    expect(didData.handle).toBe(handle)
    expect(didData.signingKey).toBe(repoSigningKey)
    expect(didData.pds).toBe('https://pds.public.url') // Mapped from publicUrl
  })

  it('allows a custom set recovery key', async () => {
    const inviteCode = await createInviteCode(agent, 1)
    const recoveryKey = (await crypto.EcdsaKeypair.create()).did()
    const res = await agent.api.com.atproto.server.createAccount({
      email: 'custom-recovery@test.com',
      handle: 'custom-recovery.test',
      password: 'custom-recovery',
      inviteCode,
      recoveryKey,
    })

    const didData = await ctx.plcClient.getDocumentData(res.data.did)

    expect(didData.rotationKeys).toEqual([
      recoveryKey,
      ctx.cfg.recoveryKey,
      ctx.plcRotationKey.did(),
    ])
  })

  it('disallows duplicate email addresses and handles', async () => {
    const inviteCode = await createInviteCode(agent, 2)
    const email = 'bob@test.com'
    const handle = 'bob.test'
    const password = 'test123'
    await agent.api.com.atproto.server.createAccount({
      email,
      handle,
      password,
      inviteCode,
    })

    await expect(
      agent.api.com.atproto.server.createAccount({
        email: email.toUpperCase(),
        handle: 'carol.test',
        password,
        inviteCode,
      }),
    ).rejects.toThrow('Email already taken: BOB@TEST.COM')

    await expect(
      agent.api.com.atproto.server.createAccount({
        email: 'carol@test.com',
        handle: handle.toUpperCase(),
        password,
        inviteCode,
      }),
    ).rejects.toThrow('Handle already taken: bob.test')
  })

  it('disallows improperly formatted handles', async () => {
    const inviteCode = await createInviteCode(agent, 1)
    const tryHandle = async (handle: string) => {
      await agent.api.com.atproto.server.createAccount({
        email: 'john@test.com',
        handle,
        password: 'test123',
        inviteCode,
      })
    }
    await expect(tryHandle('did:john')).rejects.toThrow(
      'Cannot register a handle that starts with `did:`',
    )
    await expect(tryHandle('john.bsky.io')).rejects.toThrow(
      'Not a supported handle domain',
    )
    await expect(tryHandle('j.test')).rejects.toThrow('Handle too short')
    await expect(tryHandle('jayromy-johnber123456.test')).rejects.toThrow(
      'Handle too long',
    )
    await expect(tryHandle('jo_hn.test')).rejects.toThrow(
      'Invalid characters in handle',
    )
    await expect(tryHandle('jo!hn.test')).rejects.toThrow(
      'Invalid characters in handle',
    )
    await expect(tryHandle('jo%hn.test')).rejects.toThrow(
      'Invalid characters in handle',
    )
    await expect(tryHandle('jo&hn.test')).rejects.toThrow(
      'Invalid characters in handle',
    )
    await expect(tryHandle('jo*hn.test')).rejects.toThrow(
      'Invalid characters in handle',
    )
    await expect(tryHandle('jo|hn.test')).rejects.toThrow(
      'Invalid characters in handle',
    )
    await expect(tryHandle('jo:hn.test')).rejects.toThrow(
      'Invalid characters in handle',
    )
    await expect(tryHandle('jo/hn.test')).rejects.toThrow(
      'Invalid characters in handle',
    )
    await expect(tryHandle('about.test')).rejects.toThrow('Reserved handle')
    await expect(tryHandle('atp.test')).rejects.toThrow('Reserved handle')
  })

  it('fails on used up invite code', async () => {
    const promise = agent.api.com.atproto.server.createAccount({
      email: 'bob@test.com',
      handle: 'bob.test',
      password: 'asdf',
      inviteCode,
    })
    await expect(promise).rejects.toThrow(
      ComAtprotoServerCreateAccount.InvalidInviteCodeError,
    )
  })

  it('handles racing invite code uses', async () => {
    const inviteCode = await createInviteCode(agent, 1)
    const COUNT = 10

    let successes = 0
    let failures = 0
    const promises: Promise<unknown>[] = []
    for (let i = 0; i < COUNT; i++) {
      const attempt = async () => {
        try {
          await agent.api.com.atproto.server.createAccount({
            email: `user${i}@test.com`,
            handle: `user${i}.test`,
            password: `password`,
            inviteCode,
          })
          successes++
        } catch (err) {
          failures++
        }
      }
      promises.push(attempt())
    }
    await Promise.all(promises)
    expect(successes).toBe(1)
    expect(failures).toBe(9)
  })

  it('handles racing signups for same handle', async () => {
    const COUNT = 10

    const invite1 = await createInviteCode(agent, COUNT)
    const invite2 = await createInviteCode(agent, COUNT)

    let successes = 0
    let failures = 0
    const promises: Promise<unknown>[] = []
    for (let i = 0; i < COUNT; i++) {
      const attempt = async () => {
        try {
          // Use two invites to ensure per-invite locking doesn't
          // give the appearance of fixing a race for handle.
          const invite = i % 2 ? invite1 : invite2
          await agent.api.com.atproto.server.createAccount({
            email: `matching@test.com`,
            handle: `matching.test`,
            password: `password`,
            inviteCode: invite,
          })
          successes++
        } catch (err) {
          failures++
        }
      }
      promises.push(attempt())
    }
    await Promise.all(promises)
    expect(successes).toBe(1)
    expect(failures).toBe(9)
  })

  it('fails on unauthenticated requests', async () => {
    await expect(agent.api.com.atproto.server.getSession({})).rejects.toThrow()
  })

  it('logs in', async () => {
    const res = await agent.api.com.atproto.server.createSession({
      identifier: handle,
      password,
    })
    jwt = res.data.accessJwt
    expect(typeof jwt).toBe('string')
    expect(res.data.handle).toBe('alice.test')
    expect(res.data.did).toBe(did)
  })

  it('can perform authenticated requests', async () => {
    agent.api.setHeader('authorization', `Bearer ${jwt}`)
    const res = await agent.api.com.atproto.server.getSession({})
    expect(res.data.did).toBe(did)
    expect(res.data.handle).toBe(handle)
  })

  const getMailFrom = async (promise): Promise<Mail.Options> => {
    const result = await Promise.all([once(mailCatcher, 'mail'), promise])
    return result[0][0]
  }

  const getTokenFromMail = (mail: Mail.Options) =>
    mail.html?.toString().match(/>(\d{6})</)?.[1]

  it('can reset account password', async () => {
    const mail = await getMailFrom(
      agent.api.com.atproto.server.requestPasswordReset({ email }),
    )

    expect(mail.to).toEqual(email)
    expect(mail.html).toContain('Reset your password')
    expect(mail.html).toContain('alice.test')

    const token = getTokenFromMail(mail)

    if (token === undefined) {
      return expect(token).toBeDefined()
    }

    await agent.api.com.atproto.server.resetPassword({
      token,
      password: passwordAlt,
    })

    // Logs in with new password and not previous password
    await expect(
      agent.api.com.atproto.server.createSession({
        identifier: handle,
        password,
      }),
    ).rejects.toThrow('Invalid identifier or password')

    await expect(
      agent.api.com.atproto.server.createSession({
        identifier: handle,
        password: passwordAlt,
      }),
    ).resolves.toBeDefined()
  })

  it('allows only single-use of password reset token', async () => {
    const mail = await getMailFrom(
      agent.api.com.atproto.server.requestPasswordReset({ email }),
    )

    const token = getTokenFromMail(mail)

    if (token === undefined) {
      return expect(token).toBeDefined()
    }

    // Reset back from passwordAlt to password
    await agent.api.com.atproto.server.resetPassword({ token, password })

    // Reuse of token fails
    await expect(
      agent.api.com.atproto.server.resetPassword({ token, password }),
    ).rejects.toThrow(ComAtprotoServerResetPassword.InvalidTokenError)

    // Logs in with new password and not previous password
    await expect(
      agent.api.com.atproto.server.createSession({
        identifier: handle,
        password: passwordAlt,
      }),
    ).rejects.toThrow('Invalid identifier or password')

    await expect(
      agent.api.com.atproto.server.createSession({
        identifier: handle,
        password,
      }),
    ).resolves.toBeDefined()
  })

  it('allows only unexpired password reset tokens', async () => {
    await agent.api.com.atproto.server.requestPasswordReset({ email })

    const user = await db.db
      .updateTable('user_account')
      .where('email', '=', email)
      .set({
        passwordResetGrantedAt: new Date(
          Date.now() - 16 * minsToMs,
        ).toISOString(),
      })
      .returning(['passwordResetToken'])
      .executeTakeFirst()
    if (!user?.passwordResetToken) {
      throw new Error('Missing reset token')
    }

    // Use of expired token fails
    await expect(
      agent.api.com.atproto.server.resetPassword({
        token: user.passwordResetToken,
        password: passwordAlt,
      }),
    ).rejects.toThrow(ComAtprotoServerResetPassword.ExpiredTokenError)

    // Still logs in with previous password
    await expect(
      agent.api.com.atproto.server.createSession({
        identifier: handle,
        password: passwordAlt,
      }),
    ).rejects.toThrow('Invalid identifier or password')

    await expect(
      agent.api.com.atproto.server.createSession({
        identifier: handle,
        password,
      }),
    ).resolves.toBeDefined()
  })
})
