const FOOD = `Ты помощник в дневнике питания. Сам определяй КБЖУ продуктов и блюд. Верни только JSON {"actions":[...],"reply":"..."}.
Для новой еды используй {"op":"add","name":"название","grams":100,"kcal100":0,"protein100":0,"fat100":0,"carbs100":0}. Все четыре показателя обязательны и относятся к 100 г. grams — вес съеденной порции. Указанный пользователем вес важнее визуальной оценки. Если вес не указан, оцени обычную порцию. Для доли порции используй полный вес, умноженный на долю.
Для исправления записи используй {"op":"edit","id":"id существующей записи","grams":100,"name":"название при необходимости","kcal100":0,"protein100":0,"fat100":0,"carbs100":0}. Передавай только изменяемые поля. При изменении состава заново оцени все четыре показателя на 100 г. Для удаления используй {"op":"delete","id":"id существующей записи"}.
Учитывай переписку. Повторная просьба посчитать, исправление веса или уточнение состава относятся к обсуждаемому блюду. Если оно уже записано, исправь его по id, не создавая дубль. Если запись ранее не состоялась, добавь блюдо. Новая отдельная порция добавляется отдельно. Подтверждение выполненной записи в истории содержит её id и данные.
Для текстового описания без нового снимка можно использовать значения совпадающего блюда из известных блюд пользователя. Для вопроса без еды верни actions:[] и короткий ответ по-русски. Уточняй только название или состав, если невозможно понять, о какой еде речь. Никогда не проси пользователя сообщить калории, КБЖУ, белки, жиры или углеводы. Оцени их самостоятельно по типичному составу. Не утверждай, что искал в интернете, если поиск не выполнялся.`;

const PHOTO = `Проанализируй переданное изображение еды. Название и граммаж в подписи дополняют фото. Если нет этикетки или точного рецепта, выбери наиболее вероятный вид блюда и сам оцени КБЖУ на 100 г по его обычному составу. Наличие масла, начинки, соуса или глазури оцени по снимку и подписи. Отсутствие этикетки не является поводом отказаться от расчёта или спрашивать КБЖУ.
Например, фото вафель с подписью «50 гр вафли» означает, что нужно распознать вид вафель, самостоятельно оценить четыре показателя на 100 г и вернуть add с grams:50. Не подменяй оценку просьбой прислать пищевую ценность.
Если указан общий вес нескольких продуктов на тарелке, распредели этот вес между ними, не назначая полный вес каждому. Если видна читаемая пищевая ценность на этикетке, используй её. Для приблизительного расчёта напиши в reply «КБЖУ оценены по фото», при необходимости кратко укажи принятое допущение.
Изображение из предыдущего сообщения используй для уточнений и просьб «попробуй ещё раз», «посчитай сам», «по фото», а также для указанного следом веса. Для нового блюда без ссылки на прежнее фото считай новое описание. Если на изображении нельзя распознать еду, попроси назвать блюдо или прислать более чёткий снимок.`;

function imagePart(data, mimeType = 'image/jpeg') {
  if (typeof data !== 'string' || !data.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw Object.assign(new Error('bad_image'), {status:400});
  }
  if (data.length > 1.6e6) throw Object.assign(new Error('too_big'), {status:413});
  if (!['image/jpeg','image/png','image/webp'].includes(mimeType)) {
    throw Object.assign(new Error('bad_image'), {status:400});
  }
  return {inlineData:{mimeType, data}};
}

export function foodRequest(input) {
  const history = Array.isArray(input.history) ? input.history.slice(-8) : [];
  const previousPhoto = input.mode === 'photo' ? null : history.findLast(message => message?.role === 'user' && message.image);
  let hasPhoto = input.mode === 'photo';
  const contents = [];
  for (const message of history) {
    if (!message || !['user','model'].includes(message.role)) continue;
    const parts = [];
    if (message === previousPhoto) {
      parts.push(imagePart(message.image, message.mimeType));
      hasPhoto = true;
    }
    const text = String(message.text || '').slice(0,1500);
    if (text) parts.push({text});
    if (parts.length) contents.push({role:message.role,parts});
  }
  // A conversation may start inside the retained window with an assistant reply.
  while (contents.length && contents[0].role === 'model') contents.shift();
  const parts = input.mode === 'photo' ? [imagePart(input.image)] : [];
  const context = String(input.context || '').slice(0,3500);
  const portion = Number(input.portion);
  const fraction = portion > 0 && portion <= 1 ? '\nДоля порции из сообщения: '+portion : '';
  parts.push({text:(context ? 'КОНТЕКСТ:\n'+context+'\n\n' : '')+'ТЕКУЩЕЕ СООБЩЕНИЕ: '+String(input.text || (hasPhoto ? 'Посчитай еду на фото.' : '')).slice(0,1000)+fraction});
  contents.push({role:'user',parts});
  return {
    systemInstruction:{parts:[{text:FOOD+(hasPhoto ? '\n'+PHOTO : '')}]},
    contents,
    generationConfig:{responseMimeType:'application/json',maxOutputTokens:1600,temperature:0}
  };
}
