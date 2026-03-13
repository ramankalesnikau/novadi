/**
 * Test to verify that the transformer generates mapResolvers autowiring
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Container } from '../src/container'

describe('Transformer - MapResolvers AutoWire Generation', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should automatically generate mapResolvers for registerType without explicit autoWire', () => {
    // This test verifies that the transformer adds .autoWire({ mapResolvers: [...] })
    // automatically when it sees .registerType(X).as<Y>()

    interface ILogger {
      log(msg: string): void
    }

    interface IDatabase {
      query(): any[]
    }

    class Logger implements ILogger {
      log(msg: string) {
        console.log(msg)
      }
    }

    class Database implements IDatabase {
      query() {
        return []
      }
    }

    class UserService {
      constructor(
        public logger: ILogger,
        public database: IDatabase
      ) {}
    }

    // Register types - NO explicit .autoWire() call
    // Transformer should automatically inject mapResolvers
    const builder = container.builder()
    builder.registerType(Logger).as<ILogger>('ILogger')
    builder.registerType(Database).as<IDatabase>('IDatabase')
    builder.registerType(UserService).as<UserService>('UserService')

    const builtContainer = builder.build()
    const service = builtContainer.resolveType<UserService>('UserService')

    // If transformer worked correctly, dependencies should be resolved
    // via automatically generated mapResolvers
    expect(service).toBeInstanceOf(UserService)
    expect(service.logger).toBeInstanceOf(Logger)
    expect(service.database).toBeInstanceOf(Database)
  })

  it('should work with nested dependencies using transformer', () => {
    interface ILogger {
      log(msg: string): void
    }

    interface IConfig {
      get(key: string): string
    }

    class Logger implements ILogger {
      constructor(public config: IConfig) {}
      log(msg: string) {
        console.log(msg)
      }
    }

    class Config implements IConfig {
      get(key: string): string {
        return 'value'
      }
    }

    class Service {
      constructor(
        public logger: ILogger,
        public config: IConfig
      ) {}
    }

    const builder = container.builder()
    builder.registerType(Config).as<IConfig>('IConfig')
    builder.registerType(Logger).as<ILogger>('ILogger') // Has dependency on IConfig
    builder.registerType(Service).as<Service>('Service') // Has dependencies on both

    const builtContainer = builder.build()
    const service = builtContainer.resolveType<Service>('Service')

    expect(service).toBeInstanceOf(Service)
    expect(service.logger).toBeInstanceOf(Logger)
    expect(service.config).toBeInstanceOf(Config)
    expect((service.logger as Logger).config).toBeInstanceOf(Config)
  })
})

describe('Transformer - Function type handling (Bug 3)', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should not generate resolvers for function-typed parameters', () => {
    // Function-typed params like () => string should produce undefined
    // in mapResolvers, not (c) => c.resolveType("__type")

    class CommandExecutor {
      execute() { return 'executed' }
    }

    class ClipboardHandler {
      constructor(
        public executor: CommandExecutor,
        public getState: () => string,
      ) {}
    }

    const builder = container.builder()
    builder.registerType(CommandExecutor).as<CommandExecutor>()

    // No explicit .autoWire() — transformer should inject one with:
    // mapResolvers: [(c) => c.resolveType("CommandExecutor"), undefined]
    // NOT: [(c) => c.resolveType("CommandExecutor"), (c) => c.resolveType("__type")]
    builder.registerType(ClipboardHandler).as<ClipboardHandler>()

    const built = builder.build()

    // Should NOT throw — function param should get undefined, not attempt to resolve "__type"
    const handler = built.resolveType<ClipboardHandler>('ClipboardHandler')

    expect(handler.executor).toBeInstanceOf(CommandExecutor)
    expect(handler.getState).toBeUndefined()
  })

  it('should handle multiple callback params alongside typed params', () => {
    class CommandExecutor {
      execute() { return 'executed' }
    }

    class Handler {
      constructor(
        public executor: CommandExecutor,
        public getState: () => string,
        public applyState: (state: string) => void,
        public onDebug?: (msg: string) => void,
      ) {}
    }

    const builder = container.builder()
    builder.registerType(CommandExecutor).as<CommandExecutor>()
    builder.registerType(Handler).as<Handler>()

    const built = builder.build()

    const handler = built.resolveType<Handler>('Handler')

    expect(handler.executor).toBeInstanceOf(CommandExecutor)
    expect(handler.getState).toBeUndefined()
    expect(handler.applyState).toBeUndefined()
    expect(handler.onDebug).toBeUndefined()
  })
})

describe('Transformer - Merge mapResolvers into existing autoWire (Bug 1)', () => {
  let container: Container

  beforeEach(() => {
    container = new Container()
  })

  it('should merge transformer-generated mapResolvers with user-provided map', () => {
    // When user writes .autoWire({ map: {...} }), the transformer should
    // merge mapResolvers into the same call, not add a second .autoWire()

    class CaretRenderer {
      render() { return 'rendered' }
    }

    // Use param names that don't conflict with outer scope `container` variable
    interface ICaretManager {
      caretRenderer: CaretRenderer
      containerEl: any
      sizerEl: any
    }

    class CaretManager implements ICaretManager {
      constructor(
        public caretRenderer: CaretRenderer,
        public containerEl: any,
        public sizerEl: any,
      ) {}
    }

    const htmlContainer = { id: 'container' }
    const htmlSizer = { id: 'sizer' }

    const builder = container.builder()
    builder.registerType(CaretRenderer).as<CaretRenderer>()

    // User provides map for primitive params
    // Transformer should merge mapResolvers for typed params into this same call
    builder.registerType(CaretManager).as<ICaretManager>().singleInstance().autoWire({
      map: {
        containerEl: () => htmlContainer,
        sizerEl: () => htmlSizer,
      }
    })

    const built = builder.build()
    const mgr = built.resolveType<ICaretManager>('ICaretManager')

    // caretRenderer should be auto-resolved via transformer-generated mapResolvers
    expect(mgr.caretRenderer).toBeInstanceOf(CaretRenderer)
    // containerEl and sizerEl should come from user-provided map
    expect(mgr.containerEl).toBe(htmlContainer)
    expect(mgr.sizerEl).toBe(htmlSizer)
  })

  it('should handle callback params with user-provided map and typed auto-resolve', () => {
    // Full pipeline test: callback types + merge + combined resolution

    class CommandExecutor {
      execute() { return 'executed' }
    }

    interface IClipboardHandler {
      executor: CommandExecutor
      getState: () => string
    }

    class ClipboardHandler implements IClipboardHandler {
      constructor(
        public executor: CommandExecutor,
        public getState: () => string,
      ) {}
    }

    const getStateFn = () => 'some state'

    const builder = container.builder()
    builder.registerType(CommandExecutor).as<CommandExecutor>()
    builder.registerType(ClipboardHandler).as<IClipboardHandler>().autoWire({
      map: {
        getState: () => getStateFn,
      }
    })

    const built = builder.build()
    const handler = built.resolveType<IClipboardHandler>('IClipboardHandler')

    expect(handler.executor).toBeInstanceOf(CommandExecutor)
    expect(handler.getState).toBe(getStateFn)
  })
})
