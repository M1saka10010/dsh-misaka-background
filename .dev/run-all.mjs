// Run every harness in sequence and print a pass/fail table with the artifact
// hash before and after, so a mid-run edit cannot silently invalidate results.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const bundle = join(here, '..', 'lib', 'client.js')
const hash = () => createHash('sha256').update(readFileSync(bundle)).digest('hex').toUpperCase()

const started = hash()
console.log(`bundle sha256 before: ${started}\n`)

const harnesses = [
  'contract.test.mjs',
  'artwork-retry.test.mjs',
  'render-probe.mjs',
  'fade-determinism.mjs',
  'preview-roundtrip.mjs',
  'failure-paths.test.mjs'
]

const rows = []
for (const harness of harnesses) {
  const began = Date.now()
  let status = 'PASS'
  let tail = ''
  try {
    execFileSync(process.execPath, [harness], { cwd: here, stdio: ['ignore', 'pipe', 'pipe'], timeout: 240000 })
  } catch (error) {
    status = 'FAIL'
    const stdout = error.stdout ? error.stdout.toString() : ''
    const stderr = error.stderr ? error.stderr.toString() : ''
    tail = `${stdout}\n${stderr}`.trim().split('\n').slice(-6).join('\n')
  }
  rows.push({ harness, status, ms: Date.now() - began, tail })
  console.log(`${status}  ${harness}  (${((Date.now() - began) / 1000).toFixed(1)}s)`)
  if (tail !== '') console.log(tail.split('\n').map((line) => '      ' + line).join('\n'))
}

const finished = hash()
console.log(`\nbundle sha256 after:  ${finished}`)
const stable = started === finished
console.log(`GUARD: ${stable ? 'STABLE' : 'CHANGED-MIDRUN — results are void'}`)

const failed = rows.filter((row) => row.status === 'FAIL')
console.log(`\n${'='.repeat(58)}`)
console.log(failed.length === 0 && stable
  ? `ALL ${rows.length} HARNESSES PASS`
  : `${failed.length} FAILED${stable ? '' : ' (and the bundle changed mid-run)'}`)
if (failed.length > 0 || !stable) process.exitCode = 1
