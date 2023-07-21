'use strict' /* eslint-disable */

require('dd-trace/init') // Only works with commonjs

// Tracer code above must come before anything else
const { Database, IndexerConfig, BskyIndexer, Redis } = require('@atproto/bsky')

const main = async () => {
  const env = getEnv()
  // Migrate using credentialed user
  const migrateDb = Database.postgres({
    url: env.dbMigratePostgresUrl,
    schema: env.dbPostgresSchema,
    poolSize: 2,
  })
  await migrateDb.migrateToLatestOrThrow()
  await migrateDb.close()
  const db = Database.postgres({
    url: env.dbPostgresUrl,
    schema: env.dbPostgresSchema,
    poolSize: env.dbPoolSize,
    poolMaxUses: env.dbPoolMaxUses,
    poolIdleTimeoutMs: env.dbPoolIdleTimeoutMs,
  })
  const redis = new Redis(env.redisUrl)
  const cfg = IndexerConfig.readEnv({
    version: env.version,
    redisUrl: env.redisUrl,
    dbPostgresUrl: env.dbPostgresUrl,
    dbPostgresSchema: env.dbPostgresSchema,
  })
  const indexer = BskyIndexer.create({ db, redis, cfg })
  await indexer.start()
  process.on('SIGTERM', async () => {
    await indexer.destroy()
  })
}

// Also accepts the following in readEnv():
//  - DID_PLC_URL
//  - DID_CACHE_STALE_TTL
//  - DID_CACHE_MAX_TTL
//  - LABELER_DID
//  - HIVE_API_KEY
//  - INDEXER_PARTITION_IDS
//  - INDEXER_CONCURRENCY
//  - INDEXER_SUB_LOCK_ID
const getEnv = () => ({
  version: process.env.BSKY_VERSION,
  redisUrl: process.env.REDIS_URL,
  dbPostgresUrl: process.env.DB_POSTGRES_URL,
  dbMigratePostgresUrl:
    process.env.DB_MIGRATE_POSTGRES_URL || process.env.DB_POSTGRES_URL,
  dbPostgresSchema: process.env.DB_POSTGRES_SCHEMA || undefined,
  dbPoolSize: maybeParseInt(process.env.DB_POOL_SIZE),
  dbPoolMaxUses: maybeParseInt(process.env.DB_POOL_MAX_USES),
  dbPoolIdleTimeoutMs: maybeParseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS),
})

const maybeParseInt = (str) => {
  const parsed = parseInt(str)
  return isNaN(parsed) ? undefined : parsed
}

main()
