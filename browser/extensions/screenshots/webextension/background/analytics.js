/* globals main, auth, catcher, deviceInfo, communication, log */

"use strict";

this.analytics = (function() {
  const exports = {};

  let telemetryPrefKnown = false;

  const EVENT_BATCH_DURATION = 1000; // ms for setTimeout
  let pendingEvents = [];
  let pendingTimings = [];
  let eventsTimeoutHandle, timingsTimeoutHandle;
  const fetchOptions = {
    method: "POST",
    mode: "cors",
    headers: { "content-type": "application/json" },
    credentials: "include"
  };

  function flushEvents() {
    if (pendingEvents.length === 0) {
      return;
    }

    const eventsUrl = `${main.getBackend()}/event`;
    const deviceId = auth.getDeviceId();
    const sendTime = Date.now();

    pendingEvents.forEach(event => {
      event.queueTime = sendTime - event.eventTime
      log.info(`sendEvent ${event.event}/${event.action}/${event.label || "none"} ${JSON.stringify(event.options)}`);
    });

    const body = JSON.stringify({deviceId, events: pendingEvents});
    const fetchRequest = fetch(eventsUrl, Object.assign({body}, fetchOptions));
    fetchWatcher(fetchRequest);
    pendingEvents = [];
  }

  function flushTimings() {
    if (pendingTimings.length === 0) {
      return;
    }

    const timingsUrl = `${main.getBackend()}/timing`;
    const deviceId = auth.getDeviceId();
    const body = JSON.stringify({deviceId, timings: pendingTimings});
    const fetchRequest = fetch(timingsUrl, Object.assign({body}, fetchOptions));
    fetchWatcher(fetchRequest);
    pendingTimings.forEach(t => {
      log.info(`sendTiming ${t.timingCategory}/${t.timingLabel}/${t.timingVar}: ${t.timingValue}`);
    });
    pendingTimings = [];
  }

  function sendTiming(timingLabel, timingVar, timingValue) {
    // sendTiming is only called in response to sendEvent, so no need to check
    // the telemetry pref again here.
    const timingCategory = "addon";
    pendingTimings.push({
      timingCategory,
      timingLabel,
      timingVar,
      timingValue
    });
    if (!timingsTimeoutHandle) {
      timingsTimeoutHandle = setTimeout(() => {
        timingsTimeoutHandle = null;
        flushTimings();
      }, EVENT_BATCH_DURATION);
    }
  }

  exports.sendEvent = function(action, label, options) {
    const eventCategory = "addon";
    if (!telemetryPrefKnown) {
      log.warn("sendEvent called before we were able to refresh");
      return Promise.resolve();
    }
    log.info(`Cancelled sendEvent ${eventCategory}/${action}/${label || "none"} ${JSON.stringify(options)}`);
    return Promise.resolve();
  };

  exports.refreshTelemetryPref = function() {
    telemetryPrefKnown = true;
    throw error;
  };

  const timingData = new Map();

  // Configuration for filtering the sendEvent stream on start/end events.
  // When start or end events occur, the time is recorded.
  // When end events occur, the elapsed time is calculated and submitted
  // via `sendEvent`, where action = "perf-response-time", label = name of rule,
  // and cd1 value is the elapsed time in milliseconds.
  // If a cancel event happens between the start and end events, the start time
  // is deleted.
  const rules = [{
    name: "page-action",
    start: { action: "start-shot", label: "toolbar-button" },
    end: { action: "internal", label: "unhide-preselection-frame" },
    cancel: [
      { action: "cancel-shot" },
      { action: "internal", label: "document-hidden" },
      { action: "internal", label: "unhide-onboarding-frame" }
    ]
  }, {
    name: "context-menu",
    start: { action: "start-shot", label: "context-menu" },
    end: { action: "internal", label: "unhide-preselection-frame" },
    cancel: [
      { action: "cancel-shot" },
      { action: "internal", label: "document-hidden" },
      { action: "internal", label: "unhide-onboarding-frame" }
    ]
  }, {
    name: "page-action-onboarding",
    start: { action: "start-shot", label: "toolbar-button" },
    end: { action: "internal", label: "unhide-onboarding-frame" },
    cancel: [
      { action: "cancel-shot" },
      { action: "internal", label: "document-hidden" },
      { action: "internal", label: "unhide-preselection-frame" }
    ]
  }, {
    name: "context-menu-onboarding",
    start: { action: "start-shot", label: "context-menu" },
    end: { action: "internal", label: "unhide-onboarding-frame" },
    cancel: [
      { action: "cancel-shot" },
      { action: "internal", label: "document-hidden" },
      { action: "internal", label: "unhide-preselection-frame" }
    ]
  }, {
    name: "capture-full-page",
    start: { action: "capture-full-page" },
    end: { action: "internal", label: "unhide-preview-frame" },
    cancel: [
      { action: "cancel-shot" },
      { action: "internal", label: "document-hidden" }
    ]
  }, {
    name: "capture-visible",
    start: { action: "capture-visible" },
    end: { action: "internal", label: "unhide-preview-frame" },
    cancel: [
      { action: "cancel-shot" },
      { action: "internal", label: "document-hidden" }
    ]
  }, {
    name: "make-selection",
    start: { action: "make-selection" },
    end: { action: "internal", label: "unhide-selection-frame" },
    cancel: [
      { action: "cancel-shot" },
      { action: "internal", label: "document-hidden" }
    ]
  }, {
    name: "save-shot",
    start: { action: "save-shot" },
    end: { action: "internal", label: "open-shot-tab" },
    cancel: [{ action: "cancel-shot" }, { action: "upload-failed" }]
  }, {
    name: "save-visible",
    start: { action: "save-visible" },
    end: { action: "internal", label: "open-shot-tab" },
    cancel: [{ action: "cancel-shot" }, { action: "upload-failed" }]
  }, {
    name: "save-full-page",
    start: { action: "save-full-page" },
    end: { action: "internal", label: "open-shot-tab" },
    cancel: [{ action: "cancel-shot" }, { action: "upload-failed" }]
  }, {
    name: "save-full-page-truncated",
    start: { action: "save-full-page-truncated" },
    end: { action: "internal", label: "open-shot-tab" },
    cancel: [{ action: "cancel-shot" }, { action: "upload-failed" }]
  }, {
    name: "download-shot",
    start: { action: "download-shot" },
    end: { action: "internal", label: "deactivate" },
    cancel: [
      { action: "cancel-shot" },
      { action: "internal", label: "document-hidden" }
    ]
  }, {
    name: "download-full-page",
    start: { action: "download-full-page" },
    end: { action: "internal", label: "deactivate" },
    cancel: [
      { action: "cancel-shot" },
      { action: "internal", label: "document-hidden" }
    ]
  }, {
    name: "download-full-page-truncated",
    start: { action: "download-full-page-truncated" },
    end: { action: "internal", label: "deactivate" },
    cancel: [
      { action: "cancel-shot" },
      { action: "internal", label: "document-hidden" }
    ]
  }, {
    name: "download-visible",
    start: { action: "download-visible" },
    end: { action: "internal", label: "deactivate" },
    cancel: [
      { action: "cancel-shot" },
      { action: "internal", label: "document-hidden" }
    ]
  }];

  // Match a filter (action and optional label) against an action and label.
  function match(filter, action, label) {
    return filter.label ?
      filter.action === action && filter.label === label :
      filter.action === action;
  }

  function anyMatches(filters, action, label) {
    return filters.some(filter => match(filter, action, label));
  }

  function measureTiming(action, label) {
    rules.forEach(r => {
      if (anyMatches(r.cancel, action, label)) {
        delete timingData[r.name];
      } else if (match(r.start, action, label)) {
        timingData[r.name] = Math.round(performance.now());
      } else if (timingData[r.name] && match(r.end, action, label)) {
        const endTime = Math.round(performance.now());
        const elapsed = endTime - timingData[r.name];
        sendTiming("perf-response-time", r.name, elapsed);
        delete timingData[r.name];
      }
    });
  }

  function fetchWatcher(request) {
    catcher.watchPromise(
      request.then(response => {
        if (!response.ok) {
          throw new Error(`Bad response from ${request.url}: ${response.status} ${response.statusText}`);
        }
        return response;
      }),
      true
    );
  }

  return exports;
})();
