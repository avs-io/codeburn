export type ActionKind =
  | 'mcp-remove' | 'mcp-project-scope'
  | 'archive-skill' | 'archive-agent' | 'archive-command'
  | 'claude-md-rule' | 'shell-config'
  | 'guard-install' | 'guard-uninstall'
  | 'model-default'

export type FileChange = {
  path: string            // absolute path modified
  backup: string | null   // backups/<id>/<n>.bak relative to the actions dir, null if the file did not exist before
  op: 'edit' | 'create' | 'move'
  movedTo?: string        // for op: 'move' (archives)
  destBackup?: string | null  // move ops: snapshot of a file that already existed at movedTo
  afterHash: string       // sha256 of the post-apply bytes, checked for drift on undo
}

export type ActionRecord = {
  id: string              // crypto.randomUUID()
  at: string              // ISO timestamp
  kind: ActionKind
  findingId: string | null
  description: string     // one human sentence, shown in `act list`
  changes: FileChange[]
  status: 'applied' | 'undone'
  undoneAt?: string
  baseline?: Record<string, number>
}

// expectedHash: sha256 of the raw on-disk bytes the plan's content was
// computed from (null when the plan expects the file to be absent). runAction
// refuses to apply when the target no longer matches, so a file edited
// between preview and confirm is never silently clobbered with stale
// content. undefined skips the check.
export type PlannedChange =
  | { op: 'edit'; path: string; content: string | Buffer; expectedHash?: string | null }
  | { op: 'create'; path: string; content: string | Buffer; expectedHash?: string | null }
  | { op: 'move'; path: string; movedTo: string }

export type ActionPlan = {
  kind: ActionKind
  description: string
  findingId?: string | null
  changes: PlannedChange[]
  baseline?: Record<string, number>
}
