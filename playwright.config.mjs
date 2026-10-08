import { defineConfig } from '@playwright/test';
const port=process.env.TEST_PORT??'4320';const baseURL=`http://127.0.0.1:${port}`;
export default defineConfig({testDir:'tests/browser',workers:1,timeout:20000,use:{baseURL,headless:true,launchOptions:process.env.PLAYWRIGHT_CHROME_PATH?{executablePath:process.env.PLAYWRIGHT_CHROME_PATH}:{}},webServer:{command:'node dist/server/main.js',url:baseURL,reuseExistingServer:false,env:{PORT:port,APP_MODE:'mock',ALLOW_LIVE_API:'false',OPENAI_API_KEY:'',ALLOW_CLAUDE_CLI:'false'}}});
