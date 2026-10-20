// ============================================================================
// Google Apps Script: приём обратной связи тренажера + выдача для дашборда
// ----------------------------------------------------------------------------
// Что делает:
//   doPost(e)  — тренажер шлет сюда оценку и комментарий, скрипт пишет их
//                в новую строку активного листа таблицы.
//   doGet(e)   — дашборд запрашивает данные, скрипт возвращает их как JSON.
//
// Настройка (один раз, ~5 минут):
//   1. Создайте Google Таблицу (sheets.new) — в ней будет копиться обратная
//      связь. В первую строку вручную впишите заголовки:
//        Дата  |  Оценка  |  Комментарий
//   2. В таблице: Расширения → Apps Script. Удалите шаблон и вставьте весь
//      код из этого файла.
//   3. Нажмите «Развернуть» (Deploy) → «Новое развертывание» → тип «Веб-приложение»
//      (Web app). Кто имеет доступ: выберите «Все, у кого есть ссылка» /
//      «Любой» (Anyone). Нажмите «Развернуть».
//   4. Скопируйте URL веб-приложения (формат https://script.google.com/macros/s/.../exec)
//      и вставьте его:
//      - в тренажере: js/data.js → const SURVEY_ENDPOINT = "URL";
//      - в дашборде:  dashboard.html → var DATA_ENDPOINT = "URL";
//   5. Переразверните и запушьте тренажер.
// ============================================================================

// Имя листа, куда пишем (по умолчанию первый лист).
var SHEET_NAME = null; // null = активный (первый) лист

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (SHEET_NAME) return ss.getSheetByName(SHEET_NAME);
  return ss.getSheets()[0];
}

// Приём ответа от тренажера (POST). Тело запроса — JSON.
function doPost(e) {
  try {
    var body = e.postData && e.postData.contents ? e.postData.contents : "";
    var data = JSON.parse(body);
    var sheet = getSheet_();
    sheet.appendRow([
      data.date || new Date().toISOString(),
      data.rating || "",
      data.comment || ""
    ]);
    return ContentService.createTextOutput("ok").setMimeType(ContentService.MimeType.TEXT);
  } catch (err) {
    return ContentService.createTextOutput("error: " + err.message)
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

// Выдача данных для дашборда (GET). Возвращает JSON-массив строк.
function doGet(e) {
  try {
    var sheet = getSheet_();
    var values = sheet.getDataRange().getValues();
    var rows = [];
    // Пропускаем первую строку (заголовки)
    for (var i = 1; i < values.length; i++) {
      var r = values[i];
      rows.push({
        date: r[0] || "",
        rating: r[1] || 0,
        comment: r[2] || ""
      });
    }
    return ContentService.createTextOutput(JSON.stringify(rows))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}