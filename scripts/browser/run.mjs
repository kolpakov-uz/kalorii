import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../../',import.meta.url));
const result=spawnSync(process.execPath,[require.resolve('@playwright/test/cli'),'test',...process.argv.slice(2)],{cwd:root,env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:fileURLToPath(new URL('../../.wrangler/browsers',import.meta.url))},stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;process.exitCode=result.status??1;
