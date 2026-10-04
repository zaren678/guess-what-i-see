// Node module customization hook: `./state` -> `./state.ts` (then
// `./index.ts`). Only retries relative specifiers that Node could not
// resolve on its own; everything else rethrows untouched.

/**
 * @param {string} specifier
 * @param {object} context
 * @param {function} nextResolve
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const missing =
      err?.code === 'ERR_MODULE_NOT_FOUND' ||
      err?.code === 'ERR_UNSUPPORTED_DIR_IMPORT';
    const relative =
      specifier.startsWith('./') || specifier.startsWith('../');
    if (!missing || !relative) throw err;
    for (const candidate of [`${specifier}.ts`, `${specifier}/index.ts`]) {
      try {
        return await nextResolve(candidate, context);
      } catch {
        // Try the next candidate.
      }
    }
    throw err;
  }
}
