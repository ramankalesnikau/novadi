/**
 * Configuration options for NovaDI unplugin
 */

export interface NovadiPluginOptions {
  /**
   * Enable debug logging
   * @default false
   */
  debug?: boolean

  /**
   * Include patterns (glob or regex)
   * Files matching these patterns will be transformed
   * @default [/\.[jt]sx?$/]
   */
  include?: Array<string | RegExp>

  /**
   * Exclude patterns (glob or regex)
   * Files matching these patterns will NOT be transformed
   * @default [/node_modules/]
   */
  exclude?: Array<string | RegExp>

  /**
   * Custom TypeScript compiler options
   */
  compilerOptions?: Record<string, any>

  /**
   * Enable automatic autowiring with TypeScript Program
   * Requires TypeScript type checking - adds ~500ms to initial build
   * @default true
   */
  enableAutowiring?: boolean

  /**
   * Enable performance logging
   * @default false
   */
  performanceLogging?: boolean

  /**
   * Emit source maps pointing transformed output back to the original file
   * @default false
   */
  sourceMap?: boolean
}

export function resolveOptions(
  options: NovadiPluginOptions = {}
): Required<NovadiPluginOptions> {
  return {
    debug: options.debug ?? false,
    include: options.include ?? [/\.[jt]sx?$/],
    exclude: options.exclude ?? [/node_modules/],
    compilerOptions: options.compilerOptions ?? {},
    enableAutowiring: options.enableAutowiring ?? true,
    performanceLogging: options.performanceLogging ?? false,
    sourceMap: options.sourceMap ?? false
  }
}
