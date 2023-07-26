// @NOTE also used by app-view (moderation)
export interface Record {
  uri: string
  cid: string
  did: string
  collection: string
  rkey: string
  repoClock: number | null
  indexedAt: string
  takedownId: number | null
}

export const tableName = 'record'

export type PartialDB = { [tableName]: Record }
