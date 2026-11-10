import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// The archived test-apps link points at the repository's ignored checkout directory.
// Create its target first; mkdir through a dangling directory symlink fails with EEXIST.
const sharedApps=resolve(dirname(fileURLToPath(import.meta.url)),'../../../test-apps');
mkdirSync(sharedApps,{recursive:true});
