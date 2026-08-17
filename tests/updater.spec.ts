import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { DshUpdaterService, type Config } from '../src/index.ts'
import type { GitRunner } from '../src/git.ts'

const LOCAL = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const REMOTE = 'cccccccccccccccccccccccccccccccccccccccc'

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    repoUrl: 'https://github.com/deepseek-ai/deepseek-harness.git',
    branch: 'main',
    targetDir: '/tmp/dsh-updater-target',
    checkOnLoad: false,
    checkIntervalMs: 0,
    force: false,
    apiPrefix: '/dsh-updater',
    ...overrides,
  }
}

describe('DshUpdaterService', () => {
  it('reports update-available when the target checkout is missing', async () => {
    const run: GitRunner = async (args) => {
      if (args[0] === 'ls-remote') return `${REMOTE}\trefs/heads/main\n`
      if (args[0] === 'rev-parse') throw new Error('not a repository')
      throw new Error(`unexpected git call: ${args.join(' ')}`)
    }
    const ctx = new Context()
    const service = new DshUpdaterService(ctx, makeConfig(), run)
    const snapshot = await service.check()
    expect(snapshot.status).toBe('update-available')
    expect(snapshot.updateAvailable).toBe(true)
    expect(snapshot.localCommit).toBe('')
    expect(snapshot.remoteCommit).toBe(REMOTE)
  })

  it('clones the remote and marks restart required on update', async () => {
    const calls: string[][] = []
    const run: GitRunner = async (args) => {
      calls.push(args)
      if (args[0] === 'ls-remote') return `${REMOTE}\trefs/heads/main\n`
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') throw new Error('not a repository')
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return REMOTE
      if (args[0] === 'clone') return ''
      if (args[0] === 'status') return ''
      if (args[0] === 'fetch') return ''
      if (args[0] === 'checkout') return ''
      throw new Error(`unexpected git call: ${args.join(' ')}`)
    }
    const ctx = new Context()
    const service = new DshUpdaterService(ctx, makeConfig(), run)
    const result = await service.update()
    expect(result.commitChanged).toBe(true)
    expect(result.snapshot.status).toBe('updated')
    expect(result.snapshot.restartRequired).toBe(true)
    expect(calls.some(call => call[0] === 'clone')).toBe(true)
  })

  it('returns commitChanged=false when remote and local already match', async () => {
    const run: GitRunner = async (args) => {
      if (args[0] === 'ls-remote') return `${LOCAL}\trefs/heads/main\n`
      if (args[0] === 'rev-parse' && args[1] === '--git-dir') return '.git'
      if (args[0] === 'rev-parse' && args[1] === 'HEAD') return LOCAL
      if (args[0] === 'status') return ''
      if (args[0] === 'fetch') return ''
      if (args[0] === 'checkout') return ''
      throw new Error(`unexpected git call: ${args.join(' ')}`)
    }
    const ctx = new Context()
    const service = new DshUpdaterService(ctx, makeConfig(), run)
    const result = await service.update()
    expect(result.commitChanged).toBe(false)
    expect(result.snapshot.status).toBe('up-to-date')
    expect(result.snapshot.restartRequired).toBe(false)
  })
})
