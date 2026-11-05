let pendingDiary=null;
function transferButtons(){return `<div class="g2"><button class="sm" onclick="exportDiary()">Сохранить в файл</button><button class="sm" onclick="chooseDiary()">Загрузить из файла</button></div><p class="em" style="margin-top:10px">Для переноса в Telegram сначала сохраните файл здесь, затем загрузите его в боте. Файл содержит дневник и параметры профиля.</p>`}
function chooseDiary(){const input=document.getElementById('diary-file');input.value='';input.click()}
async function exportDiary(){
 try{
  const file=new File([DiaryBackup.stringify(S)],'kalorii-'+today()+'.json',{type:'application/json'});
  if(navigator.canShare?.({files:[file]})&&navigator.share){await navigator.share({files:[file],title:'Дневник Калории'});return}
  const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=file.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }catch(e){if(e.name!=='AbortError')toast('Не удалось сохранить файл. Попробуйте открыть приложение в Safari.',{type:'error',title:'Файл не сохранён'})}
}
async function previewDiary(file){
 if(!file)return;
 try{
  if(file.size>20*1024*1024)throw Error('size');pendingDiary=DiaryBackup.parse(await file.text());
  const days=Object.keys(pendingDiary.log).length,count=Object.values(pendingDiary.log).reduce((n,rows)=>n+rows.length,0),label={one:'запись',few:'записи',many:'записей',other:'записи'}[new Intl.PluralRules('ru').select(count)];
  sheet(`<h2>Перенести дневник?</h2><p class="sub">В файле: ${days} дн., ${count} ${label} о еде.</p><p>Данные в этом окне будут заменены данными из файла. Текущий дневник будет сохранён на устройстве как копия до переноса.</p><button class="pri" onclick="importDiary()">Загрузить дневник</button><button class="ghost" onclick="pendingDiary=null;closeSheet();render()">Отмена</button>`);
 }catch{pendingDiary=null;toast('Выберите файл, созданный кнопкой «Сохранить в файл» в приложении «Калории» (до 20 МБ).',{type:'error',title:'Не удалось прочитать дневник'})}
}
function importDiary(){
 if(!pendingDiary)return;
 try{DiaryBackup.store(localStorage,KEY,pendingDiary,S)}catch{toast('Не удалось записать данные на устройство. Освободите место и повторите загрузку.',{type:'error',title:'Дневник не загружен'});return}
 voiceCancel();kbClose();S=pendingDiary;pendingDiary=null;DAY=null;V='today';closeSheet(true);render();schedSync();toast('Записи и профиль загружены на это устройство.',{type:'success',title:'Дневник перенесён'});
}
function restoreDiary(){
 try{const raw=localStorage.getItem(KEY+'-before-import');if(!raw)return toast('Копии до переноса пока нет.');const file=new File([DiaryBackup.stringify(JSON.parse(raw))],'restore.json');return previewDiary(file)}catch{toast('Не удалось прочитать копию до переноса.',{type:'error'})}
}
