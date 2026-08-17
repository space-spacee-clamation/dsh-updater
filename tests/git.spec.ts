import { describe, expect, it } from 'vitest'
import {
  cloneRemote,
  fetchExisting,
  normalizeRepoUrl,
  parseRemoteObjectId,
  parseSymrefHead,
  remoteHead,
  resolveRemoteBranch,
  resolveTargetDir,
  type GitRunner,
} from '../src/git.ts'

const REMOTE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

function runner(answers: Record<string, string | Error>): GitRunner {
  return async (args) => {
    const key = args.join('\u0000')
    const answer = answers[key]
    if (answer === undefined) {
      throw new Error(`unexpected git call: ${key}`)
    }
    if (answer instanceof Error) throw answer
    return answer
  }
}

describe('git helpers', () => {
  it('normalizes repository urls', () => {
    expect(normalizeRepoUrl('https://github.com/deepseek-ai/deepseek-harness.git/')).toBe('https://github.com/deepseek-ai/deepseek-harness')
    expect(normalizeRepoUrl('https://github.com/A/B.git')).toBe('https://github.com/a/b')
  })

  it('parses symref and ls-remote output', () => {
    expect(parseSymrefHead(`ref: refs/heads/main\tHEAD\n${REMOTE}\tHEAD\n`)).toBe('main')
    expect(parseSymrefHead('')).toBeUndefined()
    expect(parseRemoteObjectId(`${REMOTE}\trefs/heads/main\n`)).toBe(REMOTE)
    expect(parseRemoteObjectId('not a ref')).toBeUndefined()
  })

  it('resolves an explicit branch without touching the network', async () => {
    const run = runner({})
    expect(await resolveRemoteBranch('https://example.test/r.git', ' main ', run)).toBe('main')
  })

  it('resolves the remote default branch from symref', async () => {
    const run = runner({
      ['ls-remote\u0000--symref\u0000https://example.test/r.git\u0000HEAD']:
        `ref: refs/heads/trunk\tHEAD\n${REMOTE}\tHEAD\n`,
    })
    expect(await resolveRemoteBranch('https://example.test/r.git', '', run)).toBe('trunk')
  })

  it('resolves the remote head object id', async () => {
    const run = runner({
      ['ls-remote\u0000https://example.test/r.git\u0000refs/heads/main']: `${REMOTE}\trefs/heads/main\n`,
    })
    expect(await remoteHead('https://example.test/r.git', 'main', run)).toBe(REMOTE)
  })

  it('prefers the environment target directory over config and cwd', async () => {
    const run = runner({})
    const target = await resolveTargetDir('https://example.test/r.git', 'conf', 'env', '/work', run)
    expect(target.endsWith('env')).toBe(true)
  })

  it('clones into a missing directory with a shallow detached fetch', async () => {
    const calls: string[][] = []
    const run: GitRunner = async (args, cwd) => {
      calls.push([...args, ...(cwd === undefined ? [] : [cwd])])
      return ''
    }
    await cloneRemote('https://example.test/r.git', 'main', '/tmp/dsh-updater-test-target', run)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.slice(0, 7)).toEqual(['clone', '--quiet', '--no-tags', '--depth', '1', '--branch', 'main'])
  })

  it('fetches and checks out FETCH_HEAD for an existing repo', async () => {
    const calls: string[][] = []
    const run: GitRunner = async (args) => {
      calls.push(args)
      if (args[0] === 'rev-parse') return ''
      if (args[0] === 'status') return ''
      return ''
    }
    await fetchExisting('https://example.test/r.git', 'main', '/tmp/dsh-updater-test-target', false, run)
    expect(calls.map(call => call[0])).toEqual(['rev-parse', 'status', 'fetch', 'checkout'])
    expect(calls[2]?.slice(1)).toEqual(['--quiet', '--no-tags', '--depth', '1', 'https://example.test/r.git', 'main'])
    expect(calls[3]?.slice(1)).toEqual(['--quiet', '--detach', '--force', 'FETCH_HEAD'])
  })
})
