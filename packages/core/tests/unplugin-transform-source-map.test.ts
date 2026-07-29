/**
 * Verifies transformCode() produces source maps that trace back to the
 * original .ts file, for both the no-Program fallback path (plain
 * transpileModule) and the Program-bound path (type-checked autowiring).
 */
import { describe, it, expect } from 'vitest'
import * as ts from 'typescript'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { transformCode, resolveInternalProgramOptions } from '../src/unplugin/transform'

function lineAndColumnOf(text: string, needle: string): { line: number; column: number } {
  const index = text.indexOf(needle)
  if (index === -1) {
    throw new Error(`"${needle}" not found in:\n${text}`)
  }
  const before = text.slice(0, index)
  const line = before.split('\n').length
  const column = index - before.lastIndexOf('\n') - 1
  return { line, column }
}

function createInMemoryProgram(fileName: string, content: string, compilerOptions: ts.CompilerOptions): ts.Program {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const host = ts.createCompilerHost(compilerOptions)
  const defaultGetSourceFile = host.getSourceFile.bind(host)

  host.getSourceFile = (requestedFileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
    if (requestedFileName === fileName) {
      return sourceFile
    }
    return defaultGetSourceFile(requestedFileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile)
  }

  return ts.createProgram({ rootNames: [fileName], options: compilerOptions, host })
}

