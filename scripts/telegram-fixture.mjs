import {createHmac} from 'node:crypto';
export const telegramEnvFixture={TELEGRAM_BOT_TOKEN:'123456:fixture-only-not-a-real-token',TELEGRAM_ALLOWED_IDS:'[111,222]'};
export function telegramPayload(body,id=111){
 const fields={auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id,first_name:'Тест'})};
 const check=Object.entries(fields).sort().map(([k,v])=>k+'='+v).join('\n');
 const key=createHmac('sha256','WebAppData').update(telegramEnvFixture.TELEGRAM_BOT_TOKEN).digest();
 return {...body,telegramInitData:new URLSearchParams({...fields,hash:createHmac('sha256',key).update(check).digest('hex')}).toString()};
}
