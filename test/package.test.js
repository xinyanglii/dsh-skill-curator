import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..'
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')
const pkg = JSON.parse(read('package.json'))

test('manifest declares the DSH bundle and browser half', () => {
  assert.equal(pkg.name, 'dsh-skill-curator')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.exports['.'], './index.js')
  assert.equal(pkg.exports['./preset'], './preset.js')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.files.includes('scripts/skillctl'))
  assert.ok(pkg.files.includes('consolidate.js'))
  assert.ok(fs.existsSync(path.join(ROOT, pkg.dsh.bundle.patch)))
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts', 'skillctl')))
})

test('bundle patch inserts the host row and the restricted preset', () => {
  const patch = read('cordis.patch.yml')
  assert.match(patch, /id: skill-curator/)
  assert.match(patch, /name: 'dsh-skill-curator'/)
  assert.match(patch, /id: preset-skill-review/)
  assert.match(patch, /name: 'dsh-skill-curator\/preset'/)
  assert.match(patch, /id: skill-review-tools/)
  assert.match(patch, /id: preset-skill-consolidate/)
  assert.match(patch, /id: skill-consolidate/)
  assert.match(patch, /consolidationMode: true/)
  assert.match(patch, /consolidateEnabled: false/)
  assert.doesNotMatch(patch, /@local\//)
  assert.doesNotMatch(patch, /\/opt\/homebrew/)
})

test('client module id matches the package name', () => {
  const client = read('client.js')
  assert.match(client, new RegExp(`id: '${pkg.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`))
  assert.match(client, /__ModuleLoader__\.load/)
})

test('shipped source contains no machine-specific paths or credentials', () => {
  const files = ['index.js', 'dashboard.js', 'preset.js', 'client.js', 'cordis.patch.yml', 'locale/en.json', 'locale/zh.json', 'scripts/skillctl']
  const forbidden = [/\/Users\//, /\/opt\/homebrew/, /opencode-go/, /commandcode/, /NOTION_MCP_TOKEN/, /DEEPSEEK_API_KEY/]
  for (const file of files) {
    const text = read(file)
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${file} contains ${pattern}`)
    }
  }
})

test('vendored skillctl is executable and self-contained', () => {
  const file = path.join(ROOT, 'scripts', 'skillctl')
  const stat = fs.statSync(file)
  assert.ok((stat.mode & 0o111) !== 0, 'skillctl must be executable')
  const text = fs.readFileSync(file, 'utf8')
  assert.ok(text.startsWith('#!/usr/bin/env python3'))
  assert.match(text, /def review_prompt\(/)
})
