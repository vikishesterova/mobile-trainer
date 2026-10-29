// ============================================================================
// Логика мобильного тренажера по дарк-паттернам
// ============================================================================

(function () {
  "use strict";

  var app = document.getElementById("app");

  var state = {
    mode: "training",          // "training" | "review"
    index: 0,                  // индекс текущего кейса в активном проходе
    answers: [],               // ответы основного (тренировочного) прохода
    currentSelected: -1,       // выбранный вариант текущего кейса
    answeredCurrent: false,    // отвечен ли текущий кейс (для восстановления после перезагрузки)
    finishedResult: null,      // { correct, total, pct } завершённой тренировки
    reviewCases: [],           // кейсы для повторения ошибок
    reviewIndex: 0,
    reviewAnswers: [],
    survey: null,
    currentCaseId: null,       // id текущего кейса — для контекста в кнопке «Отзыв»
  };

  // --- утилиты -------------------------------------------------------------------

  // Суммы и единицы переносим целиком, короткие слова связываем со следующим.
  function nbspJoin(text) {
    var s = String(text);
    // Все группы цифр внутри суммы, включая уже типографированные пробелы.
    s = s.replace(/\d+(?:[ \t\u00A0\u202F]\d{3})+(?!\d)/g, function (amount) {
      return amount.replace(/[ \t\u00A0\u202F]/g, "\u00A0");
    });
    s = s.replace(/(\d)[ \t\u00A0\u202F]+([₽$€%]|м[²³]|Мбит\/с)(?=$|[\s.,!?;:)])/gi, "$1\u00A0$2");
    // Повторный проход нужен для сочетаний «и в», «а для» и начала предложения.
    var previous;
    do {
      previous = s;
      s = s.replace(/(^|\s)(в|во|к|ко|с|со|о|об|обо|у|за|на|до|по|из|от|без|для|при|про|под|над|перед|через|между|но|и|а|не)[ \t]+(?=\S)/gi, "$1$2\u00A0");
    } while (s !== previous);
    return s;
  }

  // убираем завершающую точку у блока текста (внутренние точки между предложениями сохраняем)
  function noPeriod(text) {
    return String(text).replace(/\.\s*$/, "");
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = nbspJoin(noPeriod(text));
    return node;
  }

  function render(node) {
    app.innerHTML = "";
    app.appendChild(node);
    // держим кнопку «Отзыв» в синхроне с текущим кейсом
    if (fbFloat) {
      var href = FEEDBACK_URL + (state.currentCaseId ? ("?case=" + state.currentCaseId) : "");
      if (fbFloat.getAttribute("href") !== href) fbFloat.setAttribute("href", href);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // --- аналитика: Яндекс Метрика -------------------------------------------------
  function track(name, data) {
    try {
      var mid = window.METRIKA_ID || "";
      if (typeof window.ym === "function" && /^\d+$/.test(mid)) {
        window.ym(mid, "reachGoal", name, data || {});
      }
    } catch (e) {}
    try {
      if (window.console && window.console.log) {
        window.console.log("[metrika]", name, data || {});
      }
    } catch (e) {}
  }

  function correctCount() {
    return state.answers.filter(function (a) { return a.correct; }).length;
  }

  // ============================================================================
  // Сохранение прогресса в текущем браузере (localStorage)
  // ============================================================================
  var PROGRESS_KEY = "dark-patterns-progress-v2";

  // активный список кейсов/индекс/ответы — по режиму (тренировка или повторение)
  function activeCases() { return state.mode === "review" ? state.reviewCases : CASES; }
  function activeIndex() { return state.mode === "review" ? state.reviewIndex : state.index; }
  function setActiveIndex(i) {
    if (state.mode === "review") state.reviewIndex = i; else state.index = i;
  }
  function activeAnswers() { return state.mode === "review" ? state.reviewAnswers : state.answers; }
  function currentCase() { return activeCases()[activeIndex()]; }

  // сброс состояния к новому запуску
  function resetState() {
    state.mode = "training";
    state.index = 0;
    state.answers = [];
    state.currentSelected = -1;
    state.answeredCurrent = false;
    state.finishedResult = null;
    state.reviewCases = [];
    state.reviewIndex = 0;
    state.reviewAnswers = [];
  }

  function hasProgress() {
    try { return !!window.localStorage.getItem(PROGRESS_KEY); } catch (e) { return false; }
  }

  function saveProgress() {
    try {
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify({
        version: 2,
        ids: CASES.map(function (c) { return c.id; }),
        index: state.index,
        answers: state.answers,
        answeredCurrent: state.answeredCurrent,
        finishedResult: state.finishedResult
      }));
      return true;
    } catch (e) { return false; }
  }

  function clearProgress() {
    try { window.localStorage.removeItem(PROGRESS_KEY); } catch (e) {}
  }

  // Возвращает status: 0 — нет сохранённого прогресса; 1 — совместим и восстановлен;
  // 2 — сохранение несовместимо с текущим набором кейсов (контент обновился).
  function restoreProgress() {
    var data;
    try { data = JSON.parse(window.localStorage.getItem(PROGRESS_KEY)); }
    catch (e) { return { status: 0 }; }
    if (!data || data.version !== 2) return { status: 0 };

    var currentIds = CASES.map(function (c) { return c.id; }).join(",");
    var savedIds = (data.ids || []).join(",");
    if (savedIds !== currentIds) return { status: 2 };

    if (!Array.isArray(data.answers)) return { status: 0 };

    state.mode = "training";
    state.index = Math.min(Math.max(0, data.index | 0), CASES.length);
    state.answers = data.answers.filter(function (a) {
      return a && typeof a.caseId === "number" && a.caseId >= 0 &&
        CASES.some(function (c) { return c.id === a.caseId; });
    });
    state.answeredCurrent = !!data.answeredCurrent && state.answers.length > 0;
    state.currentSelected = state.answeredCurrent
      ? state.answers[state.answers.length - 1].selectedIndex
      : -1;
    state.finishedResult = data.finishedResult || null;
    return { status: 1 };
  }

  // новая тренировка: при наличии сохранённых ответов — запрашиваем подтверждение
  function startFresh() {
    if (hasProgress() && !window.confirm("Начать заново? Сохранённый прогресс и ответы будут удалены.")) {
      return;
    }
    resetState();
    clearProgress();
    track("start");
    renderQuiz();
  }

  function goHome() {
    saveProgress();
    track("go_home");
    renderIntro();
  }

  // ============================================================================
  // Телефон и экраны приложений
  // ============================================================================

  // Обертка телефона с рамкой, островом, статус-баром и home-индикатором
  function phoneFrame(content, darkStatus, tint) {
    var wrap = el("div", "phone-wrap");
    var phone = el("div", "phone");
    var screen = el("div", "phone-screen" + (tint ? " tint-" + tint : ""));

    screen.appendChild(el("div", "island"));

    // статус-бар
    var status = el("div", "app-statusbar" + (darkStatus ? " status-dark" : ""));
    status.appendChild(el("span", "status-time", "9:41"));
    var icons = el("span", "status-icons");
    icons.appendChild(el("span", "", "▲"));
    icons.appendChild(el("span", "", "●"));
    icons.appendChild(el("span", "", "▮▮▮"));
    status.appendChild(icons);
    screen.appendChild(status);

    screen.appendChild(content);
    screen.appendChild(el("div", "home-indicator"));
    phone.appendChild(screen);
    wrap.appendChild(phone);
    return wrap;
  }

  // Заголовок приложения внутри экрана
  function appHeader(screenData) {
    var header = el("div", "app-header");
    header.appendChild(el("div", "app-name", screenData.app || ""));
    header.appendChild(el("div", "app-title", screenData.header.title));
    if (screenData.header.subtitle) {
      header.appendChild(el("div", "app-subtitle", screenData.header.subtitle));
    }
    return header;
  }

  // Рендер одного блока интерфейса
  function renderBlock(b) {
    switch (b.t) {
      case "card": {
        var card = el("div", "blk blk-card");
        card.appendChild(el("div", "card-label", b.label));
        card.appendChild(el("div", "card-balance", b.balance));
        if (b.sub) card.appendChild(el("div", "card-sub", b.sub));
        return card;
      }
      case "title":
        return el("h3", "blk blk-title", b.text);
      case "text":
        return el("p", "blk blk-text", b.text);
      case "offer": {
        var offer = el("div", "blk blk-offer");
        offer.appendChild(el("span", "offer-tag", b.tag));
        offer.appendChild(el("div", "offer-title", b.title));
        if (b.text) offer.appendChild(el("p", "offer-text", b.text));
        return offer;
      }
      case "compare": {
        var cmp = el("div", "blk blk-compare");
        b.rows.forEach(function (r) {
          var row = el("div", "compare-row" + (r.accent ? " accent" : ""));
          row.appendChild(el("span", "cr-label", r.label));
          row.appendChild(el("span", "cr-value", r.value));
          cmp.appendChild(row);
        });
        return cmp;
      }
      case "price": {
        var price = el("div", "blk blk-price");
        price.appendChild(el("div", "price-current", b.current));
        if (b.old) price.appendChild(el("div", "price-old", b.old));
        if (b.note) price.appendChild(el("div", "price-note", b.note));
        return price;
      }
      case "bullets": {
        var ul = el("div", "blk blk-bullets");
        b.items.forEach(function (it) {
          ul.appendChild(el("div", "bullet", it));
        });
        return ul;
      }
      case "badge": {
        var badgeWrap = el("div", "blk blk-badge");
        badgeWrap.appendChild(el("span", "badge-screen tone-" + (b.tone || "danger"), b.text));
        return badgeWrap;
      }
      case "note": {
        var note = el("p", "blk blk-note" + (b.tone ? " tone-" + b.tone : ""), b.text);
        return note;
      }
      case "disclosure": {
        var dis = el("div", "blk blk-disclosure");
        dis.appendChild(el("span", "disclosure-title", b.title));
        dis.appendChild(el("span", "disclosure-caret", "⌄"));
        return dis;
      }
      case "toggle": {
        var tg = el("div", "blk blk-toggle" + (b.checked ? " checked" : ""));
        var tgBody = el("div", "toggle-body");
        tgBody.appendChild(el("div", "toggle-title", b.title));
        if (b.desc) tgBody.appendChild(el("div", "toggle-desc", b.desc));
        tg.appendChild(tgBody);
        tg.appendChild(el("span", "toggle-switch"));
        return tg;
      }
      case "buttons": {
        var btns = el("div", "blk blk-buttons");
        b.items.forEach(function (it) {
          var cls = it.kind === "ghost" ? "btn-ghost-screen" : "btn-primary-screen";
          if (it.shame) cls += " shame";
          var btn = el("button", cls, it.text);
          btns.appendChild(btn);
        });
        return btns;
      }
      default:
        return el("div", "blk");
    }
  }

  // Экран кейса внутри телефона
  function renderCaseScreen(screenData) {
    var frag = document.createDocumentFragment();
    frag.appendChild(appHeader(screenData));

    var body = el("div", "app-body");
    var ctaBlocks = [];
    screenData.blocks.forEach(function (b) {
      if (b.t === "cta") {
        ctaBlocks.push(b);
      } else {
        body.appendChild(renderBlock(b));
      }
    });
    frag.appendChild(body);

    if (ctaBlocks.length) {
      var cta = el("div", "app-cta");
      var btn = el("button", "btn-screen", ctaBlocks[0].text);
      cta.appendChild(btn);
      frag.appendChild(cta);
    }

    return frag;
  }

  // Десктоп: кейс как лендинг/страница в браузере
  function desktopFrame(screenData, tint) {
    var wrap = el("div", "desktop-wrap");
    var browser = el("div", "browser" + (tint ? " tint-" + tint : ""));

    var bar = el("div", "browser-bar");
    bar.appendChild(el("span", "dot dot-r"));
    bar.appendChild(el("span", "dot dot-y"));
    bar.appendChild(el("span", "dot dot-g"));
    bar.appendChild(el("span", "browser-url", screenData.url || ((screenData.app || "site") + ".ru")));
    browser.appendChild(bar);

    var body = el("div", "browser-body");
    var head = el("div", "browser-header");
    head.appendChild(el("div", "browser-app", screenData.app || ""));
    head.appendChild(el("div", "browser-title", screenData.header.title));
    if (screenData.header.subtitle) {
      head.appendChild(el("div", "browser-subtitle", screenData.header.subtitle));
    }
    body.appendChild(head);

    var ctaBlocks = [];
    screenData.blocks.forEach(function (b) {
      if (b.t === "cta") {
        ctaBlocks.push(b);
      } else {
        body.appendChild(renderBlock(b));
      }
    });
    browser.appendChild(body);

    if (ctaBlocks.length) {
      var cta = el("div", "browser-cta");
      var btn = el("button", "btn-browser", ctaBlocks[0].text);
      cta.appendChild(btn);
      browser.appendChild(cta);
    }

    wrap.appendChild(browser);
    return wrap;
  }

  // Форматы кейсов: пуш, баннер, сторис, лендинг — рисуем внутри телефона
  // иконка приложения (скруглённый квадрат с эмодзи)
  function appIcon(icon) {
    var i = el("span", "app-icon");
    i.textContent = icon || "✦";
    return i;
  }

  // иллюстрация (цветной блок с эмодзи)
  function illust(icon, size) {
    var d = el("div", "illust" + (size ? " size-" + size : ""));
    if (icon === "💰") {
      d.classList.add("illust-account");
      d.setAttribute("aria-hidden", "true");
      var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 160 120");
      svg.setAttribute("focusable", "false");
      svg.innerHTML = '<ellipse cx="80" cy="106" rx="55" ry="6" fill="#9e88cb" opacity=".16"/>' +
        '<rect x="52" y="15" width="71" height="83" rx="12" fill="#c4b5ec" transform="rotate(8 88 56)"/>' +
        '<rect x="27" y="24" width="94" height="74" rx="14" fill="#fff" stroke="#c8b9e7" stroke-width="1.5"/>' +
        '<rect x="39" y="40" width="31" height="5" rx="2.5" fill="#9580bc"/>' +
        '<rect x="39" y="54" width="51" height="4" rx="2" fill="#ded5ed"/>' +
        '<rect x="39" y="65" width="39" height="4" rx="2" fill="#ded5ed"/>' +
        '<circle cx="111" cy="81" r="24" fill="#8b72be" stroke="#e9e1f8" stroke-width="3"/>' +
        '<text x="111" y="91" text-anchor="middle" font-family="Inter, sans-serif" font-size="28" font-weight="600" fill="#fff">₽</text>';
      d.appendChild(svg);
    } else {
      d.textContent = icon || "✦";
    }
    return d;
  }

  function getCta(sd) {
    return sd.cta || null;
  }

  // короткая подпись формата (первый абзац)
  function subText(sd) {
    if (sd.paragraphs && sd.paragraphs.length) return sd.paragraphs[0];
    if (sd.stories && sd.stories.length) return sd.stories[sd.stories.length - 1];
    return null;
  }

  function pushScreen(sd) {
    var screen = el("div", "fmt-screen fmt-screen-push");
    screen.appendChild(el("div", "push-stack"));
    var notif = el("div", "push-notif");
    notif.appendChild(el("div", "push-grabber"));
    var head = el("div", "push-head");
    var iconWrap = el("div", "push-icon");
    iconWrap.appendChild(appIcon(sd.icon));
    head.appendChild(iconWrap);
    var col = el("div", "push-app-col");
    col.appendChild(el("div", "push-app", sd.app || ""));
    col.appendChild(el("div", "push-time", "сейчас"));
    head.appendChild(col);
    notif.appendChild(head);
    notif.appendChild(el("div", "push-title", sd.header.title));
    var sub = subText(sd);
    if (sub) notif.appendChild(el("div", "push-line", sub));
    screen.appendChild(notif);
    return screen;
  }

  function bannerScreen(sd) {
    var screen = el("div", "fmt-screen fmt-screen-banner");
    var card = el("div", "banner-card");
    card.appendChild(el("span", "banner-close", "×"));
    var vis = el("div", "banner-vis");
    vis.appendChild(el("div", "banner-emoji", sd.icon));
    card.appendChild(vis);
    var brand = el("div", "banner-brand");
    brand.appendChild(appIcon(sd.icon));
    brand.appendChild(el("span", "banner-brand-name", sd.app || ""));
    card.appendChild(brand);
    card.appendChild(el("div", "banner-headline", sd.header.title));
    var body = el("div", "banner-body");
    (sd.paragraphs || []).forEach(function (p) {
      body.appendChild(el("div", "banner-line", p));
    });
    if (body.childNodes.length) card.appendChild(body);
    var cta = getCta(sd);
    if (cta) card.appendChild(el("button", "btn-banner", cta));
    screen.appendChild(card);
    return screen;
  }

  function storyScreen(sd) {
    var screen = el("div", "fmt-screen fmt-screen-story");

    // серия сторис: бренд+иконка вверху, кадры — номер и текст
    if (sd.stories && sd.stories.length) {
      var total = sd.stories.length;
      var series = el("div", "story-series");

      var brand = el("div", "story-series-head");
      var ring = el("span", "story-ring");
      ring.appendChild(el("span", "story-avatar", sd.icon || "✦"));
      brand.appendChild(ring);
      brand.appendChild(el("div", "story-series-user", sd.app || ""));
      series.appendChild(brand);

      var list = el("div", "story-list");
      sd.stories.forEach(function (s, i) {
        var frame = el("div", "story-frame");
        var num = el("div", "story-num", (i + 1) + " из " + total);
        frame.appendChild(num);
        var text = el("div", "story-frame-text", s);
        frame.appendChild(text);
        if (i === total - 1 && sd.cta) {
          var btn = el("button", "btn-story", sd.cta);
          frame.appendChild(btn);
        }
        list.appendChild(frame);
      });
      series.appendChild(list);
      screen.appendChild(series);
      return screen;
    }

    var prog = el("div", "story-progress");
    for (var i = 0; i < 4; i++) prog.appendChild(el("span", i === 0 ? "on" : (i === 1 ? "half" : "")));
    screen.appendChild(prog);

    var head = el("div", "story-head");
    var ring = el("span", "story-ring");
    ring.appendChild(el("span", "story-avatar", sd.icon || "✦"));
    head.appendChild(ring);
    var col = el("div", "story-id");
    col.appendChild(el("div", "story-user", sd.app || ""));
    col.appendChild(el("div", "story-time", "сейчас"));
    head.appendChild(col);
    head.appendChild(el("span", "story-more", "⋯"));
    head.appendChild(el("span", "story-close", "×"));
    screen.appendChild(head);

    var offerTitle = null, offerText = null;
    (sd.blocks || []).forEach(function (b) {
      if (b.t === "offer" && b.title && !offerTitle) offerTitle = b.title;
      if (b.t === "offer" && b.text && !offerText) offerText = b.text;
    });

    var vis = el("div", "story-main");
    vis.appendChild(el("div", "story-emoji", sd.icon));
    vis.appendChild(el("div", "story-headline", offerTitle || sd.header.title));
    var text = offerText || (sd.paragraphs ? sd.paragraphs.join(" ") : null) || subText(sd);
    if (text) vis.appendChild(el("div", "story-text", text));
    screen.appendChild(vis);

    var bottom = el("div", "story-bottom");
    bottom.appendChild(el("div", "story-reply", "Ответить"));
    bottom.appendChild(el("span", "story-send", "➤"));
    screen.appendChild(bottom);
    return screen;
  }

  function landingScreen(sd) {
    var screen = el("div", "fmt-screen fmt-screen-landing");

    var bar = el("div", "landing-bar");
    bar.appendChild(el("span", "landing-back", "‹"));
    bar.appendChild(el("span", "landing-bar-title", sd.app || ""));
    bar.appendChild(el("span", "landing-share", "⋯"));
    screen.appendChild(bar);

    var page = el("div", "landing-page");
    var hero = el("div", "landing-hero");
    hero.appendChild(illust(sd.icon, "lg"));
    page.appendChild(hero);

    page.appendChild(el("h2", "landing-title", sd.header.title));

    (sd.paragraphs || []).forEach(function (p) {
      page.appendChild(el("div", "landing-p", p));
    });

    if (sd.cards && sd.cards.length) {
      var cardsWrap = el("div", "landing-cards");
      sd.cards.forEach(function (c) {
        var cardEl = el("div", "tariff-card");
        cardEl.appendChild(el("div", "tariff-title", c.title));
        cardEl.appendChild(el("div", "tariff-text", c.text));
        cardsWrap.appendChild(cardEl);
      });
      page.appendChild(cardsWrap);
    }

    var cta = getCta(sd);
    screen.appendChild(page);

    if (cta) {
      var ctaBox = el("div", "landing-cta");
      ctaBox.appendChild(el("button", "btn-landing", cta));
      screen.appendChild(ctaBox);
    }
    return screen;
  }

  // ОФФЕР — карточка спецпредложения
  function offerScreen(sd) {
    var screen = el("div", "fmt-screen fmt-screen-offer");
    var card = el("div", "offer-card");
    var tag = null;
    sd.blocks.forEach(function (b) { if (b.t === "offer" && b.tag) tag = b.tag; });
    card.appendChild(el("span", "offer-badge", tag || "Специальное предложение"));
    card.appendChild(el("div", "offer-headline", sd.header.title));
    var sub = subText(sd);
    if (sub) card.appendChild(el("div", "offer-line", sub));
    var cta = getCta(sd);
    if (cta) card.appendChild(el("button", "btn-offer", cta));
    screen.appendChild(card);
    return screen;
  }

  // НОТИФИКАЦИЯ — системное уведомление
  function notificationScreen(sd) {
    var screen = el("div", "fmt-screen fmt-screen-notif");
    var card = el("div", "notif-card");
    var head = el("div", "notif-head");
    head.appendChild(appIcon(sd.icon));
    var col = el("div", "notif-app-col");
    col.appendChild(el("div", "notif-app", sd.app || ""));
    col.appendChild(el("div", "notif-time", "сейчас"));
    head.appendChild(col);
    card.appendChild(head);
    card.appendChild(el("div", "notif-title", sd.header.title));
    var sub = subText(sd);
    if (sub) card.appendChild(el("div", "notif-line", sub));
    var cta = getCta(sd);
    var actions = el("div", "notif-actions");
    actions.appendChild(el("button", "notif-btn", cta || "Открыть"));
    actions.appendChild(el("button", "notif-btn ghost", "Позже"));
    card.appendChild(actions);
    screen.appendChild(card);
    return screen;
  }

  // ПИСЬМО — открытое письмо: отправитель, тема, текст с абзацами, кнопка
  function messageScreen(sd) {
    var screen = el("div", "fmt-screen fmt-screen-msg");
    var card = el("div", "msg-card");
    var top = el("div", "msg-top");
    top.appendChild(el("span", "msg-from-label", "От:"));
    top.appendChild(el("span", "msg-sender", sd.app || "Сервис"));
    card.appendChild(top);
    card.appendChild(el("div", "msg-subject", sd.header.title));
    var body = el("div", "msg-body");
    (sd.paragraphs || []).forEach(function (p) {
      body.appendChild(el("div", "msg-line", p));
    });
    if (body.childNodes.length) card.appendChild(body);
    var cta = getCta(sd);
    if (cta) {
      var ctaRow = el("div", "msg-cta-row");
      ctaRow.appendChild(el("button", "btn-msg", cta));
      card.appendChild(ctaRow);
    }
    screen.appendChild(card);
    return screen;
  }

  function formatLabel(f) {
    return ({ push: "Пуш", banner: "Баннер", story: "Сторис", landing: "Лендинг", offer: "Оффер", notification: "Нотификация", message: "Сообщение" })[f] || "Формат";
  }

  // собираем текст формата из блоков кейса (всегда как текст, без UI-элементов)
  function collectText(sd) {
    var lines = [];
    (sd.paragraphs || []).forEach(function (p) { lines.push(p); });
    if (sd.cards) {
      sd.cards.forEach(function (c) { lines.push(c.title + " — " + c.text); });
    }
    if (sd.stories) {
      sd.stories.forEach(function (s, i) { lines.push("Сторис " + (i + 1) + ": " + s); });
    }
    return lines;
  }

  // формат-лист: как текст, который пишет продуктовый редактор
  function formatSheet(format, sd) {
    var wrap = el("div", "sheet-wrap");
    var card = el("div", "sheet-card" + (sd.tint ? " tint-" + sd.tint : ""));

    var chip = el("div", "sheet-chip");
    chip.appendChild(el("span", "sheet-fmt", formatLabel(format)));
    if (sd.app) chip.appendChild(el("span", "sheet-app", sd.app));
    card.appendChild(chip);

    var body = el("div", "sheet-body");

    body.appendChild(el("div", "sheet-headline", sd.header.title));

    if (sd.header.subtitle) body.appendChild(el("div", "sheet-sub", sd.header.subtitle));

    var textLines = collectText(sd);
    if (textLines.length) {
      var txt = el("div", "sheet-text");
      textLines.forEach(function (ln) { txt.appendChild(el("div", "sheet-line", ln)); });
      body.appendChild(txt);
    }

    var cta = sd.cta || null;
    if (cta) {
      var ctaRow = el("div", "sheet-cta");
      ctaRow.appendChild(el("span", "sheet-cta-label", "Кнопка"));
      ctaRow.appendChild(el("span", "sheet-cta-text", cta));
      body.appendChild(ctaRow);
    }

    card.appendChild(body);
    wrap.appendChild(card);
    return wrap;
  }

  function renderFormatScreen(format, sd, staticScreen) {
    var screen = buildFormatScreen(format, sd);
    if (!staticScreen) attachPhoneTaps(screen, sd);
    return screen;
  }

  function buildFormatScreen(format, sd) {
    if (format === "push") return pushScreen(sd);
    if (format === "banner") return bannerScreen(sd);
    if (format === "story") return storyScreen(sd);
    if (format === "offer") return offerScreen(sd);
    if (format === "notification") return notificationScreen(sd);
    if (format === "message") return messageScreen(sd);
    return landingScreen(sd);
  }

  // Элементы на телефоне реагируют на тап: появляется попап, как ответ приложения
  function attachPhoneTaps(screen, sd) {
    var tappable = screen.querySelectorAll("button, .msg-cta, .push-notif, .banner-card");
    Array.prototype.forEach.call(tappable, function (b) {
      b.addEventListener("click", function (ev) {
        ev.stopPropagation();
        showPhonePopup(screen, b.textContent, sd);
      });
    });
  }

  function showPhonePopup(screen, action, sd) {
    var popup = el("div", "phone-popup");
    var card = el("div", "phone-popup-card");

    // 1) фаза загрузки
    var loading = el("div", "phone-popup-loading");
    loading.appendChild(el("span", "phone-spinner"));
    loading.appendChild(el("div", "phone-popup-loading-text", "Отправляем…"));
    card.appendChild(loading);
    popup.appendChild(card);
    screen.appendChild(popup);

    function close() { popup.remove(); }

    // 2) через мгновение — подтверждение
    setTimeout(function () {
      card.innerHTML = "";
      var success = el("div", "phone-popup-success");
      success.appendChild(el("div", "phone-popup-check", "✓"));
      success.appendChild(el("div", "phone-popup-title", (sd.popup && sd.popup.title) || "Готово"));
      if (sd.popup && sd.popup.text) success.appendChild(el("div", "phone-popup-text", sd.popup.text));
      success.appendChild(el("button", "phone-popup-ok", "Понятно"));
      card.appendChild(success);
      card.appendChild(el("span", "phone-popup-close", "×"));
      card.querySelector(".phone-popup-ok").addEventListener("click", close);
      card.querySelector(".phone-popup-close").addEventListener("click", close);
      card.querySelector(".phone-popup-check").classList.add("show");
    }, 650);

    popup.addEventListener("click", function (e) {
      if (e.target === popup) close();
    });
  }

  // Кейс рисуем внутри телефона, а внутри — нужный формат
  function caseFrame(screenData) {
    var format = screenData.format || "landing";
    var dark = format === "story";
    return phoneFrame(renderFormatScreen(format, screenData), dark, screenData.tint);
  }

  // ============================================================================
  // 1. Интро
  // ============================================================================
  function renderIntro() {
    state.currentCaseId = null;
    var wrap = el("div", "screen layout");

    // Обложка внутри телефона (статичная, без кнопок)
    var cover = el("div", "intro-screen cover");
    cover.appendChild(el("h1", "cover-title", "Смотрим на текст глазами клиента"));
    var cards = el("div", "cover-cards");
    cards.appendChild(coverCard("Пуш-уведомление", "off1"));
    cards.appendChild(coverCard("Письмо", "off2"));
    cards.appendChild(coverCard("Баннер", "off3"));
    cover.appendChild(cards);
    cover.appendChild(el("div", "cover-hint", "В заданиях можно нажимать кнопки и смотреть, что происходит дальше"));

    var left = el("div", "intro-phone");
    left.appendChild(phoneFrame(cover, false));
    wrap.appendChild(left);

    // Правая колонка: вводная
    var panel = el("div", "panel intro-panel");
    panel.appendChild(el("h1", "intro-heading", "Дарк-паттерны в тексте"));
    panel.appendChild(el("p", "intro-lead", "Потренируйтесь замечать выдуманные факты, давление и неоднозначные обещания в сообщениях для клиентов. Сравнивайте текст с условиями продукта и проверяйте, что из него может понять клиент"));

    // Светло-сиреневый блок «Как устроен тренажер»
    var howBlock = el("div", "intro-how");
    howBlock.appendChild(el("div", "intro-how-title", "Как оценить текст"));
    howBlock.appendChild(el("p", "intro-how-caption", "Нажмите на название категории, чтобы прочитать пояснение"));

    // Три раскрытия
    var evalWrap = el("div", "eval-list");
    evalWrap.appendChild(evalItem("Дарк-паттерн", "Дарк-паттерны — приемы в интерфейсах и текстах, которые подталкивают человека к действиям, выгодным компании, но нежелательным для него\n\nВ этом тренажере к дарк-паттернам относятся тексты с выдуманными фактами или обещаниями, которые противоречат условиям продукта", "dp"));
    evalWrap.appendChild(evalItem("Манипуляция или неоднозначная подача", "Текст относится к этой категории, если он:\n— давит на чувство вины или самооценку\n— показывает только выгодную сторону сравнения\n— намекает на результат без подтверждения\n— дает обещание без важного уточнения\n\nНеоднозначная фраза еще не значит, что клиентом намеренно манипулируют. В разборе покажем, в чем именно проблема", "man"));
    evalWrap.appendChild(evalItem("Текст без подвоха", "Текст совпадает с условиями продукта и раскрывает важные условия. Реальные сроки, лимиты и остатки мест сами по себе не делают текст дарк-паттерном", "ok"));
    howBlock.appendChild(evalWrap);
    panel.appendChild(howBlock);

    // Белый блок «Как проходить тренажер»
    var stepsBlock = el("div", "intro-steps");
    stepsBlock.appendChild(el("div", "intro-steps-title", "Как проходить тренажер"));
    stepsBlock.appendChild(introStep(1, "Сравните текст в телефоне с условиями продукта и ответьте на вопрос"));
    stepsBlock.appendChild(el("div", "intro-step-divider"));
    stepsBlock.appendChild(introStep(2, "После ответа покажем оценку текста и пояснение к ней, а при необходимости — исправленный вариант"));
    panel.appendChild(stepsBlock);

    // Подпись, счётчик, кнопка
    panel.appendChild(el("div", "intro-note", "Тексты и интерфейсы в заданиях учебные и не связаны с компанией"));

    // действия — зависят от сохранённого прогресса
    renderIntroActions(panel);

    wrap.appendChild(panel);

    // верхняя плашка обратной связи — над двухколоночной композицией
    var screen = el("div", "screen");
    var banner = buildFeedbackBanner();
    if (banner) screen.appendChild(banner);
    screen.appendChild(wrap);
    render(screen);
  }

  function renderIntroActions(panel) {
    var actions = el("div", "panel-actions");
    var prog = restoreProgress();

    if (prog.status === 2) {
      // контент обновился — сохранение несовместимо
      var note = el("div", "intro-warn");
      note.appendChild(el("p", "intro-warn-text", "Контент тренажера обновился. Сохранённый прогресс несовместим — начните заново."));
      panel.appendChild(note);
      actions.appendChild(btnPrimary("Начать заново", startFresh));
      panel.appendChild(actions);
      return;
    }

    if (prog.status === 1 && state.finishedResult) {
      // завершённая тренировка — возврат к результатам
      actions.appendChild(btnPrimary("К результатам", renderResults));
      actions.appendChild(btnGhost("Начать заново", startFresh));
      panel.appendChild(actions);
      panel.appendChild(el("div", "intro-count", "Результат: " + state.finishedResult.correct + " из " + state.finishedResult.total));
      return;
    }

    if (prog.status === 1) {
      // незавершённая тренировка — продолжить
      actions.appendChild(btnPrimary("Продолжить", continueTraining));
      actions.appendChild(btnGhost("Начать заново", startFresh));
      panel.appendChild(actions);
      panel.appendChild(el("div", "intro-count", "Выполнено " + state.answers.length + " из " + CASES.length));
      return;
    }

    // новый старт
    actions.appendChild(btnPrimary("Начать тренировку", startFresh));
    panel.appendChild(actions);
    panel.appendChild(el("div", "intro-count", CASES.length + " заданий"));
  }

  function btnPrimary(label, handler) {
    var b = el("button", "btn btn-primary", label);
    b.addEventListener("click", handler);
    return b;
  }
  function btnGhost(label, handler) {
    var b = el("button", "btn btn-ghost", label);
    b.addEventListener("click", handler);
    return b;
  }

  function introStep(num, text) {
    var row = el("div", "intro-step");
    row.appendChild(el("span", "intro-step-num", String(num)));
    row.appendChild(el("span", "intro-step-text", text));
    return row;
  }

  function evalItem(title, text, kind) {
    var item = el("div", "eval-item" + (kind ? " eval-" + kind : ""));
    var head = el("button", "eval-head");
    head.setAttribute("type", "button");
    var ico = el("span", "eval-ico");
    ico.innerHTML = ICONS[kind === "dp" ? "alert" : (kind === "man" ? "flag" : "check")];
    var titleEl = el("div", "eval-title", title);
    var caret = el("span", "eval-caret", "▾");
    head.appendChild(ico);
    head.appendChild(titleEl);
    head.appendChild(caret);
    var body = el("div", "eval-body");
    var lines = String(text).split("\n");
    lines.forEach(function (line, i) {
      var isBullet = /^\s*—/.test(line);
      var el2 = el("div", isBullet ? "eval-line bullet" : "eval-line");
      el2.textContent = line.trim();
      if (isBullet) el2.classList.add("eval-bullet");
      body.appendChild(el2);
    });
    body.style.display = "none";
    item.appendChild(head);
    item.appendChild(body);
    head.addEventListener("click", function () {
      var open = body.style.display !== "none";
      body.style.display = open ? "none" : "block";
      item.classList.toggle("open", !open);
    });
    return item;
  }

  function coverCard(label, cls) {
    var c = el("div", "cover-card " + cls);
    c.appendChild(el("div", "cover-card-label", label));
    var lines = el("div", "cover-card-lines");
    lines.appendChild(el("span", "cover-line w"));
    lines.appendChild(el("span", "cover-line m"));
    lines.appendChild(el("span", "cover-line s"));
    c.appendChild(lines);
    return c;
  }

  var ICONS = {
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
    flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4"/><path d="M4 4h12l-2 4 2 4H4"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4"/><path d="M10 12h5"/><path d="M10 16h5"/></svg>',
    pick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>',
    com: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H9.5L5 19v-3H4z"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>'
  };

  function reviewItem(title, hint) {
    var item = el("div", "review-item");
    item.appendChild(el("div", "review-name", title));
    item.appendChild(el("div", "review-hint", hint));
    return item;
  }

  // короткая «выжимка» разбора для списка результатов
  function breakdownTakeaway(b) {
    if (b.fix) return b.fix;
    if (b.ok) return b.ok;
    return "";
  }

  // ============================================================================
  // 2. Квиз
  // ============================================================================

  // верхняя навигация: «На главную» и «← Назад» (если есть предыдущий кейс)
  function buildTopNav() {
    var row = el("div", "quiz-nav");
    if (activeIndex() > 0) {
      var back = el("button", "btn-nav", "← Назад");
      back.addEventListener("click", function () {
        goToIndex(activeIndex() - 1);
        if (state.mode === "training") saveProgress();
      });
      row.appendChild(back);
    }
    var home = el("button", "btn-nav home", "На главную");
    home.addEventListener("click", goHome);
    row.appendChild(home);
    return row;
  }

  // перейти к кейсу: решённый — открываем сохранённый разбор, нерешённый — задание
  function goToIndex(i) {
    setActiveIndex(i);
    var cases = activeCases();
    if (i >= cases.length) {
      if (state.mode === "review") renderReviewResult();
      else finishTraining();
      return;
    }
    var c = cases[i];
    var saved = getAnswerForCase(c.id);
    if (saved) {
      state.currentSelected = saved.selectedIndex;
      state.answeredCurrent = true;
      renderQuiz();
      renderAnswerView(c, saved.selectedIndex);
    } else {
      state.currentSelected = -1;
      state.answeredCurrent = false;
      renderQuiz();
    }
  }

  function getAnswerForCase(caseId) {
    var arr = activeAnswers();
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].caseId === caseId) return arr[i];
    }
    return null;
  }

  function renderQuiz() {
    var cases = activeCases();
    var idx = activeIndex();
    if (idx >= cases.length) {
      if (state.mode === "review") { renderReviewResult(); }
      else { finishTraining(); }
      return;
    }

    track("case_view", { index: idx + 1, mode: state.mode });
    var c = cases[idx];
    state.currentCaseId = c.id;
    var wrap = el("div", "screen layout");

    // телефон с предложением
    var phoneCol = el("div", "case-phone");
    phoneCol.appendChild(caseFrame(c.screen));
    wrap.appendChild(phoneCol);

    // панель с заданием
    var panel = el("div", "panel");
    panel.appendChild(buildTopNav());
    panel.appendChild(buildProgress(idx, cases.length, state.mode === "review"));

    if (c.context) {
      var ctx = el("div", "case-context");
      ctx.appendChild(el("div", "case-context-label", "Условия задания"));
      ctx.appendChild(el("div", "case-context-text", c.context));
      panel.appendChild(ctx);
    }

    panel.appendChild(el("h3", "panel-question", c.question || DEFAULT_QUESTION));

    var optionsWrap = el("div", "options");
    c.options.forEach(function (opt, i) {
      var label = el("button", "option");
      label.setAttribute("data-idx", String(i));
      label.appendChild(el("span", "option-key", String.fromCharCode(65 + i)));
      label.appendChild(el("span", "option-text", opt.text));
      label.addEventListener("click", function () {
        if (state.currentSelected !== -1) return;
        selectOption(c, i);
      });
      optionsWrap.appendChild(label);
    });
    panel.appendChild(optionsWrap);

    wrap.appendChild(panel);
    render(wrap);
  }

  function selectOption(c, idx) {
    state.currentSelected = idx;
    state.answeredCurrent = true;
    // на случай повторного ответа после «Назад» — на кейс приходится ровно один ответ
    var arr = activeAnswers().filter(function (a) { return a.caseId !== c.id; });
    arr.push({ caseId: c.id, selectedIndex: idx, correct: c.options[idx].isCorrect });
    if (state.mode === "review") state.reviewAnswers = arr; else state.answers = arr;
    if (state.mode === "training") saveProgress();
    track(c.options[idx].isCorrect ? "answer_correct" : "answer_wrong",
      { caseId: c.id, index: activeIndex() + 1, mode: state.mode });
    renderAnswerView(c, idx);
  }

  // Экран разбора после ответа (заменяет правую панель)
  function renderAnswerView(c, idx) {
    var panel = document.querySelector(".panel");
    var phoneCol = document.querySelector(".case-phone");
    if (!panel) { renderQuiz(); return; }
    panel.innerHTML = "";

    var chosen = c.options[idx];
    var correctOpt = null;
    c.options.forEach(function (o) { if (o.isCorrect) correctOpt = o; });
    var correct = chosen.isCorrect;

    // 1. навигация и прогресс
    panel.appendChild(buildTopNav());
    panel.appendChild(buildProgress(activeIndex(), activeCases().length, state.mode === "review"));

    // 2. результат ответа
    panel.appendChild(resultOfAnswer(correct, chosen, correctOpt));

    // 3. разбор
    panel.appendChild(messageEvaluation(c));

    // 4. кнопка «Посмотреть исправленный текст» — согласована с переключателем над телефоном
    var hasExample = !!(c.breakdown && c.breakdown.example);
    var viewMode = "source";
    var viewBtn = null;

    function setViewMode(m) {
      viewMode = m;
      renderAnswerPhone(phoneCol, c, m, setViewMode);
      if (viewBtn) {
        viewBtn.textContent = m === "fixed" ? "Посмотреть, как было" : "Посмотреть исправленный текст";
      }
    }

    if (hasExample) {
      viewBtn = el("button", "btn-view", "Посмотреть исправленный текст");
      viewBtn.setAttribute("type", "button");
      viewBtn.addEventListener("click", function () {
        var next = viewMode === "fixed" ? "source" : "fixed";
        setViewMode(next);
        if (next === "fixed") scrollPhoneIntoView(phoneCol);
      });
      panel.appendChild(viewBtn);
    }

    // 5. кнопка перехода
    var isLast = activeIndex() === activeCases().length - 1;
    var nextLabel;
    if (state.mode === "review") nextLabel = isLast ? "Показать итог повторения" : "Следующий кейс";
    else nextLabel = isLast ? "Показать результаты" : "Следующий кейс";
    var next = el("button", "btn btn-primary", nextLabel);
    next.addEventListener("click", function () {
      goToIndex(activeIndex() + 1);
      if (state.mode === "training") saveProgress();
    });
    var nextWrap = el("div", "panel-next");
    nextWrap.appendChild(next);
    panel.appendChild(nextWrap);

    // телефон: переключатель «Было/Стало» над ним, по умолчанию «Было»
    renderAnswerPhone(phoneCol, c, "source", setViewMode);

    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function scrollPhoneIntoView(phoneCol) {
    if (!phoneCol) return;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    phoneCol.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  // телефон разбора: переключатель «Было/Стало» над ним + пример в том же формате
  function renderAnswerPhone(phoneCol, c, mode, onToggle) {
    if (!phoneCol) return;
    phoneCol.innerHTML = "";
    var showFixed = mode === "fixed";
    var sd = showFixed ? c.breakdown.example : c.screen;
    var fmt = sd.format || c.screen.format || "landing";
    var frame = caseFrame(sd);
    phoneCol.appendChild(frame);
    // переключатель «Было / Стало» — под телефоном, в той же колонке
    if (c.breakdown && c.breakdown.example) {
      phoneCol.appendChild(buildSourceToggle(c, mode, function (m) {
        if (onToggle) onToggle(m);
      }));
    }
  }

  // переключатель «Было / Стало» — только если есть исправленный пример
  function buildSourceToggle(c, activeMode, onToggle) {
    var bar = el("div", "src-toggle");
    if (!(c.breakdown && c.breakdown.example)) return bar;
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Сравнить, как было и как стало");
    bar.appendChild(toggleSeg("Было", "source", activeMode !== "fixed", onToggle));
    bar.appendChild(toggleSeg("Стало", "fixed", activeMode === "fixed", onToggle));
    return bar;
  }

  function toggleSeg(label, mode, active, onToggle) {
    var b = el("button", "seg" + (active ? " seg-active" : ""));
    b.setAttribute("type", "button");
    b.textContent = label;
    b.setAttribute("aria-pressed", active ? "true" : "false");
    b.addEventListener("click", function () {
      var segs = b.parentNode.querySelectorAll(".seg");
      segs.forEach(function (s) {
        s.classList.remove("seg-active");
        s.setAttribute("aria-pressed", "false");
      });
      b.classList.add("seg-active");
      b.setAttribute("aria-pressed", "true");
      onToggle(mode);
    });
    return b;
  }

  // результат: подпись «Ваш ответ» + спокойный статус + блок ответов
  function resultOfAnswer(correct, chosen, correctOpt) {
    var frag = document.createDocumentFragment();
    var box = el("div", "result-block");
    box.appendChild(el("div", "result-caption", "Ваш ответ"));
    box.appendChild(el("div", "verdict-line " + (correct ? "vd-correct" : "vd-wrong"), correct ? "Верно" : "Не совсем"));
    var zone = el("div", "answers-zone");
    if (correct) {
      zone.appendChild(el("div", "chosen-text", chosen.text));
    } else {
      var list = el("div", "answers-plain");
      list.appendChild(ansItem("Вы выбрали", chosen.text, "secondary"));
      list.appendChild(ansItem("Верный ответ", correctOpt.text, "primary"));
      zone.appendChild(list);
    }
    box.appendChild(zone);
    frag.appendChild(box);
    return frag;
  }

  function ansItem(caption, text, kind) {
    var row = el("div", "ans-row " + kind);
    row.appendChild(el("div", "ans-caption", caption));
    row.appendChild(el("div", "ans-text", text));
    return row;
  }

  // разбор: «Что не так» / «Почему здесь нет подвоха»
  function messageEvaluation(c) {
    var frag = document.createDocumentFragment();
    var b = c.breakdown || {};
    var isOk = !!b.ok;
    var card = el("div", "explain-card");
    var head = el("div", "explain-head");
    head.appendChild(el("div", "explain-title", isOk ? "Почему здесь нет подвоха" : "Что не так"));
    if (c.type) head.appendChild(el("span", "explain-cat", c.type));
    card.appendChild(head);
    card.appendChild(el("p", "explain-text", isOk ? b.ok : b.problem));
    frag.appendChild(card);
    // для ок-кейсов дополнительно блок «Что важно сохранить»
    if (isOk && b.keep) {
      var keepCard = el("div", "keep-card");
      keepCard.appendChild(el("div", "keep-title", "Что важно сохранить"));
      keepCard.appendChild(el("p", "keep-text", b.keep));
      frag.appendChild(keepCard);
    }
    return frag;
  }

  // финал тренировки: фиксируем результат и сохраняем прогресс
  function finishTraining() {
    state.mode = "training";
    var total = CASES.length;
    var correct = correctCount();
    state.finishedResult = { correct: correct, total: total, pct: Math.round(correct / total * 100) };
    saveProgress();
    renderResults();
  }

  // продолжить незавершённую тренировку
  function continueTraining() {
    goToIndex(state.index);
  }

  function buildProgress(index, total, isReview) {
    var progressRow = el("div", "progress-row");
    var progressTop = el("div", "progress-top");
    progressTop.appendChild(el("span", "", (isReview ? "Повторение " : "Кейс ") + (index + 1) + " из " + total));
    progressRow.appendChild(progressTop);
    var track = el("div", "progress-track");
    var fill = el("div", "progress-fill");
    fill.style.width = (index / total * 100) + "%";
    track.appendChild(fill);
    progressRow.appendChild(track);
    return progressRow;
  }

  function buildBreakdown(c) {
    var wrap = el("div", "breakdown-wrap");
    var titleRow = el("div", "breakdown-head");
    titleRow.appendChild(el("div", "breakdown-title", "Разбираем текст"));
    if (c.type) titleRow.appendChild(el("span", "breakdown-type", c.type));
    wrap.appendChild(titleRow);

    var block = el("div", "breakdown-block");
    var b = c.breakdown;

    if (b.ok) {
      // текст без подвоха: одна карточка «почему текст можно оставить»
      var card = el("div", "bs-card bs-green");
      card.appendChild(el("div", "bs-label", "Почему текст можно оставить"));
      card.appendChild(el("p", "bs-text", b.ok));
      block.appendChild(card);
      // дополнительный блок «Что важно сохранить»
      if (b.keep) {
        var keepCard = el("div", "bs-card bs-keep");
        keepCard.appendChild(el("div", "bs-label", "Что важно сохранить"));
        keepCard.appendChild(el("p", "bs-text", b.keep));
        block.appendChild(keepCard);
      }
    } else {
      // 1. В чем проблема
      var pCard = el("div", "bs-card bs-lav");
      pCard.appendChild(el("div", "bs-label", "В чем проблема"));
      pCard.appendChild(el("p", "bs-text", b.problem));
      block.appendChild(pCard);

      // 2. Как исправить — рекомендация + исправленный пример в стиле формата
      var fCard = el("div", "bs-card bs-green");
      fCard.appendChild(el("div", "bs-label", "Как исправить"));
      if (b.fix) fCard.appendChild(el("p", "bs-text", b.fix));
      if (b.example) {
        var exLabel = el("div", "bs-example-label", "Исправленный пример");
        fCard.appendChild(exLabel);
        fCard.appendChild(buildExamplePreview(b.example));
      }
      block.appendChild(fCard);
    }

    wrap.appendChild(block);
    return wrap;
  }

  // исправленный пример: визуальное оформление исходного формата, без кнопки
  function buildExamplePreview(ex) {
    var wrap = el("div", "ex-preview ex-preview-" + (ex.format || "landing"));
    var fmt = formatLabel(ex.format);
    if (fmt) wrap.appendChild(el("div", "ex-format", fmt));

    if (ex.stories && ex.stories.length) {
      var total = ex.stories.length;
      ex.stories.forEach(function (s, i) {
        var frame = el("div", "ex-story");
        if (total > 1) frame.appendChild(el("div", "ex-story-num", "Сторис " + (i + 1) + " из " + total));
        frame.appendChild(el("div", "ex-story-text", s));
        wrap.appendChild(frame);
      });
    } else {
      if (ex.header && ex.header.title) wrap.appendChild(el("div", "ex-title", ex.header.title));
      (ex.paragraphs || []).forEach(function (p) {
        wrap.appendChild(el("p", "ex-p", p));
      });
      if (ex.cards) {
        var cards = el("div", "ex-cards");
        ex.cards.forEach(function (c) {
          var cardEl = el("div", "ex-card");
          cardEl.appendChild(el("div", "ex-card-title", c.title));
          cardEl.appendChild(el("div", "ex-card-text", c.text));
          cards.appendChild(cardEl);
        });
        wrap.appendChild(cards);
      }
      if (ex.cta) {
        wrap.appendChild(el("div", "ex-cta", ex.cta));
      }
    }
    return wrap;
  }

  // ============================================================================
  // 3. Результаты
  // ============================================================================
  function renderResults() {
    state.currentCaseId = null;
    var total = CASES.length;
    var correct = correctCount();
    var pct = Math.round(correct / total * 100);
    track("finish", { correct: correct, total: total, pct: pct });
    state.mode = "training";
    state.finishedResult = { correct: correct, total: total, pct: pct };
    saveProgress();

    var wrap = el("div", "screen");
    var panel = el("div", "results-panel");

    // верх: заголовок слева, число справа
    var top = el("div", "results-top");
    var left = el("div", "results-top-left");
    left.appendChild(el("h1", "results-title", resultsTitle(pct)));
    left.appendChild(el("p", "results-lead", resultsLead(pct)));
    top.appendChild(left);
    var score = el("div", "results-score");
    score.appendChild(el("span", "results-num", correct + " / " + total));
    score.appendChild(el("span", "results-pct", pct + "%"));
    top.appendChild(score);
    panel.appendChild(top);

    var wrong = state.answers.filter(function (a) { return !a.correct; });
    var actions = el("div", "results-actions");

    if (wrong.length > 0) {
      // основное действие — повторение ошибок
      var rep = el("button", "btn btn-primary btn-md", "Повторить ошибки (" + wrong.length + ")");
      rep.addEventListener("click", startReview);
      actions.appendChild(rep);
      var survey = el("button", "btn btn-ghost btn-md", "Оценить тренажер");
      survey.addEventListener("click", renderSurvey);
      actions.appendChild(survey);
    } else {
      var survey0 = el("button", "btn btn-primary btn-md", "Оценить тренажер");
      survey0.addEventListener("click", renderSurvey);
      actions.appendChild(survey0);
    }
    var restart = el("button", "btn btn-ghost btn-md", "Пройти заново");
    restart.addEventListener("click", startFresh);
    actions.appendChild(restart);
    panel.appendChild(actions);

    // кейсы с неверными ответами (открытие разбора)
    if (wrong.length > 0) {
      var listWrap = el("div", "mistakes-section");
      listWrap.appendChild(el("h2", "mistakes-title", "Задания для повторения"));
      var list = el("div", "mistakes-list");
      wrong.forEach(function (a) {
        var item = CASES.filter(function (c) { return c.id === a.caseId; })[0];
        if (item) list.appendChild(mistakeRow(item, a));
      });
      listWrap.appendChild(list);
      panel.appendChild(listWrap);
    }

    wrap.appendChild(panel);
    render(wrap);
  }

  // повторение ошибок: отдельный проход только по неверным кейсам
  function startReview() {
    var wrongIds = state.answers.filter(function (a) { return !a.correct; })
      .map(function (a) { return a.caseId; });
    state.mode = "review";
    state.reviewCases = CASES.filter(function (c) { return wrongIds.indexOf(c.id) >= 0; });
    state.reviewIndex = 0;
    state.reviewAnswers = [];
    state.currentSelected = -1;
    state.answeredCurrent = false;
    track("review_start", { count: state.reviewCases.length });
    renderQuiz();
  }

  function renderReviewResult() {
    state.currentCaseId = null;
    var total = state.reviewCases.length || 0;
    var correct = state.reviewAnswers.filter(function (a) { return a.correct; }).length;
    var pct = total ? Math.round(correct / total * 100) : 0;
    track("review_finish", { correct: correct, total: total });

    var wrap = el("div", "screen");
    var panel = el("div", "results-panel");

    var top = el("div", "results-top");
    var left = el("div", "results-top-left");
    left.appendChild(el("h1", "results-title", "Повторение ошибок"));
    left.appendChild(el("p", "results-lead", "Вы прошли повторение по ошибочным кейсам. Оценка основного прохождения сохранена отдельно."));
    top.appendChild(left);
    var score = el("div", "results-score");
    score.appendChild(el("span", "results-num", correct + " / " + total));
    score.appendChild(el("span", "results-pct", pct + "%"));
    top.appendChild(score);
    panel.appendChild(top);

    var stillWrong = state.reviewCases.filter(function (c) {
      var ans = state.reviewAnswers.filter(function (a) { return a.caseId === c.id; })[0];
      return !ans || !ans.correct;
    });

    var actions = el("div", "results-actions");
    if (stillWrong.length > 0) {
      var again = el("button", "btn btn-primary btn-md", "Повторить ошибки (" + stillWrong.length + ")");
      again.addEventListener("click", function () {
        state.reviewCases = stillWrong;
        state.reviewIndex = 0;
        state.reviewAnswers = [];
        state.currentSelected = -1;
        state.answeredCurrent = false;
        renderQuiz();
      });
      actions.appendChild(again);
    } else {
      var all = el("button", "btn btn-primary btn-md", "Отлично, все верно");
      all.setAttribute("disabled", "disabled");
      actions.appendChild(all);
    }
    var back = el("button", "btn btn-ghost btn-md", "К общим результатам");
    back.addEventListener("click", renderResults);
    actions.appendChild(back);
    panel.appendChild(actions);

    wrap.appendChild(panel);
    render(wrap);
  }

  function mistakeRow(item, answer) {
    var row = el("div", "mistake-row");
    var head = el("button", "mistake-head");
    head.appendChild(el("span", "mistake-dot"));
    head.appendChild(el("span", "mistake-name", item.title));
    head.appendChild(el("span", "mistake-type", item.type || ""));
    head.appendChild(el("span", "mistake-caret", "▾"));
    row.appendChild(head);

    var body = el("div", "mistake-body");
    body.style.display = "none";

    var chosenOpt = item.options[answer.selectedIndex];
    var correctOpt = null;
    item.options.forEach(function (o) { if (o.isCorrect) correctOpt = o; });

    body.appendChild(el("div", "mistake-field", "Предложение"));
    body.appendChild(el("div", "mistake-value mistake-offer", textOfCase(item)));
    body.appendChild(el("div", "mistake-field", "Вопрос"));
    body.appendChild(el("div", "mistake-value", item.question));
    body.appendChild(el("div", "mistake-field", "Ваш ответ"));
    body.appendChild(el("div", "mistake-value wrong", chosenOpt ? chosenOpt.text : ""));
    body.appendChild(el("div", "mistake-field", "Правильный ответ"));
    body.appendChild(el("div", "mistake-value right", (correctOpt ? correctOpt.text : "")));
    body.appendChild(el("div", "mistake-divider"));
    body.appendChild(buildBreakdown(item));

    row.appendChild(body);
    head.addEventListener("click", function () {
      var open = body.style.display !== "none";
      body.style.display = open ? "none" : "block";
      head.classList.toggle("open", !open);
    });
    return row;
  }

  // собираем текст предложения из экрана кейса
  function textOfCase(item) {
    var sd = item.screen;
    var lines = [];
    if (sd.header && sd.header.title) lines.push(sd.header.title);
    (sd.paragraphs || []).forEach(function (p) { lines.push(p); });
    if (sd.cards) sd.cards.forEach(function (c) { lines.push(c.title + " — " + c.text); });
    if (sd.stories) sd.stories.forEach(function (s) { lines.push(s); });
    return lines.join("\n\n");
  }

  function resultsTitle(pct) {
    return "Вы прошли тренажер";
  }

  function resultsLead(pct) {
    if (pct >= 100) return "Все ответы верные. Вы разобрали тексты без подвоха, манипуляции и дарк-паттерны.";
    return "Можно повторить задания с ошибками или открыть их разбор";
  }

  // ============================================================================
  // 4. Опрос
  // ============================================================================
  function renderSurvey() {
    track("survey_open");
    state.survey = state.survey || restoreSurveyDraft();
    var wrap = el("div", "screen");
    var panel = el("div", "results-panel");

    var back = el("button", "btn-nav", state.answers.length ? "← Назад к результатам" : "На главную");
    back.addEventListener("click", state.answers.length ? renderResults : goHome);
    panel.appendChild(back);

    panel.appendChild(el("h1", "results-title", "Как вам тренажер?"));
    panel.appendChild(el("p", "results-lead", "Оцените пользу тренажера и, если хотите, оставьте комментарий."));

    var q1 = el("div", "survey-q");
    q1.appendChild(el("div", "survey-q-text", "Насколько полезен был тренажер?"));
    q1.appendChild(ratingButtons("rating"));
    panel.appendChild(q1);

    var q2 = el("div", "survey-q");
    q2.appendChild(el("div", "survey-q-text", "Комментарий (необязательно)"));
    var ta = el("textarea", "survey-textarea");
    ta.rows = 4;
    ta.placeholder = "Что было полезно и что стоит улучшить?";
    ta.value = state.survey && state.survey.comment || "";
    ta.addEventListener("input", function () {
      state.survey = state.survey || {};
      state.survey.comment = ta.value;
      saveSurveyDraft(state.survey);
    });
    q2.appendChild(ta);
    panel.appendChild(q2);

    var submit = el("button", "btn btn-primary", "Отправить оценку");
    submit.disabled = !(state.survey && state.survey.rating);
    submit.id = "survey-submit";
    var sending = false;
    var error = el("p", "survey-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    submit.addEventListener("click", function () {
      if (sending) return;
      state.survey = state.survey || {};
      if (!state.survey.rating) return;
      state.survey.comment = ta.value;
      saveSurveyDraft(state.survey);
      sending = true;
      error.hidden = true;
      submit.disabled = true;
      submit.textContent = "Отправляем…";
      back.disabled = true;
      ta.disabled = true;
      var ratings = q1.querySelectorAll(".rating-btn");
      ratings.forEach(function (button) { button.disabled = true; });
      sendSurveyToSheet(state.survey)
        .then(function () {
          track("survey_submit", { rating: state.survey.rating, hasComment: !!state.survey.comment.trim() });
          clearSurveyDraft();
          renderThanks();
        })
        .catch(function (err) {
          sending = false;
          submit.disabled = false;
          submit.textContent = "Отправить еще раз";
          back.disabled = false;
          ta.disabled = false;
          ratings.forEach(function (button) { button.disabled = false; });
          error.textContent = (err.userMessage || "Не удалось отправить отзыв. Попробуйте еще раз.") +
            (saveSurveyDraft(state.survey) ? " Отзыв сохранен на этом устройстве." : " Текст остался в форме.");
          error.hidden = false;
          track("survey_submit_error");
        });
    });
    panel.appendChild(error);
    panel.appendChild(submit);

    wrap.appendChild(panel);
    render(wrap);
  }

  function ratingButtons(key) {
    var wrap = el("div", "rating-wrap");
    var row = el("div", "rating");
    for (var i = 1; i <= 5; i++) {
      (function (val) {
        var b = el("button", "rating-btn", String(val));
        if (state.survey && state.survey[key] === val) b.classList.add("rating-btn-active");
        b.addEventListener("click", function () {
          state.survey = state.survey || {};
          state.survey[key] = val;
          saveSurveyDraft(state.survey);
          var all = row.querySelectorAll(".rating-btn");
          all.forEach(function (x) { x.classList.remove("rating-btn-active"); });
          b.classList.add("rating-btn-active");
          var submit = document.getElementById("survey-submit");
          if (submit) submit.disabled = false;
        });
        row.appendChild(b);
      })(i);
    }
    wrap.appendChild(row);
    var labels = el("div", "rating-labels");
    labels.appendChild(el("span", "rating-label", "1 — совсем не полезен"));
    labels.appendChild(el("span", "rating-label", "5 — очень полезен"));
    wrap.appendChild(labels);
    return wrap;
  }

  var SURVEY_DRAFT_KEY = "dark-patterns-survey-draft-v1";

  function saveSurveyDraft(survey) {
    try {
      window.localStorage.setItem(SURVEY_DRAFT_KEY, JSON.stringify(survey));
      return true;
    } catch (err) { return false; }
  }

  function restoreSurveyDraft() {
    try {
      var draft = JSON.parse(window.localStorage.getItem(SURVEY_DRAFT_KEY));
      if (!draft || typeof draft.comment !== "string" || [1, 2, 3, 4, 5].indexOf(draft.rating) < 0) return null;
      return draft;
    } catch (err) { return null; }
  }

  function clearSurveyDraft() {
    try { window.localStorage.removeItem(SURVEY_DRAFT_KEY); } catch (err) {}
  }

  // Завершаем ожидание своим таймером, даже если fetch не реагирует на abort.
  // Таймер охватывает и чтение тела ответа, а не только получение заголовков.
  function surveyRequest(operation, timeout) {
    return new Promise(function (resolve, reject) {
      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var finished = false;
      var timer = setTimeout(function () {
        if (finished) return;
        finished = true;
        var err = new Error("Feedback request timed out");
        err.userMessage = "Сервис отзывов не ответил вовремя. Попробуйте еще раз.";
        reject(err);
        if (controller) { try { controller.abort(); } catch (ignored) {} }
      }, timeout);
      Promise.resolve().then(function () {
        return operation(controller ? controller.signal : undefined);
      }).then(function (result) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve(result);
      }, function (err) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // Сервер возвращает ok после надежного сохранения отзыва у себя.
  // Google Таблица обновляется в фоне; дата при повторе защищает от дублей.
  function sendSurveyToSheet(survey) {
    if (!SURVEY_ENDPOINT) return Promise.reject(new Error("Feedback endpoint is missing"));
    var payload = survey.delivery;
    if (!payload || payload.rating !== survey.rating || payload.comment !== (survey.comment || "") || !isFinite(new Date(payload.date).getTime())) {
      payload = { date: new Date().toISOString(), rating: survey.rating, comment: survey.comment || "" };
      survey.delivery = payload;
    }
    saveSurveyDraft(survey);
    return surveyRequest(function (signal) {
      return fetch(SURVEY_ENDPOINT, {
        method: "POST", mode: "cors", redirect: "follow", credentials: "omit", signal: signal,
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ date: payload.date, rating: payload.rating, comment: payload.comment })
      }).then(function (response) {
        return response.text().then(function (text) {
          if (response.ok && text.trim() === "ok") return;
          var err = new Error("Feedback was not confirmed");
          if (response.status === 403) err.userMessage = "Сервис отзывов не принял запрос с этой страницы. Откройте актуальную версию тренажера и попробуйте еще раз.";
          try { var data = JSON.parse(text); if (data && typeof data.error === "string") err.userMessage = data.error; } catch (ignored) {}
          throw err;
        });
      });
    }, 45000);
  }

  // ============================================================================
  // 5. Спасибо
  // ============================================================================
  function renderThanks() {
    var wrap = el("div", "screen");
    var panel = el("div", "results-panel");

    panel.appendChild(el("h1", "results-title", "Спасибо за обратную связь!"));
    panel.appendChild(el("p", "results-lead", "Ваш отзыв отправлен. Он поможет сделать тренажер полезнее."));

    var actions = el("div", "results-actions");
    var restart = el("button", "btn btn-primary btn-md", "Пройти еще раз");
    restart.addEventListener("click", startFresh);
    actions.appendChild(restart);
    panel.appendChild(actions);

    wrap.appendChild(panel);
    render(wrap);
  }

  // ============================================================================
  // Обратная связь: верхняя плашка на онбординге + плавающая кнопка «Отзыв»
  // ============================================================================
  function feedbackBannerIcon() {
    return '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true">' +
      '<path d="M4 5h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>' +
      '<circle cx="8" cy="11.5" r="1.3" fill="#7151ad"/>' +
      '<circle cx="12" cy="11.5" r="1.3" fill="#7151ad"/>' +
      '<circle cx="16" cy="11.5" r="1.3" fill="#7151ad"/></svg>';
  }

  function buildFeedbackBanner() {
    if (!FEEDBACK_URL) return null;
    var b = document.createElement("div");
    b.className = "feedback-banner";

    var ico = document.createElement("span");
    ico.className = "feedback-banner-ico";
    ico.innerHTML = feedbackBannerIcon();
    b.appendChild(ico);

    var text = document.createElement("span");
    text.className = "feedback-banner-text";
    text.appendChild(document.createTextNode("Привет! Тренажер пока в тестовом режиме. Оставить отзыв можно по кнопке «Отзыв» внизу экрана или "));

    var link = document.createElement("a");
    link.className = "feedback-banner-link";
    link.href = FEEDBACK_URL;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "по ссылке";
    link.addEventListener("click", function () { track("feedback_banner_link"); });
    text.appendChild(link);

    text.appendChild(document.createTextNode(". Если что-то сломалось — пиши в Тайм: "));

    // URL контакта Тайма не подтверждён (доступен только хэндл @v.shesterova),
    // поэтому оформляем как ссылку, но оставляем текстом.
    var contact = document.createElement("span");
    contact.className = "feedback-banner-contact";
    contact.textContent = "v.shesterova";
    text.appendChild(contact);

    b.appendChild(text);
    return b;
  }

  function buildFeedbackFloat() {
    if (!FEEDBACK_URL) return null;
    var btn = document.createElement("a");
    btn.className = "feedback-float";
    btn.href = FEEDBACK_URL;
    btn.target = "_blank";
    btn.rel = "noopener";
    btn.setAttribute("aria-label", "Оставить отзыв");
    btn.innerHTML = feedbackBannerIcon() + '<span>Отзыв</span>';
    btn.addEventListener("click", function () { track("feedback_float_open"); });
    return btn;
  }

  var fbFloat = buildFeedbackFloat();
  if (fbFloat) document.body.appendChild(fbFloat);

  // --- запуск --------------------------------------------------------------------
  if (new URLSearchParams(window.location.search).get("feedback") === "1") renderSurvey();
  else renderIntro();
})();
