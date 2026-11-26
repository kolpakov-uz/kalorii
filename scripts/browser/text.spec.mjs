import {test,expect} from '@playwright/test';
const message='40 г кремчиза\nБез хлеба 🧀';
async function open(page,{telegram=true,ownKb=false,coach=false}={}){
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.hostname==='127.0.0.1')return route.continue();
  if(url.hostname==='kalorii-ai.crytime04.workers.dev'){
   const data=route.request().postDataJSON()||{};
   return route.fulfill({json:data.mode==='access'?{allowed:true}:data.mode==='nutrition'?{text:'{"rows":[]}'}:{text:'{"actions":[],"reply":"Тестовый ответ тренера"}'}});
  }
  return route.fulfill({body:'',contentType:'text/javascript'});
 });
 await page.addInitScript(({telegram,ownKb,message})=>{
  if(telegram)window.Telegram={WebApp:{initData:'test-only',initDataUnsafe:{user:{id:12345}},colorScheme:'dark',isVersionAtLeast:()=>false,onEvent(){},ready(){},expand(){}}};
  const day=new Date().toLocaleDateString('sv');
  localStorage.setItem(telegram?'kalorii-v1-telegram-12345':'kalorii-v1',JSON.stringify({profile:{sex:'m',a:30,h:180,w:80,act:1.2,goal:'keep'},weights:[{d:day,w:80}],ownKb,nutrition:{version:1,rows:[],defaults:{}},hist:{[day+'|b']:[{r:'me',t:message},{r:'ai',t:'Записано 40 г кремчиза.'}]},chat:[{role:'user',content:message},{role:'assistant',content:'Тестовый ответ тренера'}]}));
 },{telegram,ownKb,message});
 await page.goto('/');await expect(page.locator('#tabs')).toBeVisible();
 await page.evaluate(coach=>coach?go('coach'):openAdd('b'),coach);
 await expect(page.locator(coach?'#ci':'#ai')).toBeVisible();
}
test('native input selection replaces just the selected words and keeps the phone keyboard',async({page})=>{
 await open(page);const input=page.locator('#ai');await input.fill('Творог 200 г 🧀');
 await input.evaluate(el=>{const text=el.firstChild,selection=getSelection(),range=document.createRange();range.setStart(text,7);range.setEnd(text,10);selection.removeAllRanges();selection.addRange(range)});
 await page.keyboard.type('250');await expect(input).toHaveText('Творог 250 г 🧀');await expect(page.locator('#vk')).toHaveCount(0);
});
test('the dialog does not cancel native selection gestures in the editor or messages',async({page})=>{
 await open(page);await page.locator('#ai').fill('Текст для выделения');
 for(const selector of ['#ai','#am .bub.me'])expect(await page.locator(selector).evaluate(el=>{const event=new Event('touchmove',{bubbles:true,cancelable:true});el.dispatchEvent(event);return event.defaultPrevented})).toBe(false);
});
test('an incoming diary update preserves selection in an existing message',async({page})=>{
 await open(page);await page.waitForTimeout(100);
 await page.locator('#am .bub.me').evaluate(el=>{const range=document.createRange();range.selectNodeContents(el.querySelector('.message-text')||el);const s=getSelection();s.removeAllRanges();s.addRange(range)});
 expect(await page.evaluate(()=>getSelection().toString())).toBe(message);
 await page.evaluate(()=>{S.hist[hk()].push({r:'ai',t:'Дополнительный ответ'});loadHist()});
 expect(await page.evaluate(()=>getSelection().toString())).toBe(message);
});
test('a sent message has an accessible copy action preserving lines and emoji',async({page})=>{
 await open(page);await page.evaluate(()=>{window.copied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copied.push(text)}})});
 await page.locator('#am .bub.me').getByRole('button',{name:'Скопировать сообщение',exact:true}).click();
 expect(await page.evaluate(()=>window.copied)).toEqual([message]);
 await page.screenshot({path:'.wrangler/text-'+test.info().project.name+'.png'});
});
test('clipboard fallback copies only the message and preserves the draft selection',async({page})=>{
 await open(page);await page.locator('#ai').fill('Рис 200 г');
 await page.evaluate(()=>{
  const field=document.querySelector('#ai'),range=document.createRange();range.setStart(field.firstChild,4);range.setEnd(field.firstChild,7);getSelection().removeAllRanges();getSelection().addRange(range);
  window.copied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied')}}});
  document.addEventListener('copy',event=>{const field=document.activeElement,text=field.value.slice(field.selectionStart,field.selectionEnd);event.clipboardData.setData('text/plain',text);event.preventDefault();window.copied.push(text)});
 });
 await page.locator('#am .bub.me').getByRole('button',{name:'Скопировать сообщение',exact:true}).click();
 expect(await page.evaluate(()=>window.copied)).toEqual([message]);expect(await page.evaluate(()=>getSelection().toString())).toBe('200');await expect(page.locator('#ai')).toHaveText('Рис 200 г');await expect(page.locator('#toast')).toContainText('Текст скопирован');
});
test('copy failure gives an honest message and leaves the draft unchanged',async({page})=>{
 await open(page);await page.locator('#ai').fill('Мой черновик');
 await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied')}}});document.execCommand=()=>false});
 await page.locator('#am .bub.me').getByRole('button',{name:'Скопировать сообщение',exact:true}).click();
 await expect(page.locator('#toast')).toContainText('Не удалось скопировать');await expect(page.locator('#ai')).toHaveText('Мой черновик');
});
async function ownMenu(page,clipboard){
 await open(page,{telegram:false,ownKb:true});await page.locator('#ai').evaluate(el=>el.textContent='Тестовый текст');await page.locator('#ai').click();
 await page.evaluate(clipboard=>{window.copied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(clipboard==='denied')throw Error('denied');window.copied.push(text);if(clipboard==='changed'){BUF.push('!');kbRender(KT,BUF)}},readText:async()=> 'я'.repeat(600)+' 🍲'}});if(clipboard==='denied')document.execCommand=()=>false;SS=0;SE=4;CP=4;kbRender(KT,BUF);showMenu(80,350)},clipboard);
}
test('custom keyboard never cuts the selected text when copying is denied',async({page})=>{
 await ownMenu(page,'denied');await page.getByRole('button',{name:'Вырезать',exact:true}).click();await expect(page.locator('#toast')).toContainText('Текст оставлен без изменений');await expect(page.locator('#ai')).toHaveText('Тестовый текст');
});
test('custom keyboard cuts once after a successful copy',async({page})=>{
 await ownMenu(page,'ok');await page.getByRole('button',{name:'Вырезать',exact:true}).click();await expect(page.locator('#ai')).toHaveText('овый текст');expect(await page.evaluate(()=>window.copied)).toEqual(['Тест']);
});
test('typing during asynchronous copy cannot cut a different range',async({page})=>{
 await ownMenu(page,'changed');await page.getByRole('button',{name:'Вырезать',exact:true}).click();await expect(page.locator('#ai')).toHaveText('Тестовый текст!');await expect(page.locator('#toast')).toContainText('Повторите вырезание');
});
test('custom paste preserves long text, emoji and the unselected suffix',async({page})=>{
 await ownMenu(page,'ok');await page.getByRole('button',{name:'Вставить',exact:true}).click();await expect(page.locator('#ai')).toHaveText('я'.repeat(600)+' 🍲овый текст');
});
test('a vertical scroll does not open the custom selection menu',async({page})=>{
 await open(page,{telegram:false,ownKb:true});await page.locator('#ai').click();await page.locator('#ai').dispatchEvent('pointerdown',{pointerId:8,clientX:100,clientY:400});await page.locator('#ai').dispatchEvent('pointermove',{pointerId:8,clientX:100,clientY:450});await page.waitForTimeout(550);await expect(page.locator('#cmenu')).toHaveCount(0);
});
test('system keyboard remains available when the custom keyboard is disabled',async({page})=>{
 await open(page,{telegram:false,ownKb:false});await expect(page.locator('#ai')).toHaveAttribute('contenteditable','plaintext-only');await page.locator('#ai').click();await expect(page.locator('#vk')).toHaveCount(0);
});
test('Telegram always uses the native editor even with a saved custom-keyboard preference',async({page})=>{
 await open(page,{telegram:true,ownKb:true});await expect(page.locator('#ai')).toHaveAttribute('contenteditable','plaintext-only');await page.locator('#ai').click();await expect(page.locator('#vk')).toHaveCount(0);
});
test('live and restored coach messages have working copy actions',async({page})=>{
 await open(page,{coach:true});await page.evaluate(()=>{window.copied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.copied.push(text)}})});
 await page.locator('#chat .bub.me').getByRole('button',{name:'Скопировать сообщение',exact:true}).click();expect(await page.evaluate(()=>window.copied)).toEqual([message]);
 await page.locator('#ci').fill('Привет 💪\nКак дела?');await page.locator('.send').getByRole('button',{name:'Отправить',exact:true}).click();
 await expect(page.locator('#chat .bub.ai').last()).toContainText('Тестовый ответ тренера');await page.locator('#chat .bub.me').last().getByRole('button',{name:'Скопировать сообщение',exact:true}).click();expect((await page.evaluate(()=>window.copied)).at(-1)).toBe('Привет 💪\nКак дела?');
});
