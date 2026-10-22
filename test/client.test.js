import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..'
const source = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8')

function fakeReact() {
  return {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useCallback: (fn) => fn,
    useEffect: () => {},
    useMemo: (fn) => fn(),
    useRef: (value) => ({ current: value }),
    useState: (value) => [value, () => {}],
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
}

function loadClient(overrides = {}) {
  let spec
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { spec = value } } },
    console,
    setTimeout,
    clearTimeout,
    fetch: async () => {
      throw new Error('fetch is not used while registering')
    },
    document: {
      hidden: false,
      addEventListener() {},
      removeEventListener() {},
      activeElement: null,
      documentElement: { dataset: {} },
      body: {},
      querySelectorAll: () => [],
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setInterval: () => 0,
    clearInterval: () => {},
    queueMicrotask: (fn) => fn(),
    ...overrides,
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  assert.ok(spec, 'client module called __ModuleLoader__.load')
  return spec
}

test('configuration form is wired to the dashboard reload function', () => {
  assert.match(source, /h\(Configuration, \{ data, t, reload \}\)/)
  assert.match(source, /typeof reload === 'function'/)
})

test('client half registers the sidebar icon and the main panel', () => {
  const spec = loadClient()
  assert.equal(spec.id, 'dsh-skill-curator')

  const plugin = spec.factory((id) => {
    if (id === 'react') return fakeReact()
    throw new Error(`unexpected require(${id})`)
  })
  assert.deepEqual([...plugin.inject], ['slots', 'locale', 'uiWorkspace'])

  const registrations = []
  const locale = {
    register: () => () => {},
    bind: () => (key) => key,
    subscribe: () => () => {},
    getSnapshot: () => ({ revision: 1 }),
  }
  const ctx = {
    uiWorkspace: { openSession: () => {} },
    effect: (fn) => {
      fn()
      return () => {}
    },
    locale,
    slots: {
      inject: (_name, factory) => factory(),
      register: (definition, component) => {
        registrations.push({ definition, component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)

  assert.equal(registrations.length, 3)
  const sidebar = registrations.find((entry) => entry.definition.name === 'sidebar.panellist')
  const main = registrations.find((entry) => entry.definition.name === 'main')
  const catalog = registrations.find((entry) => entry.definition.name === 'conversation.session.header.actions')
  assert.equal(sidebar.definition.id, 'skill-curator')
  assert.equal(main.definition.key, 'skill-curator')
  assert.equal(catalog.definition.id, 'skill-curator-runs')
  assert.equal(typeof sidebar.component, 'function')
  assert.equal(typeof main.component, 'function')
  assert.equal(typeof catalog.component, 'function')
})


for (const [initial, count, expected] of [
  ['2 subagents', '2', '2 subagents'],
  ['29 subagents', '2', '2 subagents'],
  ['29 subagents', '1', '1 subagent'],
  ['29 个子代理', '2', '2 个子代理'],
]) {
  test(`catalog observer settles without replacing button children: ${initial} -> ${expected}`, () => {
    const jobs = []
    const observers = []
    const disposers = []
    let text = initial
    let writes = 0
    let replacedChildren = 0
    const notify = () => {
      for (const observer of observers) {
        if (observer.active) jobs.push(() => observer.callback([]))
      }
    }
    const textNode = {
      get data() { return text },
      set data(value) { text = value; writes++; notify() },
    }
    const button = {
      style: {},
      get textContent() { return text },
      set textContent(value) { text = value; writes++; replacedChildren++; notify() },
    }
    const spec = loadClient({
      document: {
        documentElement: { dataset: { scSubagentState: 'mixed', scSubagentUserCount: count } },
        body: {},
        querySelectorAll: (selector) => selector.includes('button') ? [button] : [],
        createTreeWalker: () => {
          let visited = false
          return { nextNode: () => { if (visited) return null; visited = true; return textNode } }
        },
      },
      MutationObserver: class {
        constructor(callback) { this.callback = callback; observers.push(this) }
        observe() { this.active = true }
        disconnect() { this.active = false }
      },
      queueMicrotask: (fn) => jobs.push(fn),
    })
    const plugin = spec.factory(() => fakeReact())
    plugin.apply({
      locale: { register: () => () => {}, bind: () => (key) => key },
      slots: { inject() {} },
      effect(fn) { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose) },
    })
    let rounds = 0
    while (jobs.length && rounds++ < 20) jobs.shift()()
    assert.equal(jobs.length, 0, 'DOM observer must settle instead of perpetually scheduling itself')
    assert.equal(text, expected)
    assert.equal(replacedChildren, 0, 'React-owned children and icons must stay intact')
    assert.equal(writes, initial === expected ? 0 : 1)
    for (const dispose of disposers) dispose()
    assert.equal(observers[0].active, false)
  })
}
