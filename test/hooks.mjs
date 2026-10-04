import {register} from 'node:module';

// Resolve extensionless relative imports (the codebase style) to .ts files
// so the stdlib runner can execute TypeScript sources directly via type
// stripping. No build step, no new framework.
register('./resolve-ts.mjs', import.meta.url);
