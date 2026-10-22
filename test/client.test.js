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

function loadClient() {
  let spec
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { spec = value } } },
    console,
    setTimeout,
    clearTimeout,
    fetch: async () => {
      throw new Error('fetch is not used while registering')
    },
    document: { hidden: false, addEventListener() {}, removeEventListener() {}, activeElement: null },
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
  assert.deepEqual([...plugin.inject], ['slots', 'locale'])

  const registrations = []
  const locale = {
    register: () => () => {},
    bind: () => (key) => key,
    subscribe: () => () => {},
    getSnapshot: () => ({ revision: 1 }),
  }
  const ctx = {
    get: (key) => (key === 'uiWorkspace' ? { openSession: () => {} } : undefined),
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
  assert.equal(catalog.definition.id, 'subagent-catalog')
  assert.equal(typeof sidebar.component, 'function')
  assert.equal(typeof main.component, 'function')
  assert.equal(typeof catalog.component, 'function')
})
