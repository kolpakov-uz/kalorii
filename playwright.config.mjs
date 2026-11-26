import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
 testDir:'./scripts/browser',testMatch:'**/*.spec.mjs',workers:1,fullyParallel:false,
 timeout:15000,expect:{timeout:4000},reporter:'list',outputDir:'.wrangler/ui-results',
 use:{baseURL:'http://127.0.0.1:4179',headless:true,timezoneId:'Asia/Tashkent',screenshot:'only-on-failure'},
 projects:[{name:'chromium',use:{browserName:'chromium',viewport:{width:390,height:844}}},{name:'webkit-iphone',use:{...devices['iPhone 13'],browserName:'webkit'}}],
 webServer:{command:'node scripts/browser/server.mjs',url:'http://127.0.0.1:4179',reuseExistingServer:false,timeout:10000}
});
