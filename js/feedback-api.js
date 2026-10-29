(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.FeedbackAPI = factory(root.fetch.bind(root));
})(typeof globalThis !== "undefined" ? globalThis : this, function (fetcher) {
  "use strict";
  var PRIMARY = "https://feedback.michellegreenrlg81.chatgpt.site/api/feedback";
  var GOOGLE = "https://script.google.com/macros/s/AKfycby8k4_UduJDaFDiRZMVXlPdGBpeUPEgex8bbo2uqVyVLb-aV3LpsmOQLHJ68lIRT-er/exec";
  function request(url, options, timeout) {
    return new Promise(function (resolve, reject) {
      var controller = typeof AbortController === "function" ? new AbortController() : null;
      var done = false;
      var timer = setTimeout(function () {
        finish(new Error("Request timed out"));
        if (controller) controller.abort();
      }, timeout);
      function finish(error, result) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(result);
      }
      var config = Object.assign({ mode: "cors", credentials: "omit", redirect: "follow" }, options);
      if (controller) config.signal = controller.signal;
      Promise.resolve().then(function () { return fetcher(url, config); }).then(function (response) {
        return response.text().then(function (text) {
          if (!response.ok) {
            var error = new Error("HTTP " + response.status);
            error.status = response.status;
            try { error.userMessage = JSON.parse(text).error; } catch (ignored) {}
            throw error;
          }
          return text;
        });
      }).then(function (result) { finish(null, result); }, finish);
    });
  }
  function rows(endpoint, timeout) {
    var url = endpoint + (endpoint.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now();
    return request(url, { method: "GET", cache: "no-store" }, timeout).then(function (text) {
      var data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error("Invalid feedback data");
      return data.filter(function (row) {
        return row && Number.isFinite(Date.parse(row.date)) && Number(row.rating) >= 1 && Number(row.rating) <= 5;
      });
    });
  }
  function matches(row, payload) {
    return Date.parse(row.date) === Date.parse(payload.date) &&
      Number(row.rating) === payload.rating && String(row.comment || "") === payload.comment;
  }
  return {
    submit: function (payload, options) {
      options = options || {};
      return request(options.endpoint || PRIMARY, {
        method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      }, options.primaryTimeout || 8000).then(function (text) {
        if (text.trim() !== "ok") throw new Error("Unknown acknowledgement");
        return { confirmedBy: "server" };
      }).catch(function (error) {
        // A rejected fetch can still have saved the POST. Never write it again
        // to another service: verify the exact row through the existing mirror.
        if (error.status && error.status >= 400 && error.status < 500) throw error;
        if (options.onVerifying) options.onVerifying();
        var deadline = Date.now() + (options.fallbackTimeout || 45000);
        var delay = options.pollDelay === undefined ? 1500 : options.pollDelay;
        function verify(attempt) {
          var remaining = deadline - Date.now();
          if (remaining <= 0) return Promise.reject(new Error("Verification timed out"));
          return rows(options.googleEndpoint || GOOGLE, remaining).then(function (data) {
            if (!data.some(function (row) { return matches(row, payload); })) throw new Error("Record not confirmed");
            return { confirmedBy: "google" };
          }).catch(function (error) {
            if (attempt >= 2 || Date.now() + delay >= deadline) throw error;
            return new Promise(function (resolve) { setTimeout(resolve, delay); }).then(function () { return verify(attempt + 1); });
          });
        }
        return verify(0).catch(function () {
          var unconfirmed = new Error("Feedback confirmation unavailable");
          unconfirmed.userMessage = "Не удалось подтвердить сохранение отзыва. Попробуйте еще раз.";
          throw unconfirmed;
        });
      });
    },
    read: function (options) {
      options = options || {};
      return rows(options.endpoint || PRIMARY, options.primaryTimeout || 5000).then(function (data) {
        return { rows: data, source: "server" };
      }).catch(function () {
        if (options.onFallback) options.onFallback();
        return rows(options.googleEndpoint || GOOGLE, options.fallbackTimeout || 45000).then(function (data) {
          return { rows: data, source: "google" };
        });
      });
    }
  };
});
