export interface RepoBlob {
  cid: string
  recordUri: string
  commit: string
  did: string
  // opaque identifier, though currently tends to reference a moderation_action
  takedownId: string | null
}

export const tableName = 'repo_blob'

export type PartialDB = { [tableName]: RepoBlob }
