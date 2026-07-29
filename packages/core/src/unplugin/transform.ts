/**
 * Transform logic for NovaDI unplugin
 * Wraps the existing TypeScript transformer
 */

import * as ts from 'typescript'
import novadiTransformer from '../transformer/index.js'

export interface TransformOptions {
  /** Enable debug logging */
  debug?: boolean
  /** Custom TypeScript compiler options */
  compilerOptions?: ts.CompilerOptions
  /** Emit a source map pointing back to the original file. @default false */
  sourceMap?: boolean
}

export interface TransformResult {
  /** Transformed JavaScript code */
  code: string
  /** Source map (JSON string) pointing back to the original source, or null if unavailable */
  map: string | null
}

/** Options for the internal emit Program - overridden so Program.emit() can't no-op. */
export function resolveInternalProgramOptions(
  tsconfigOptions: ts.CompilerOptions,
  sourceMap: boolean
): ts.CompilerOptions {
  return {
    ...tsconfigOptions,
    sourceMap,
    inlineSources: sourceMap, // needed for the bundler to merge this map with others
    noEmit: false,
    declaration: false,
    declarationMap: false,
    composite: false,
    incremental: false
  }
}

/** Wraps novadiTransformer to detect whether it changed the file, by reference equality. */
function trackedNovadiTransformer(
  program: ts.Program | null,
  onChange: () => void
): ts.TransformerFactory<ts.SourceFile> {
  return context => {
    const run = novadiTransformer(program)(context)
    return (sourceFile) => {
      const transformed = run(sourceFile)
      if (transformed !== sourceFile) {
        onChange()
      }
      return transformed
    }
  }
}

/**
 * Transform TypeScript code using NovaDI transformer
 * @param code Source code to transform
 * @param id File path/identifier
 * @param program TypeScript Program for type checking (optional)
 * @param options Transform options
 * @returns Transformed code + source map, or null if no transformation needed
 */
export function transformCode(
  code: string,
  id: string,
  program: ts.Program | null,
  options: TransformOptions = {}
): TransformResult | null {
  // Skip non-TypeScript files
  if (!id.endsWith('.ts') && !id.endsWith('.tsx')) {
    return null
  }

  // Skip declaration files
  if (id.endsWith('.d.ts')) {
    return null
  }

  // Skip node_modules unless explicitly allowed (@novadi/core itself)
  if (id.includes('node_modules') && !id.includes('@novadi/core')) {
    return null
  }

  if (options.debug) {
    console.log(`[NovaDI] Transforming: ${id}`)
  }

  try {
    // Must emit through this same Program: it won't re-bind an already-bound
    // SourceFile, so a different Program would leave new nodes unparented.
    const boundSourceFile = program?.getSourceFile(id)

    if (boundSourceFile && program) {
      let changed = false
      const transformer = trackedNovadiTransformer(program, () => { changed = true })
      let outputCode: string | null = null
      let outputMap: string | null = null

      program.emit(
        boundSourceFile,
        (fileName, data) => {
          if (fileName.endsWith('.map')) {
            outputMap = data
          } else {
            outputCode = data
          }
        },
        undefined,
        false,
        { before: [transformer] }
      )

      if (changed && outputCode) {
        if (options.debug) {
          console.log(`[NovaDI] ✓ Transformed ${id}`)
        }

        return { code: outputCode, map: outputMap }
      }

      // Program.emit() silently no-ops outside its rootDir (e.g. a cross-package
      // import) - fall through to transpileModule, which doesn't care.
    }

    // Pass null: transpileModule parses a fresh, unbound SourceFile, and
    // checker-based autowiring needs nodes from the Program it was built from.
    let changed = false
    const transformer = trackedNovadiTransformer(null, () => { changed = true })
    const jsResult = ts.transpileModule(code, {
      compilerOptions: {
        target: options.compilerOptions?.target ?? ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        esModuleInterop: true,
        skipLibCheck: true,
        ...options.compilerOptions,
        sourceMap: options.sourceMap ?? false,
        inlineSources: options.sourceMap ?? false
      },
      fileName: id,
      transformers: { before: [transformer] }
    })

    if (!changed) {
      // No changes needed
      return null
    }

    if (options.debug) {
      console.log(`[NovaDI] ✓ Transformed ${id}`)
    }

    return { code: jsResult.outputText, map: jsResult.sourceMapText ?? null }
  } catch (error) {
    // Log error but don't fail the build - fail gracefully
    console.error(`[NovaDI] Transform error in ${id}:`, error)
    // Return null to use original code
    return null
  }
}
