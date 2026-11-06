/* METAR and TAF decoder + practice generator for part107quiz.com.
   Sources (read 2026-11-06): FAA AIM 7-1-28 (Key to TAF and METAR), 7-1-29 (ICAO weather formats),
   7-1-7 (categorical ceiling and visibility), 7-1-14 (cloud heights); 14 CFR 107.51.
   ES5 only. No network requests. Exposes window.P107WX (and module.exports under Node for tests). */
(function (root) {
  "use strict";

  var DESCRIPTORS = { MI: "shallow", PR: "partial", BC: "patches of", DR: "low drifting", BL: "blowing", SH: "showers of", TS: "thunderstorm", FZ: "freezing" };
  var PRECIP = { DZ: "drizzle", RA: "rain", SN: "snow", SG: "snow grains", IC: "ice crystals", PL: "ice pellets", GR: "hail (1/4 inch or larger)", GS: "small hail or snow pellets", UP: "unknown precipitation" };
  var OBSCURATION = { BR: "mist", FG: "fog", FU: "smoke", VA: "volcanic ash", DU: "widespread dust", SA: "sand", HZ: "haze", PY: "spray" };
  var OTHER = { PO: "dust or sand whirls", SQ: "squall", FC: "funnel cloud", SS: "sandstorm", DS: "duststorm" };
  var COVER = { FEW: "few clouds (more than 0/8 up to 2/8 of the sky)", SCT: "scattered (3/8 to 4/8 of the sky)", BKN: "broken (5/8 to 7/8 of the sky)", OVC: "overcast (8/8 of the sky)" };

  function pad(n, w) { n = String(n); while (n.length < w) n = "0" + n; return n; }
  function fmtFt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " ft"; }
  function ord(d) {
    var s = ["th", "st", "nd", "rd"], v = d % 100;
    return d + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function fracText(v) {
    // v is a number of statute miles; renders 1.5 as "1 1/2"
    var whole = Math.floor(v + 1e-9), rest = v - whole, f = "";
    var table = [[1 / 16, "1/16"], [1 / 8, "1/8"], [3 / 16, "3/16"], [1 / 4, "1/4"], [5 / 16, "5/16"], [3 / 8, "3/8"], [1 / 2, "1/2"], [5 / 8, "5/8"], [3 / 4, "3/4"], [7 / 8, "7/8"]];
    for (var i = 0; i < table.length; i++) if (Math.abs(rest - table[i][0]) < 1e-6) f = table[i][1];
    if (whole && f) return whole + " " + f;
    if (f) return f;
    return String(whole);
  }
  function fracValue(txt) {
    var p = String(txt).split(" "), v = 0;
    for (var i = 0; i < p.length; i++) { var q = p[i].split("/"); v += q.length === 2 ? parseInt(q[0], 10) / parseInt(q[1], 10) : parseInt(q[0], 10); }
    return v;
  }
  function smText(v) { return fracText(v) + (v <= 1 ? " statute mile" : " statute miles"); }

  /* ---------- element decoders shared by METAR and TAF ---------- */

  function decodeWind(tok) {
    var m = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH)$/.exec(tok);
    if (!m) return null;
    var unit = m[4] === "KT" ? "knots" : (m[4] === "MPS" ? "meters per second" : "km/h");
    var spd = parseInt(m[2], 10), gust = m[3] ? parseInt(m[3], 10) : null;
    var w = { dir: m[1] === "VRB" ? "VRB" : parseInt(m[1], 10), speed: spd, gust: gust, unit: m[4] };
    var txt;
    if (m[1] === "000" && spd === 0 && !gust) { txt = "Calm wind."; w.calm = true; }
    else {
      txt = (m[1] === "VRB" ? "Wind variable in direction" : "Wind from " + m[1] + "° true") + " at " + spd + " " + unit;
      if (gust !== null) txt += ", gusting to " + gust + " " + unit;
      txt += ".";
      if (m[1] !== "VRB") txt += " The direction is where the wind blows from, referenced to true north.";
    }
    return { w: w, text: txt };
  }

  function decodeVis(tokens, i) {
    // returns {consumed, sm (number or null), less, more, text} or null
    var t = tokens[i], m, whole = null;
    if (/^\d$/.test(t) && tokens[i + 1] && /^[1-9]\/\d{1,2}SM$/.test(tokens[i + 1])) { whole = parseInt(t, 10); i++; t = tokens[i]; }
    m = /^([MP])?(\d{1,2})(?:\/(\d{1,2}))?SM$/.exec(t);
    if (m) {
      var v = m[3] ? parseInt(m[2], 10) / parseInt(m[3], 10) : parseInt(m[2], 10);
      if (whole !== null) { if (!m[3]) return null; v += whole; }
      var r = { consumed: whole !== null ? 2 : 1, sm: v, less: m[1] === "M", more: m[1] === "P" };
      if (r.less) r.text = "Visibility less than " + smText(v) + ".";
      else if (r.more) r.text = "Visibility more than " + smText(v) + ".";
      else r.text = "Visibility " + smText(v) + "." + (v === 10 && whole === null && !m[3] ? " Automated stations report 10 statute miles or more as 10SM." : "");
      return r;
    }
    if (/^\d{4}$/.test(t) && whole === null) {
      var meters = parseInt(t, 10);
      return { consumed: 1, sm: meters === 9999 ? 6.21 : meters / 1609.344, meters: meters, more: meters === 9999,
        text: meters === 9999 ? "Visibility 10 km or more (reported in meters; used outside the U.S.)." : "Visibility " + meters + " meters (reported in meters; used outside the U.S.)." };
    }
    if (t === "CAVOK" && whole === null) return { consumed: 1, sm: 6.21, more: true, cavok: true, text: "CAVOK: ceiling and visibility OK (used outside the U.S.)." };
    return null;
  }

  function decodeRvr(tok) {
    var m = /^R(\d{2}[LCR]?)\/([MP]?)(\d{4})(?:V([MP]?)(\d{4}))?(FT)?(?:\/?([UDN]))?$/.exec(tok);
    if (!m) return null;
    function val(p, n) { var x = parseInt(n, 10); return (p === "M" ? "less than " : p === "P" ? "more than " : "") + (m[6] ? fmtFt(x) : x + " m"); }
    var txt = "Runway visual range on runway " + m[1] + ": " + val(m[2], m[3]);
    if (m[5]) txt = "Runway visual range on runway " + m[1] + " variable from " + val(m[2], m[3]) + " to " + val(m[4], m[5]);
    if (m[7]) txt += m[7] === "U" ? ", going up" : m[7] === "D" ? ", going down" : ", no change";
    return { text: txt + "." };
  }

  function decodeWx(tok) {
    var s = tok, parts = [], intensity = "", vc = false, desc = [];
    if (s === "NSW") return { text: "No significant weather: the weather phenomena end. Wind, visibility and sky carry over from the earlier group.", nsw: true, codes: [] };
    if (s.charAt(0) === "-" || s.charAt(0) === "+") { intensity = s.charAt(0); s = s.slice(1); }
    if (s.slice(0, 2) === "VC") { if (intensity) return null; vc = true; s = s.slice(2); }
    while (s.length >= 2 && DESCRIPTORS[s.slice(0, 2)] && desc.length < 2) { desc.push(s.slice(0, 2)); s = s.slice(2); }
    var codes = [];
    while (s.length >= 2) {
      var c = s.slice(0, 2);
      if (PRECIP[c] || OBSCURATION[c] || OTHER[c]) { codes.push(c); s = s.slice(2); } else return null;
    }
    if (s.length) return null;
    if (!codes.length && !desc.length) return null;
    if (!codes.length && desc.length === 1 && desc[0] !== "TS" && !(desc[0] === "SH" && vc)) return null; // only TS, or SH in VCSH, may stand alone
    if (intensity && !codes.length) return null;
    var heavyStorm = intensity === "+" && codes.length === 1 && (codes[0] === "SS" || codes[0] === "DS");
    var text;
    if (intensity === "+" && codes.length === 1 && codes[0] === "FC") text = "tornado or waterspout";
    else {
      var precip = [], rest = [];
      for (var i = 0; i < codes.length; i++) (PRECIP[codes[i]] ? precip : rest).push(PRECIP[codes[i]] || OBSCURATION[codes[i]] || OTHER[codes[i]]);
      if (intensity && !precip.length && !heavyStorm) return null; // intensity applies to precipitation (and to sandstorm/duststorm)
      var blowing = desc.indexOf("BL") !== -1 || desc.indexOf("DR") !== -1;
      // intensity word: only for falling precipitation; no sign means moderate
      var noModerate = { "unknown precipitation": 1, "hail (1/4 inch or larger)": 1, "small hail or snow pellets": 1, "ice crystals": 1 };
      var iw = intensity === "-" ? "light " : intensity === "+" ? "heavy " : (!precip.length || blowing || noModerate[precip[0]] ? "" : "moderate ");
      var mods = [];
      for (var j = 0; j < desc.length; j++) if (desc[j] !== "TS" && desc[j] !== "SH") mods.push(DESCRIPTORS[desc[j]]);
      var first = precip.length ? precip[0] : "", others = precip.slice(1).concat(rest);
      var core;
      var plainShower = { rain: 1, snow: 1, drizzle: 1 };
      if (desc.indexOf("SH") !== -1) core = first ? (plainShower[first] ? iw + first + " showers" : iw + "showers of " + first) : "showers";
      else if (first) core = iw + (mods.length ? mods.join(" ") + " " : "") + first;
      else core = iw + (mods.length ? mods.join(" ") + " " : "") + (others.length ? others.shift() : "");
      if (desc.indexOf("SH") !== -1 && mods.length) core = mods.join(" ") + " " + core;
      if (desc.indexOf("TS") !== -1) text = (core ? "thunderstorm with " + core : "thunderstorm") + (others.length ? " and " + others.join(" and ") : "");
      else text = core + (others.length ? ", with " + others.join(" and ") : "");
    }
    if (vc) text += " in the vicinity (5 to 10 statute miles from the observation point)";
    text = text.charAt(0).toUpperCase() + text.slice(1) + ".";
    if (codes.indexOf("FG") !== -1 && !vc && desc.indexOf("MI") === -1 && desc.indexOf("BC") === -1 && desc.indexOf("PR") === -1) text += " FG is used only when visibility is less than 5/8 statute mile; from 5/8 to 6 statute miles the code is BR (mist).";
    return { text: text, codes: codes, desc: desc, intensity: intensity, vc: vc };
  }

  function decodeSky(tok, inTaf) {
    var m;
    if (tok === "SKC") return { layer: null, clear: true, text: "Sky clear." };
    if (tok === "CLR") return { layer: null, clear: true, auto12k: true, text: inTaf ? "CLR (clear below 12,000 ft) is an automated-station code; TAFs use SKC for a clear sky." : "Clear below 12,000 ft (automated stations cannot report clouds above 12,000 ft)." };
    if (tok === "NSC" || tok === "NCD") return { layer: null, clear: true, text: tok === "NSC" ? "No significant cloud (used outside the U.S.)." : "No cloud detected (used outside the U.S.)." };
    m = /^(FEW|SCT|BKN|OVC)(\d{3})(CB|TCU)?$/.exec(tok);
    if (m) {
      var h = parseInt(m[2], 10) * 100;
      var t = COVER[m[1]].charAt(0).toUpperCase() + COVER[m[1]].slice(1) + " at " + fmtFt(h) + " above ground level";
      if (m[3] === "CB") t += ", cumulonimbus";
      if (m[3] === "TCU") t += ", towering cumulus" + (inTaf ? " (TAFs forecast CB only, so TCU is unusual here)" : "");
      t += ".";
      if (h === 0 && m[1] !== "OVC") t = "Partial obscuration at the surface: part of the sky is hidden by fog, smoke or a similar surface-based phenomenon.";
      if (h === 0 && m[1] === "OVC") t = "Overcast at the surface (0 ft). An entirely hidden sky is normally reported as vertical visibility (VV) instead.";
      return { layer: { cover: m[1], h: h, type: m[3] || "" }, text: t };
    }
    m = /^VV(\d{3})$/.exec(tok);
    if (m) {
      var hv = parseInt(m[1], 10) * 100;
      return { layer: { cover: "VV", h: hv, type: "" }, text: "Sky obscured; vertical visibility " + fmtFt(hv) + " (an indefinite ceiling)." };
    }
    return null;
  }

  function decodeTemp(tok) {
    var m = /^(M?)(\d{2})\/(?:(M?)(\d{2}))?$/.exec(tok);
    if (!m) return null;
    var t = parseInt(m[2], 10) * (m[1] ? -1 : 1);
    var d = m[4] !== undefined ? parseInt(m[4], 10) * (m[3] ? -1 : 1) : null;
    var txt = "Temperature " + t + "°C" + (d !== null ? ", dew point " + d + "°C." : ", dew point missing.");
    if (d !== null) txt += " Spread " + (t - d) + "°C.";
    return { t: t, d: d, text: txt };
  }

  function decodeAlt(tok) {
    var m = /^A(\d{4})$/.exec(tok);
    if (m) { var v = parseInt(m[1], 10) / 100; return { inhg: v, text: "Altimeter setting " + v.toFixed(2) + " inches of mercury." }; }
    m = /^Q(\d{4})$/.exec(tok);
    if (m) return { hpa: parseInt(m[1], 10), text: "Altimeter setting " + parseInt(m[1], 10) + " hectopascals (used outside the U.S.)." };
    return null;
  }

  function decodeWs(tok) {
    var m = /^WS(\d{3})\/(\d{3})(\d{2,3})KT$/.exec(tok);
    if (!m) return null;
    return { text: "Low-level wind shear (non-convective) forecast at " + fmtFt(parseInt(m[1], 10) * 100) + " above ground level, where the wind is from " + m[2] + "° at " + parseInt(m[3], 10) + " knots." };
  }

  function decodeRemark(tokens, i) {
    var t = tokens[i], m;
    if (t === "AO1") return { consumed: 1, text: "Automated station without a precipitation discriminator." };
    if (t === "$") return { consumed: 1, text: "Maintenance check indicator: the station's equipment needs maintenance." };
    if (t === "AO2") return { consumed: 1, text: "Automated station with a precipitation discriminator (it can tell liquid from frozen precipitation)." };
    m = /^SLP(\d{3})$/.exec(t);
    if (m) {
      var n = parseInt(m[1], 10), hpa = (n < 500 ? 1000 : 900) + n / 10;
      return { consumed: 1, text: "Sea-level pressure " + hpa.toFixed(1) + " hectopascals (the three digits are tens, units and tenths)." };
    }
    if (t === "SLPNO") return { consumed: 1, text: "Sea-level pressure not available." };
    m = /^T0(\d{3})0(\d{3})$/.exec(t);
    if (m) return { consumed: 1, text: "Temperature " + (parseInt(m[1], 10) / 10).toFixed(1) + "°C and dew point " + (parseInt(m[2], 10) / 10).toFixed(1) + "°C, to the tenth of a degree." };
    if (/^T[01]\d{3}[01]\d{3}$/.test(t)) return { consumed: 1, text: "Hourly temperature and dew point to the tenth of a degree (not decoded here)." };
    if (t === "PK" && tokens[i + 1] === "WND" && tokens[i + 2]) {
      m = /^(\d{3})(\d{2,3})\/(\d{2})?(\d{2})$/.exec(tokens[i + 2]);
      if (m) return { consumed: 3, text: "Peak wind from " + m[1] + "° at " + parseInt(m[2], 10) + " knots, at " + (m[3] ? m[3] + m[4] + "Z" : m[4] + " minutes past the hour") + "." };
    }
    if (t === "WSHFT" && tokens[i + 1] && /^\d{2,4}$/.test(tokens[i + 1])) {
      var c = 2, txt = "Wind shift began at " + (tokens[i + 1].length === 2 ? tokens[i + 1] + " minutes past the hour" : tokens[i + 1] + "Z");
      if (tokens[i + 2] === "FROPA") { c = 3; txt += ", due to a frontal passage"; }
      return { consumed: c, text: txt + "." };
    }
    return null;
  }

  /* ---------- METAR ---------- */

  function clean(s) {
    return String(s || "").toUpperCase().replace(/[=]+\s*$/, "").replace(/\s+/g, " ").trim();
  }

  function parseMetar(input) {
    var s = clean(input), tokens = s ? s.split(" ") : [], i = 0, out = { kind: "METAR", groups: [], layers: [], weather: [], errors: [] };
    function add(raw, label, text) { out.groups.push({ raw: raw, label: label, text: text }); }
    if (!tokens.length) { out.errors.push("Paste a METAR or TAF first."); return out; }
    if (tokens[i] === "METAR" || tokens[i] === "SPECI") {
      out.type = tokens[i];
      add(tokens[i], "Report type", tokens[i] === "METAR" ? "Routine weather observation (METAR)." : "Special (non-routine) weather observation (SPECI).");
      i++;
    }
    if (tokens[i] && /^[A-Z][A-Z0-9]{3}$/.test(tokens[i]) && !/^\d/.test(tokens[i])) { out.station = tokens[i]; add(tokens[i], "Station", "ICAO identifier of the reporting station."); i++; }
    else { out.errors.push("Expected a 4-letter station identifier (for example KPIT)."); return out; }
    var tm = tokens[i] && /^(\d{2})(\d{2})(\d{2})Z$/.exec(tokens[i]);
    if (tm) { out.day = parseInt(tm[1], 10); out.time = tm[2] + tm[3]; add(tokens[i], "Date and time", "Observed on the " + ord(out.day) + " day of the month at " + out.time + " UTC (Zulu)."); i++; }
    else { out.errors.push("Expected the date and time group, like 091955Z."); return out; }
    while (tokens[i] === "AUTO" || tokens[i] === "COR") {
      if (tokens[i] === "AUTO") { out.auto = true; add("AUTO", "Modifier", "Fully automated report with no human intervention."); }
      else { out.cor = true; add("COR", "Modifier", "Corrected report that replaces an earlier one with an error."); }
      i++;
    }
    var w = tokens[i] && decodeWind(tokens[i]);
    if (w) { out.wind = w.w; add(tokens[i], "Wind", w.text); i++;
      var vm = tokens[i] && /^(\d{3})V(\d{3})$/.exec(tokens[i]);
      if (vm) { out.wind.varFrom = parseInt(vm[1], 10); out.wind.varTo = parseInt(vm[2], 10); add(tokens[i], "Wind variability", "Wind direction varying between " + vm[1] + "° and " + vm[2] + "° (reported when it varies by 60° or more and the speed is above 6 knots)."); i++; }
    }
    var v = tokens[i] && decodeVis(tokens, i);
    if (v) { out.vis = v; add(tokens.slice(i, i + v.consumed).join(" "), "Visibility", v.text + (v.cavok ? "" : " This is the prevailing surface visibility at the station.")); i += v.consumed; }
    while (tokens[i] && /^R\d{2}/.test(tokens[i])) {
      var r = decodeRvr(tokens[i]);
      if (!r) break;
      add(tokens[i], "Runway visual range", r.text); i++;
    }
    while (tokens[i]) {
      var x = decodeWx(tokens[i]);
      if (!x || x.nsw) break;
      out.weather.push(x); add(tokens[i], "Weather", x.text); i++;
    }
    while (tokens[i]) {
      var k = decodeSky(tokens[i]);
      if (!k) break;
      if (k.layer) out.layers.push(k.layer);
      if (k.clear) out.clear = tokens[i];
      add(tokens[i], "Sky condition", k.text); i++;
    }
    var tp = tokens[i] && decodeTemp(tokens[i]);
    if (tp) { out.temp = tp.t; out.dew = tp.d; add(tokens[i], "Temperature / dew point", tp.text); i++; }
    var al = tokens[i] && decodeAlt(tokens[i]);
    if (al) { out.alt = al; add(tokens[i], "Altimeter", al.text); i++; }
    if (tokens[i] === "RMK") {
      add("RMK", "Remarks", "Start of the remarks section.");
      i++;
      while (i < tokens.length) {
        var rm = decodeRemark(tokens, i);
        if (rm) { add(tokens.slice(i, i + rm.consumed).join(" "), "Remark", rm.text); i += rm.consumed; }
        else {
          var j = i + 1;
          while (j < tokens.length && !decodeRemark(tokens, j)) j++;
          add(tokens.slice(i, j).join(" "), "Remark", "Not decoded here. Remarks can hold many other items (precipitation start and end times, lightning, sensor status); see the FAA AIM 7-1-29 list.");
          i = j;
        }
      }
    }
    if (i < tokens.length) {
      out.errors.push("Could not read “" + tokens.slice(i).join(" ") + "”. Check the order: wind, visibility, runway visual range, weather, sky, temperature/dew point, altimeter, then RMK.");
      add(tokens.slice(i).join(" "), "Not recognized", "This part did not match a METAR group in the expected order.");
    }
    finish(out);
    return out;
  }

  function ceilingOf(layers) {
    var best = null;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      var counts = L.cover === "VV" || L.cover === "OVC" || (L.cover === "BKN" && L.h > 0);
      if (counts && (!best || L.h < best.h)) best = L;
    }
    return best;
  }

  function categoryOf(ceil, vis) {
    // FAA AIM 7-1-7. Returns null when visibility is missing.
    if (!vis || vis.sm === null || vis.sm === undefined) return ceil && ceil.h < 500 ? "LIFR" : null; // a ceiling below 500 ft alone makes it LIFR
    var c = ceil ? ceil.h : Infinity, vsm = vis.sm, less = !!vis.less;
    if (c < 500 || vsm < 1 || (less && vsm <= 1)) return "LIFR";
    if (c < 1000 || vsm < 3 || (less && vsm <= 3)) return "IFR";
    if (c <= 3000 || vsm <= 5) return "MVFR";
    return "VFR";
  }

  function lowestLayer(layers) {
    var best = null;
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      if (L.cover === "VV" || (L.h === 0 && L.cover !== "OVC")) continue;
      if (!best || L.h < best.h) best = L;
    }
    return best;
  }
  function vvOf(layers) { for (var i = 0; i < layers.length; i++) if (layers[i].cover === "VV") return layers[i]; return null; }

  function part107Notes(o) {
    var notes = [], fc = !!o.forecast;
    var visWord = fc ? "Forecast visibility" : "Reported visibility";
    var where = fc ? "This is a forecast for the airport, not the view from your site" : "This report is the airport's surface visibility, not the view from your site";
    if (o.vis) {
      var v = o.vis.sm;
      if (o.vis.cavok || o.vis.meters !== undefined) notes.push({ level: "info", text: "Visibility is not given in statute miles here. Part 107 needs at least 3 statute miles (about 4.8 km) of flight visibility from your control station (14 CFR 107.51(c))." });
      else if (v < 3 || (o.vis.less && v <= 3)) notes.push({ level: "warn", text: visWord + " " + (o.vis.less ? "less than " : "") + smText(v) + " is below 3 statute miles. Part 107 requires at least 3 statute miles of flight visibility from your control station (14 CFR 107.51(c)). " + where + ", but a value under 3 statute miles is a strong sign that you will not meet the minimum nearby." });
      else notes.push({ level: "ok", text: visWord + " is at least 3 statute miles at the airport. Part 107 still needs 3 statute miles of flight visibility from where you fly (14 CFR 107.51(c))." });
    }
    var low = lowestLayer(o.layers || []);
    var layerWord = fc ? "The lowest forecast layer" : "The lowest reported layer";
    if (low) {
      var cap = low.h - 500, gaps = low.cover === "FEW" || low.cover === "SCT";
      var gapText = gaps ? " FEW and SCT layers have gaps: away from those clouds, the rule is to stay 2,000 ft horizontally from them." : "";
      if (cap <= 0) notes.push({ level: "warn", text: layerWord + " is at " + fmtFt(low.h) + " above the airport. Part 107 requires at least 500 ft below clouds (14 CFR 107.51(d)), so no altitude under this layer keeps that distance." + gapText });
      else if (cap < 400) notes.push({ level: "warn", text: layerWord + " is at " + fmtFt(low.h) + " above the airport. To stay at least 500 ft below it (14 CFR 107.51(d)), you could fly no higher than " + fmtFt(cap) + " above the airport's ground level under that layer." + gapText });
      else notes.push({ level: "ok", text: layerWord + " is at " + fmtFt(low.h) + " above the airport, so staying 500 ft below it leaves room up to the 400 ft AGL limit (14 CFR 107.51(b) and (d))." });
      notes.push({ level: "info", text: "Part 107 also requires 2,000 ft horizontally from clouds. Cloud heights are above the airport's ground level; your site's elevation may differ." });
    } else if (vvOf(o.layers || [])) {
      notes.push({ level: "info", text: "The sky is obscured, with vertical visibility of " + fmtFt(vvOf(o.layers).h) + " (an indefinite ceiling). That is not a cloud base, so check the visibility note above." });
    } else if (o.clear) {
      notes.push({ level: "ok", text: o.clear === "CLR" ? "No clouds reported below 12,000 ft. The 400 ft AGL limit still applies (14 CFR 107.51(b))." : (fc ? "No cloud layer forecast." : "No cloud layer reported.") + " The 400 ft AGL limit still applies (14 CFR 107.51(b))." });
    }
    return notes;
  }

  function finish(o) {
    o.ceiling = ceilingOf(o.layers || []);
    o.category = categoryOf(o.ceiling, o.vis);
    o.notes = part107Notes(o);
  }

  /* ---------- TAF ---------- */

  function parsePeriod(tok) {
    var m = /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/.exec(tok);
    if (!m) return null;
    return { d1: parseInt(m[1], 10), h1: parseInt(m[2], 10), d2: parseInt(m[3], 10), h2: parseInt(m[4], 10) };
  }
  function periodText(p) { return "from " + pad(p.h1, 2) + "00Z on the " + ord(p.d1) + " to " + pad(p.h2, 2) + "00Z on the " + ord(p.d2); }

  function parseTaf(input) {
    var s = clean(input), tokens = s ? s.split(" ") : [], i = 0;
    var out = { kind: "TAF", groups: [], periods: [], errors: [] };
    function add(raw, label, text, pi) { out.groups.push({ raw: raw, label: label, text: text, period: pi }); }
    if (tokens[i] === "TAF") { i++; }
    var amd = false;
    if (tokens[i] === "AMD" || tokens[i] === "COR") { amd = tokens[i]; i++; }
    add("TAF" + (amd ? " " + amd : ""), "Report type", amd === "AMD" ? "Amended terminal aerodrome forecast (TAF AMD)." : amd === "COR" ? "Corrected terminal aerodrome forecast." : "Terminal aerodrome forecast (TAF).", -1);
    if (tokens[i] && /^[A-Z][A-Z0-9]{3}$/.test(tokens[i])) { out.station = tokens[i]; add(tokens[i], "Station", "ICAO identifier of the airport.", -1); i++; }
    else { out.errors.push("Expected a 4-letter station identifier after TAF."); return out; }
    var it = tokens[i] && /^(\d{2})(\d{2})(\d{2})Z$/.exec(tokens[i]);
    if (it) { add(tokens[i], "Issued", "Issued on the " + ord(parseInt(it[1], 10)) + " at " + it[2] + it[3] + " UTC.", -1); i++; }
    else { out.errors.push("Expected the issue time, like 091730Z."); return out; }
    var vp = tokens[i] && parsePeriod(tokens[i]);
    if (vp) { out.valid = vp; add(tokens[i], "Valid period", "Forecast valid " + periodText(vp) + ". The first two digits of each half are the date, the last two the hour (UTC).", -1); i++; }
    else { out.errors.push("Expected the valid period, like 0918/1024."); return out; }

    var cur = { change: "BASE", from: { d: vp.d1, h: vp.h1, m: 0 }, period: null, prob: null, groups: [], layers: [], weather: [] };
    out.periods.push(cur);
    function startPeriod(p) { cur = p; out.periods.push(cur); }
    while (i < tokens.length) {
      var t = tokens[i], m;
      if ((m = /^FM(\d{2})(\d{2})(\d{2})$/.exec(t))) {
        startPeriod({ change: "FM", from: { d: parseInt(m[1], 10), h: parseInt(m[2], 10), m: parseInt(m[3], 10) }, groups: [], layers: [], weather: [] });
        add(t, "From (FM)", "From " + m[2] + m[3] + "Z on the " + ord(parseInt(m[1], 10)) + ": a rapid change to a completely new set of conditions, which lasts until the next FM group or the end of the forecast, apart from any TEMPO, BECMG or PROB changes after it. Do not read FM" + m[1] + m[2] + m[3] + " as " + m[1] + m[2] + "Z: the first two digits are the date.", out.periods.length - 1);
        i++; continue;
      }
      if (t === "TEMPO" || t === "BECMG" || /^PROB(30|40)$/.test(t)) {
        var prob = /^PROB(30|40)$/.exec(t), change = prob ? "PROB" : t, label = t, j = i + 1;
        if (prob && tokens[j] === "TEMPO") { label += " TEMPO"; j++; }
        var per = tokens[j] && parsePeriod(tokens[j]);
        if (!per) { out.errors.push("“" + t + "” must be followed by a period like 0920/0922."); break; }
        startPeriod({ change: change, prob: prob ? parseInt(prob[1], 10) : null, tempo: label.indexOf("TEMPO") !== -1, period: per, groups: [], layers: [], weather: [] });
        var expl;
        if (change === "TEMPO") expl = "Temporary conditions " + periodText(per) + ": each spell generally lasts less than an hour, and together they cover less than half of that period. Only the elements that change are listed; the rest carry over.";
        else if (change === "BECMG") expl = "Becoming: a gradual change at some time " + periodText(per) + " (usually about two hours). Only the elements that change are listed; the rest carry over.";
        else expl = prob[1] + "% probability " + periodText(per) + " of the conditions that follow (PROB30 means 30 to 39%, PROB40 means 40 to 49%)" + (label.indexOf("TEMPO") !== -1 ? ", occurring temporarily" : "") + ".";
        add(tokens.slice(i, j + 1).join(" "), label, expl, out.periods.length - 1);
        i = j + 1; continue;
      }
      var pi = out.periods.length - 1, d;
      if ((d = decodeWind(t))) { cur.wind = d.w; add(t, "Wind", d.text.replace("Calm wind.", "Calm wind (a forecast of 3 knots or less)."), pi); i++; continue; }
      if ((d = decodeVis(tokens, i))) {
        cur.vis = d;
        var vt = d.text;
        if (d.more && d.sm === 6) vt = "Visibility more than 6 statute miles (P6SM).";
        add(tokens.slice(i, i + d.consumed).join(" "), "Visibility", vt, pi); i += d.consumed; continue;
      }
      if ((d = decodeWx(t))) { if (d.nsw) cur.nsw = true; else cur.weather.push(d); add(t, "Weather", d.text, pi); i++; continue; }
      if ((d = decodeSky(t, true))) { if (d.layer) cur.layers.push(d.layer); if (d.clear) cur.clear = t; add(t, "Sky condition", d.text, pi); i++; continue; }
      if ((d = decodeWs(t))) { add(t, "Wind shear", d.text, pi); i++; continue; }
      if (t === "AMD" && tokens[i + 1] === "NOT" && tokens[i + 2] === "SKED") {
        var j2 = i + 3, extra = "";
        if ((tokens[j2] === "AFT" || tokens[j2] === "TIL") && tokens[j2 + 1] && /^\d{6}Z?$/.test(tokens[j2 + 1])) {
          var dd = tokens[j2 + 1].slice(0, 2), hm = tokens[j2 + 1].slice(2, 6);
          extra = tokens[j2] === "AFT" ? " after " + hm + "Z on the " + ord(parseInt(dd, 10)) : " until " + hm + "Z on the " + ord(parseInt(dd, 10));
          j2 += 2;
        } else if (tokens[j2] && parsePeriod(tokens[j2])) { extra = " " + periodText(parsePeriod(tokens[j2])); j2 += 1; }
        add(tokens.slice(i, j2).join(" "), "Note", "Amendments are not scheduled" + extra + ".", pi); i = j2; continue;
      }
      if (t === "AMD" && tokens[i + 1] === "LTD" && tokens[i + 2] === "TO") {
        var j3 = i + 3;
        while (j3 < tokens.length && !/^(FM\d{6}|TEMPO|BECMG|PROB30|PROB40)$/.test(tokens[j3])) j3++;
        add(tokens.slice(i, j3).join(" "), "Note", "Amendments are limited to the elements listed (not decoded here).", pi); i = j3; continue;
      }
      out.errors.push("Could not read “" + t + "”.");
      add(t, "Not recognized", "This group did not match a TAF element.", pi);
      i++;
    }
    for (var k = 0; k < out.periods.length; k++) {
      var P = out.periods[k];
      P.ceiling = ceilingOf(P.layers);
    }
    return out;
  }

  /* Conditions from the base line or the FM line in force at a given day/hour (TEMPO, BECMG and PROB groups are listed apart). */
  function prevailingAt(taf, day, hour) {
    // days before the valid period's first day belong to the next month
    var d1 = taf.valid ? taf.valid.d1 : 1;
    function abs(d, h, m) { return (d < d1 ? d + 100 : d) * 24 + h + (m || 0) / 60; }
    var t = abs(day, hour, 0), best = null;
    for (var i = 0; i < taf.periods.length; i++) {
      var P = taf.periods[i];
      if (P.change !== "BASE" && P.change !== "FM") continue;
      var start = abs(P.from.d, P.from.h, P.from.m);
      if (start <= t + 1e-9) best = P;
    }
    return best;
  }

  function decode(input) {
    var s = clean(input);
    if (/^TAF\b/.test(s)) return parseTaf(s);
    if (/^[A-Z][A-Z0-9]{3} \d{6}Z \d{4}\/\d{4}\b/.test(s)) return parseTaf("TAF " + s);
    return parseMetar(s);
  }

  /* ---------- practice generator ---------- */

  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
  function between(r, lo, hi) { return lo + Math.floor(r() * (hi - lo + 1)); }

  var STATIONS = ["KPIT", "KBNA", "KSFO", "KCVG", "KORD", "KDEN", "KPHX", "KSEA", "KBOS", "KATL", "KMSP", "KDFW"];
  var VIS = [{ s: "10SM", v: 10 }, { s: "10SM", v: 10 }, { s: "10SM", v: 10 }, { s: "7SM", v: 7 }, { s: "6SM", v: 6 }, { s: "5SM", v: 5 }, { s: "4SM", v: 4 }, { s: "3SM", v: 3 }, { s: "2 1/2SM", v: 2.5 }, { s: "2SM", v: 2 }, { s: "1 1/2SM", v: 1.5 }, { s: "1SM", v: 1 }, { s: "3/4SM", v: 0.75 }, { s: "1/2SM", v: 0.5 }, { s: "1/4SM", v: 0.25 }];

  function genMetar(seed) {
    var r = rng(seed), parts = [];
    var auto = r() < 0.45, special = r() < 0.12;
    parts.push(special ? "SPECI" : "METAR");
    var st = pick(r, STATIONS); parts.push(st);
    var day = between(r, 1, 28), hh = between(r, 0, 23), mm = special ? between(r, 0, 59) : 53;
    parts.push(pad(day, 2) + pad(hh, 2) + pad(mm, 2) + "Z");
    if (auto) parts.push("AUTO");
    var roll = r(), wind;
    if (roll < 0.08) wind = "00000KT";
    else if (roll < 0.18) wind = "VRB0" + between(r, 2, 6) + "KT";
    else {
      var dir = between(r, 1, 36) * 10, sp = between(r, 3, 24), g = r() < 0.3 ? sp + between(r, 10, 15) : null;
      wind = pad(dir, 3) + pad(sp, 2) + (g ? "G" + pad(g, 2) : "") + "KT";
      if (sp > 6 && r() < 0.15) { var span = pick(r, [60, 80]), lo = (dir - span / 2 + 360) % 360, hi = (dir + span / 2) % 360; wind += " " + pad(lo === 0 ? 360 : lo, 3) + "V" + pad(hi === 0 ? 360 : hi, 3); }
    }
    parts.push(wind);
    var vis = pick(r, VIS);
    parts.push(vis.s);
    var temp = between(r, -12, 32), dew, wxs = [], roll2 = r();
    var snow = false, obsc = "";
    if (temp <= 0) {
      // snow intensity follows visibility (FAA AIM 7-1-17): light above 1/2 SM, moderate above 1/4 to 1/2, heavy 1/4 or less
      if (roll2 < 0.6 || vis.v < 0.625) { snow = true; wxs.push(vis.v <= 0.25 ? "+SN" : vis.v <= 0.5 ? "SN" : "-SN"); }
      else if (roll2 < 0.68 && vis.v >= 1 && vis.v <= 6) wxs.push("-FZRA");
    } else if (roll2 < 0.42) {
      wxs.push(pick(r, ["-RA", "RA", "+RA", "-SHRA", "TSRA", "-TSRA", "VCSH", "VCTS"]));
    } else if (roll2 < 0.5 && vis.v <= 6) {
      // drizzle intensity also follows visibility (AIM 7-1-17)
      wxs.push(vis.v <= 0.25 ? "+DZ" : vis.v <= 0.5 ? "DZ" : "-DZ");
    }
    var rainy = wxs.length && !/^VC/.test(wxs[0]);
    if (vis.v < 0.625 && !snow) obsc = "FG";                       // FG only below 5/8 SM (AIM 7-1-29)
    else if (vis.v >= 0.625 && vis.v <= 6 && !snow) obsc = rainy || r() < 0.7 || vis.v < 3 ? "BR" : "HZ"; // BR 5/8 to 6 SM; haze only in dry air at 3 SM or more
    else if (snow && vis.v >= 0.625 && vis.v <= 6 && r() < 0.3) obsc = "BR";
    if (obsc) wxs.push(obsc);
    if (wxs.length) parts.push(wxs.join(" "));
    var thunder = wxs.some(function (x) { return /TS/.test(x) && x.indexOf("VC") !== 0; });
    var vcts = wxs.indexOf("VCTS") !== -1;
    var sky = [];
    if (vis.v <= 0.25 && !thunder && r() < 0.5) sky.push("VV" + pad(between(r, 1, 5), 3));
    else {
      var n = r() < 0.15 ? 0 : between(r, 1, 3);
      if ((vis.v < 3 || vcts) && n === 0) n = 1;
      var h = vis.v < 1 ? between(r, 2, 8) : vis.v < 3 ? between(r, 4, 15) : between(r, 6, 45);
      var covers = ["FEW", "SCT", "BKN", "OVC"], ci = vis.v < 3 ? between(r, 1, 3) : between(r, 0, 2);
      for (var k = 0; k < n; k++) {
        var cv = covers[Math.min(ci, 3)];
        sky.push(cv + pad(h, 3));
        if (cv === "OVC") break;
        h += between(r, 8, 40); if (h > 120 && auto) break;
        ci += between(r, 0, 1);
      }
      if (!sky.length) sky.push(auto ? "CLR" : "SKC");
      if (thunder) {
        // a thunderstorm at the station comes with a cumulonimbus layer
        if (sky[0] === "CLR" || sky[0] === "SKC") sky = ["BKN0" + pad(between(r, 25, 60), 2) + "CB"];
        else sky[sky.length - 1] += "CB";
      }
    }
    parts.push(sky.join(" "));
    dew = temp - (obsc === "FG" ? between(r, 0, 1) : obsc === "BR" ? between(r, 0, 2) : obsc === "HZ" ? between(r, 4, 14) : between(r, 1, 14));
    function tc(x) { return (x < 0 ? "M" : "") + pad(Math.abs(x), 2); }
    parts.push(tc(temp) + "/" + tc(dew));
    var altv = between(r, 2950, 3040);
    parts.push("A" + pad(altv, 4));
    var rmk = [];
    if (auto) rmk.push("AO2");
    var slp = Math.round((altv / 100) * 33.8639 * 10) + between(r, -8, 8);
    rmk.push("SLP" + pad(slp % 1000, 3));
    if (temp >= 0 && dew >= 0) rmk.push("T0" + pad(temp * 10 + between(r, 0, 9) * (temp === 0 ? 0 : 0), 3) + "0" + pad(dew * 10, 3));
    parts.push("RMK " + rmk.join(" "));
    return parts.join(" ");
  }

  function shuffle(r, a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  /* Builds a 4-option question. wrongs is an ordered list of candidate wrong answers; the first three that differ
     from the correct answer and from each other are used. Returns null if fewer than three are available. */
  function mcq(r, prompt, correct, wrongs, explain) {
    var seen = {}, opts = [correct];
    seen[correct] = 1;
    for (var i = 0; i < wrongs.length && opts.length < 4; i++) {
      var w = wrongs[i];
      if (w && !seen[w]) { seen[w] = 1; opts.push(w); }
    }
    if (opts.length < 4) return null;
    shuffle(r, opts);
    return { prompt: prompt, options: opts, answer: opts.indexOf(correct), explain: explain };
  }
  function cmp107(v, less) { return (v < 3 || (less && v <= 3)) ? ", which is under 3 statute miles" : ", which is 3 statute miles or more"; }
  function visLabel(v, less) { return (less ? "Less than " : "") + smText(v); }

  function questionsFor(metar, seed) {
    var o = parseMetar(metar), r = rng(seed * 7 + 3), qs = [], q;
    function push(x) { if (x) qs.push(x); }
    // 1 wind
    if (o.wind) {
      var W = o.wind, c, wr;
      if (W.calm) {
        c = "Calm";
        wr = ["From 360° true at 10 knots", "Variable direction at 5 knots", "The wind sensor is out of service", "From 000° magnetic at 1 knot"];
      } else if (W.dir === "VRB") {
        c = "Variable direction at " + W.speed + " knots";
        wr = ["From 360° true at " + W.speed + " knots", "Calm, with gusts to " + W.speed + " knots", "Variable direction, gusting to " + (W.speed + 10) + " knots", "From 180° true at " + W.speed + " knots"];
      } else {
        var g = W.gust ? ", gusting to " + W.gust + " knots" : "";
        var opp = pad(((W.dir + 180 - 1) % 360) + 1, 3);
        c = "From " + pad(W.dir, 3) + "° true at " + W.speed + " knots" + g;
        wr = ["Toward " + pad(W.dir, 3) + "° true at " + W.speed + " knots" + g,
          "From " + pad(W.dir, 3) + "° magnetic at " + W.speed + " knots" + g,
          W.gust ? "From " + pad(W.dir, 3) + "° true at " + W.gust + " knots, gusting to " + W.speed + " knots" : "From " + pad(W.dir, 3) + "° true, gusting to " + W.speed + " knots",
          "From " + opp + "° true at " + W.speed + " knots" + g];
      }
      push(mcq(r, "What wind does this report give?", c, wr, "The wind group gives the direction the wind blows from, in degrees true, then the speed in knots; G marks the highest gust. VRB means the direction is variable and 00000KT means calm."));
    }
    // 2 ceiling
    var ceil = o.ceiling, low = lowestLayer(o.layers), L = o.layers || [];
    var cAns = ceil ? fmtFt(ceil.h) + " AGL" : "No ceiling is reported";
    var cw = [];
    for (var i = 0; i < L.length; i++) if (L[i].h > 0) cw.push(fmtFt(L[i].h) + " AGL");
    if (ceil) { cw.push("No ceiling is reported", fmtFt(ceil.h * 10) + " AGL"); if (ceil.h >= 1000) cw.push(fmtFt(ceil.h / 10) + " AGL"); cw.push(fmtFt(ceil.h + 1000) + " AGL", "12,000 ft AGL"); }
    else { cw.push("12,000 ft AGL"); if (low) cw.push(fmtFt(low.h * 10) + " AGL"); cw.push("400 ft AGL", "1,000 ft AGL", "3,000 ft AGL"); }
    push(mcq(r, "What is the ceiling?", cAns, cw, "The ceiling is the lowest broken (BKN) or overcast (OVC) layer, or the vertical visibility (VV) into an obscuration. FEW and SCT layers are not a ceiling. Heights are in hundreds of feet above ground level."));
    // 3 visibility and Part 107
    if (o.vis && o.vis.meters === undefined && !o.vis.cavok) {
      var v = o.vis.sm, less = !!o.vis.less;
      var vAns = visLabel(v, less) + cmp107(v, less);
      var under = v < 3 || (less && v <= 3);
      var vw = [visLabel(v, less) + (under ? ", which is 3 statute miles or more" : ", which is under 3 statute miles")];
      var alts = [v * 2, v / 2, v + 2, v >= 2 ? v - 1 : 3, 10, 5, 3, 1, 0.5];
      for (var a = 0; a < alts.length; a++) {
        var av = alts[a];
        if (av <= 0 || av > 10 || Math.abs(av - v) < 1e-9 || Math.abs(fracValue(fracText(av)) - av) > 1e-9) continue;
        vw.push(smText(av) + cmp107(av, false));
      }
      push(mcq(r, "What visibility is reported, and is that number under 3 statute miles?", vAns, vw, "Visibility is in statute miles (SM). Part 107 requires at least 3 statute miles of flight visibility from the control station (14 CFR 107.51(c)). The METAR value is the airport's surface visibility: a guide to conditions nearby, not a measurement from your site."));
    }
    // 4 one of: max altitude under the lowest layer, dew point, altimeter
    var kind = between(r, 0, 2), before = qs.length;
    if (low && kind === 0) {
      var cap = Math.min(400, low.h - 500);
      var aAns = cap <= 0 ? "No altitude keeps 500 ft below that layer" : fmtFt(cap) + " AGL";
      var cand = [low.h - 500 > 400 ? fmtFt(low.h - 500) + " AGL" : null, fmtFt(Math.min(400, low.h)) + " AGL", "400 ft AGL", low.h - 1000 > 0 ? fmtFt(Math.min(400, low.h - 1000)) + " AGL" : null, fmtFt(low.h) + " AGL", cap > 0 ? "No altitude keeps 500 ft below that layer" : null, "500 ft AGL", "200 ft AGL", "100 ft AGL"];
      push(mcq(r, "Flying under the lowest reported cloud layer, what is the highest you could fly and still meet the 400 ft limit and stay 500 ft below that layer? Assume your site is at the airport's elevation.", aAns, cand, "Take the lowest layer height, subtract 500 ft (14 CFR 107.51(d)), and cap it at 400 ft AGL (107.51(b); the structure exception is left out here)."));
    } else if (o.temp !== undefined && o.dew !== null && kind === 1) {
      var d = o.dew, t = o.temp;
      push(mcq(r, "What is the dew point?", d + "°C", [t + "°C", (-d) + "°C", (t - d) + "°C", (d + 10) + "°C", (d - 10) + "°C"], "The temperature/dew point group is in degrees Celsius: temperature first, dew point after the slash. M means minus."));
    }
    if (qs.length === before && o.alt && o.alt.inhg) {
      var x = o.alt.inhg, digits = String(Math.round(x * 100));
      push(mcq(r, "What altimeter setting is reported?", x.toFixed(2) + " inches of mercury", [x.toFixed(2) + " hectopascals", (x / 10).toFixed(3) + " inches of mercury", digits + " feet", (x * 10).toFixed(1) + " inches of mercury"], "A plus four digits is the altimeter setting in inches of mercury and hundredths: A" + digits + " is " + x.toFixed(2) + " inches."));
    }
    // 5 time
    if (o.day) {
      var hh = o.time.slice(0, 2), mm = o.time.slice(2);
      push(mcq(r, "When was this observation made?", "On the " + ord(o.day) + " of the month at " + o.time + " UTC", ["On the " + ord(o.day) + " of the month at " + o.time + " local time", "On day " + o.day + " of the year at " + o.time + " UTC", "It is valid until " + o.time + " UTC on the " + ord(o.day), "On the " + ord(o.day) + " of the month at " + o.time + " UTC, as a forecast for that hour"], "The six-digit group is the date (two digits) and the time (four digits) in UTC, marked Z."));
    }
    return { metar: metar, decoded: o, questions: qs };
  }

  var api = { decode: decode, parseMetar: parseMetar, parseTaf: parseTaf, prevailingAt: prevailingAt, genMetar: genMetar, questionsFor: questionsFor, categoryOf: categoryOf, ceilingOf: ceilingOf, part107Notes: part107Notes, _decodeWx: decodeWx, _decodeVis: decodeVis, _rng: rng };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.P107WX = api;
})(typeof window !== "undefined" ? window : this);