/** Simulates a cross-package import: resolvable via getSourceFile() but outside rootNames. */
function createInMemoryProgramWithExtraFile(
  rootFileName: string,
  rootContent: string,
  targetFileName: string,
  targetContent: string,
  compilerOptions: ts.CompilerOptions
): ts.Program {
  const rootSourceFile = ts.createSourceFile(rootFileName, rootContent, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const targetSourceFile = ts.createSourceFile(targetFileName, targetContent, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const host = ts.createCompilerHost(compilerOptions)
  const defaultGetSourceFile = host.getSourceFile.bind(host)

  host.getSourceFile = (requestedFileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
    if (requestedFileName === rootFileName) return rootSourceFile
    if (requestedFileName === targetFileName) return targetSourceFile
    return defaultGetSourceFile(requestedFileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile)
  }

  // Pulls targetFileName into the Program's graph via import resolution,
  // without adding it to rootNames.
  host.resolveModuleNameLiterals = (moduleLiterals) =>
    moduleLiterals.map(() => ({ resolvedModule: { resolvedFileName: targetFileName, extension: ts.Extension.Ts } }))

  return ts.createProgram({ rootNames: [rootFileName], options: compilerOptions, host })
}

describe('resolveInternalProgramOptions', () => {
  it('overrides noEmit and declaration-related options regardless of the consumer tsconfig', () => {
    const resolved = resolveInternalProgramOptions(
      { noEmit: true, declaration: true, declarationMap: true, composite: true, incremental: true, target: ts.ScriptTarget.ES2022 },
      true
    )

    expect(resolved.noEmit).toBe(false)
    expect(resolved.declaration).toBe(false)
    expect(resolved.declarationMap).toBe(false)
    expect(resolved.composite).toBe(false)
    expect(resolved.incremental).toBe(false)
    expect(resolved.sourceMap).toBe(true)
    // Unrelated tsconfig options pass through untouched
    expect(resolved.target).toBe(ts.ScriptTarget.ES2022)
  })
})

describe('transformCode - source maps', () => {
  it('returns null (no map needed) when nothing is transformed', () => {
    const code = 'export const answer = 42\n'
    const result = transformCode(code, '/virtual/plain.ts', null)

    expect(result).toBeNull()
  })

  it('does not emit a map when the sourceMap option is left at its default (false)', () => {
    const fileName = '/virtual/no-map.ts'
    const code = [
      'export function useFoo(container: any) {',
      '  return container.resolveType<IFoo>()',
      '}',
      ''
    ].join('\n')

    const result = transformCode(code, fileName, null)

    expect(result).not.toBeNull()
    expect(result!.code).toContain('resolveType("IFoo"')
    expect(result!.map).toBeNull()
  })

  it('maps a .resolveType<T>() call back to its original position (no Program)', () => {
    const fileName = '/virtual/no-program.ts'
    const code = [
      'export function useFoo(container: any) {',
      '  return container.resolveType<IFoo>()',
      '}',
      ''
    ].join('\n')

    const result = transformCode(code, fileName, null, { sourceMap: true })

    expect(result).not.toBeNull()
    expect(result!.code).toContain('resolveType("IFoo"')
    expect(result!.map).not.toBeNull()

    const traceMap = new TraceMap(JSON.parse(result!.map!))
    const outputPos = lineAndColumnOf(result!.code, 'resolveType')
    const original = originalPositionFor(traceMap, outputPos)
    const expected = lineAndColumnOf(code, 'resolveType')

    expect(original.source).toContain('no-program.ts')
    expect(original.line).toBe(expected.line)
    expect(original.column).toBe(expected.column)
  })

  it('does not downlevel native private class fields in the no-Program fallback', () => {
    // Unrelated private field alongside a call the transformer does rewrite.
    const fileName = '/virtual/private-fields.ts'
    const code = [
      'export class Service {',
      '  #cache = new Map()',
      '  useFoo(container: any) {',
      '    return container.resolveType<IFoo>()',
      '  }',
      '}',
      ''
    ].join('\n')

    const result = transformCode(code, fileName, null)

    expect(result).not.toBeNull()
    expect(result!.code).toContain('#cache')
    expect(result!.code).not.toContain('WeakMap')
    expect(result!.code).not.toContain('_classPrivateFieldGet')
  })

  it('maps unchanged code back to its original position when autowiring is injected (Program-bound)', () => {
    const fileName = '/virtual/with-program.ts'
    const code = [
      'export class Logger {',
      '  log(msg: string) { console.log(msg) }',
      '}',
      '',
      'export class Service {',
      '  constructor(public logger: Logger) {}',
      '}',
      '',
      'export function register(builder: any) {',
      '  builder.registerType(Logger).as<Logger>()',
      '  builder.registerType(Service).as<Service>()',
      '}',
      ''
    ].join('\n')

    // Mirrors a consumer tsconfig with noEmit: true (bundler does the real build).
    const compilerOptions = resolveInternalProgramOptions(
      { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, strict: true, noEmit: true },
      true
    )

    const program = createInMemoryProgram(fileName, code, compilerOptions)
    const result = transformCode(code, fileName, program)

    expect(result).not.toBeNull()
    // Autowiring should have injected a mapResolvers-based .autoWire(...) call
    expect(result!.code).toContain('autoWire')
    expect(result!.map).not.toBeNull()

    const traceMap = new TraceMap(JSON.parse(result!.map!))
    const outputPos = lineAndColumnOf(result!.code, 'console.log(msg)')
    const original = originalPositionFor(traceMap, outputPos)
    const expected = lineAndColumnOf(code, 'console.log(msg)')

    expect(original.source).toContain('with-program.ts')
    expect(original.line).toBe(expected.line)
    expect(original.column).toBe(expected.column)
  })

  it('still injects type names for a file resolvable via the Program but outside its rootNames (cross-package import)', () => {
    const rootFileName = '/virtual/pkg-a/entry.ts'
    const rootContent = "import './register'\n"

    const targetFileName = '/virtual/pkg-b/register.ts'
    const targetContent = [
      'export function register(builder: any) {',
      '  builder.registerInstance({}).as<IFoo>()',
      '}',
      ''
    ].join('\n')

    const compilerOptions = resolveInternalProgramOptions(
      { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, strict: true, noEmit: true },
      true
    )

    const program = createInMemoryProgramWithExtraFile(
      rootFileName,
      rootContent,
      targetFileName,
      targetContent,
      compilerOptions
    )

    // Sanity check: present in the Program, but not one of its root files.
    expect(program.getSourceFile(targetFileName)).toBeDefined()
    expect(program.getRootFileNames()).not.toContain(targetFileName)

    const result = transformCode(targetContent, targetFileName, program, { sourceMap: true })

    expect(result).not.toBeNull()
    expect(result!.code).toContain('as("IFoo"')
  })
})
