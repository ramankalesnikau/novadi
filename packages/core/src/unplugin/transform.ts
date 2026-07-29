/**
 * Transform logic for NovaDI unplugin
 * Wraps the existing TypeScript transformer
 */

import * as ts from 'typescript'
import novadiTransformer from '../transformer/index.js'

export interface TransformOptions {
  /** Enable debug logging */
  debug?: boolean
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
 * @returns Transformed code or null if no transformation needed
 */
export function transformCode(
  code: string,
  id: string,
  program: ts.Program | null,
  options: TransformOptions = {}
): string | null {
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
    // A Program-bound SourceFile lets the transformer's checker calls resolve
    // types; an unbound one (Vite/Vitest, or files outside the Program) falls
    // back to the transformer's own AST-based parameter inference.
    const boundSourceFile = program?.getSourceFile(id) ?? null
    const sourceFile =
      boundSourceFile ??
      ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, id.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

    let changed = false
    const transformer = trackedNovadiTransformer(boundSourceFile ? program : null, () => { changed = true })

    const result = ts.transform(sourceFile, [transformer])
    const [transformedSourceFile] = result.transformed

    if (!changed) {
      result.dispose()
      return null
    }

    const printedCode = ts.createPrinter().printFile(transformedSourceFile)
    result.dispose()

    if (options.debug) {
      console.log(`[NovaDI] ✓ Transformed ${id}`)
    }

    return printedCode
  } catch (error) {
    // Log error but don't fail the build - fail gracefully
    console.error(`[NovaDI] Transform error in ${id}:`, error)
    // Return null to use original code
    return null
  }
}
