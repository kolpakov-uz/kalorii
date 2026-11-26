// Native text selection and clipboard helpers shared by the diary and coach.
const ChatText=(()=>{
 const keys=new WeakMap();let nextKey=0;
 const icon='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>';
 const button='<div class="msg-tools"><button type="button" class="msg-copy" data-copy-message aria-label="Скопировать сообщение" title="Скопировать сообщение">'+icon+'</button></div>';
 function markup(safeHtml){return '<div class="message-text">'+safeHtml+'</div>'+button}
 function value(editor){return (typeof editor.innerText==='string'?editor.innerText:editor.textContent||'').replace(/\r\n?/g,'\n')}
 function decorate(bubble){
  if(bubble.querySelector('.message-text')||!bubble.textContent.trim())return;
  const text=document.createElement('div');text.className='message-text';
  while(bubble.firstChild)text.append(bubble.firstChild);
  bubble.append(text);bubble.insertAdjacentHTML('beforeend',button);
 }
 function key(message){
  if(message.task)return message.r+'-'+message.task;
  if(!message.r&&message.ids)return 'unclaimed-'+message.ids.join('-');
  if(!keys.has(message))keys.set(message,'message-'+(++nextKey));return keys.get(message);
 }
 function snapshot(){const s=window.getSelection?.();return s?.rangeCount?{anchor:s.anchorNode,a:s.anchorOffset,focus:s.focusNode,f:s.focusOffset}:null}
 function restore(saved){
  if(!saved?.anchor?.isConnected||!saved?.focus?.isConnected)return;
  const s=window.getSelection();
  if(s.anchorNode===saved.anchor&&s.anchorOffset===saved.a&&s.focusNode===saved.focus&&s.focusOffset===saved.f)return;
  try{s.setBaseAndExtent(saved.anchor,saved.a,saved.focus,saved.f)}catch{/* A changed message cannot keep its old range. */}
 }
 function hasSelection(root){const s=window.getSelection?.();return !!(root&&s&&!s.isCollapsed&&root.contains(s.anchorNode)&&root.contains(s.focusNode))}
 function reconcile(root,html){
  const saved=snapshot(),template=document.createElement('template');template.innerHTML=html;
  const existing=new Map([...root.children].filter(n=>n.dataset.messageKey).map(n=>[n.dataset.messageKey,n]));
  let cursor=root.firstChild;
  for(const candidate of [...template.content.childNodes]){
   const old=candidate.nodeType===1&&existing.get(candidate.dataset.messageKey),node=old&&old.outerHTML===candidate.outerHTML?old:candidate;
   if(node===cursor)cursor=cursor.nextSibling;else root.insertBefore(node,cursor);
  }
  while(cursor){const next=cursor.nextSibling;cursor.remove();cursor=next}
  restore(saved);
 }
 function allowGesture(target){
  if(target.closest?.('.bub,.ce[contenteditable="true"],.ce[contenteditable="plaintext-only"]'))return true;
  return hasSelection(document.getElementById('sheet'));
 }
 async function write(text){
  try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);return true}}catch{/* Older WebViews may only support the synchronous copy command. */}
  const active=document.activeElement,saved=snapshot(),field=document.createElement('textarea');
  field.value=text;field.readOnly=true;field.setAttribute('aria-hidden','true');field.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;font-size:16px;pointer-events:none';
  let copied=false;
  try{document.body.append(field);field.focus({preventScroll:true});field.select();field.setSelectionRange(0,text.length);copied=document.execCommand('copy')===true}catch{/* Failure must never delete text or claim success. */}
  finally{field.remove();if(active?.isConnected)active.focus({preventScroll:true});restore(saved)}
  return copied;
 }
 document.addEventListener('pointerdown',event=>{if(event.target.closest('[data-copy-message]'))event.preventDefault()});
 document.addEventListener('click',async event=>{
  const control=event.target.closest('[data-copy-message]');if(!control)return;
  const content=control.closest('.bub')?.querySelector('.message-text');if(!content)return;
  const copied=await write(content.textContent);
  toast(copied?'Текст скопирован':'Не удалось скопировать. Выделите текст и выберите «Копировать».',{type:copied?'success':'warning'});
 });
 return {markup,value,decorate,key,hasSelection,reconcile,allowGesture,write};
})();
