/* 규정 분석 엔진: 본문 파싱, 검색, 위임·참조 분석, 동일·유사 조항 검출.
   브라우저(window.RuleEngine)와 Node(require) 양쪽에서 동작한다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RuleEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 공통 유틸 ---------- */

  // 규정명 비교용: 공백·괄호·따옴표를 없앤다. "학칙 시행세칙" == "학칙시행세칙"
  function normTitle(s) {
    return String(s || '').replace(/[\s「」『』"'“”‘’<>〈〉《》·ㆍ・,]/g, '');
  }

  // 인용할 때 흔히 빼고 쓰는 앞말: 「청주대학교 학칙」 → 「학칙」, 「학교법인 청석학원 정관」 → 「정관」
  const NAME_PREFIX_RE = /^(?:청주대학교|학교법인|청석학원|본대학교|본교|본)+/;

  function nameKeys(s) {
    const n = normTitle(s);
    const keys = [n];
    const stripped = n.replace(NAME_PREFIX_RE, '');
    if (stripped && stripped !== n) keys.push(stripped);
    return keys;
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 띄어쓰기를 무시하는 검색용 정규식: "학사경고" -> 학\s*사\s*경\s*고
  function looseRegex(term, flags) {
    const chars = Array.from(term.replace(/\s+/g, ''));
    return new RegExp(chars.map(escapeRegex).join('\\s*'), flags || 'g');
  }

  function artKey(no, sub) {
    return sub ? `${no}-${sub}` : String(no);
  }

  function artLabel(key) {
    const [n, s] = String(key).split('-');
    return s ? `제${n}조의${s}` : `제${n}조`;
  }

  /* ---------- 본문 파싱 ---------- */

  // "제5조의2", 원문에 따라 "제58조 2"·"제5조2(…)"로 쓴 가지조문도 인정
  const ART_RE = /^\s*제\s*(\d+)\s*조(?:\s*의\s*(\d+)|\s*(\d+)(?=\s*(?:[(【]|$)))?\s*(?:\(([^()\n]{1,60})\)|【([^】\n]{1,60})】)?\s*(.*)$/;
  const CHAP_RE = /^\s*제\s*\d+\s*(?:편|장|절|관)(?:\s|$)/;
  const ADDENDA_RE = /^\s*(?:부\s*칙|附\s*則)(?=[\s<(（]|$)/;
  const DATE_RE = /(\d{4})\s*[.\-년]\s*(\d{1,2})\s*[.\-월]\s*(\d{1,2})/;
  const TITLE_SUFFIX_RE = /(규정|학칙|세칙|규칙|지침|정관|요령|기준|내규|준칙|강령|운영방침|시행령)$/;

  function fmtDate(m) {
    return `${m[1]}.${m[2].padStart(2, '0')}.${m[3].padStart(2, '0')}`;
  }

  /**
   * 규정 전문 텍스트를 조 단위로 분해한다.
   * @param {string} text  규정 전문
   * @param {object} meta  {title, category, url, ...} 이미 아는 값은 그대로 유지
   */
  function parseRuleText(text, meta) {
    meta = meta || {};
    const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ').split('\n');
    const pre = [];
    const articles = [];
    const addenda = [];
    let cur = null;
    let chapter = '';
    let inAddenda = false;
    let last = 0;
    let lastSub = 0;

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (inAddenda) { addenda.push(line); continue; }
      if (ADDENDA_RE.test(line) && articles.length) {
        inAddenda = true;
        addenda.push(line);
        cur = null;
        continue;
      }
      if (CHAP_RE.test(line) && !ART_RE.test(line)) {
        chapter = line.trim();
        cur = null;
        continue;
      }
      const m = line.match(ART_RE);
      if (m) {
        const n = +m[1];
        const sub = m[2] || m[3] ? +(m[2] || m[3]) : 0;
        const title = (m[4] || m[5] || '').trim();
        // 줄 첫머리의 "제5조에 따라…" 같은 인용을 조문 머리로 오인하지 않도록,
        // 제목 괄호가 있거나 번호가 순서대로 이어질 때만 새 조로 인정한다.
        const inOrder = (n === last + 1 && !sub) || (n === last && sub === lastSub + 1) || (n === last && sub > lastSub);
        // "제27조(승진의 제한)에 해당하지…"처럼 조사로 이어지면 다른 조를 인용한 문장이다.
        const isCitation = /^(?:에|의|및|와|과|을|를|은|는|이|가|로|으로|부터|까지|내지|또는|중|·|,)/.test(m[6] || '');
        const ahead = n > last || (n === last && sub > lastSub);
        if (inOrder || (title && ahead && !isCitation && n - last <= 30)) {
          cur = { key: artKey(n, sub), no: artLabel(artKey(n, sub)), title, chapter, text: (m[6] || '').trim() };
          articles.push(cur);
          last = n; lastSub = sub;
          continue;
        }
      }
      if (cur) cur.text += (cur.text ? '\n' : '') + line.trim();
      else pre.push(line.trim());
    }

    articles.forEach(a => { a.text = a.text.replace(/\n{2,}/g, '\n').trim(); });

    const preLines = pre.filter(Boolean);
    let title = meta.title;
    if (!title) {
      title = preLines.find(l => TITLE_SUFFIX_RE.test(l.replace(/\s*[(<\[].*$/, '').trim())) || preLines[0] || '(제목 없음)';
      title = title.replace(/\s*[(<\[].*$/, '').trim();
    }

    // 제정·개정일 추출 (전문 앞부분 또는 부칙)
    let enacted = meta.enacted || '';
    let revised = meta.revised || '';
    const histText = preLines.join('\n') + '\n' + addenda.join('\n');
    if (!enacted) {
      const m = histText.match(new RegExp('제\\s*정\\s*[:：]?\\s*' + DATE_RE.source));
      if (m) enacted = fmtDate(m.slice(0));
    }
    if (!revised) {
      const re = new RegExp('(?:개\\s*정|변\\s*경)\\s*[:：]?\\s*' + DATE_RE.source, 'g');
      let m, best = '';
      while ((m = re.exec(histText))) { const d = fmtDate(m); if (d > best) best = d; }
      revised = best;
    }

    // 머리말의 "폐지 2020. 5. 26." 줄 → 폐지된 규정 (본문에 쓰인 '학과 폐지' 같은 낱말과 구분하려고 줄 첫머리만 본다)
    let abolished = meta.abolished || '';
    if (!abolished) {
      const m = preLines.join('\n').match(new RegExp('^\\s*폐\\s*지\\s*[:：]?\\s*' + DATE_RE.source, 'm'));
      if (m) abolished = fmtDate(m);
    }

    return Object.assign({}, meta, {
      abolished,
      title,
      preamble: meta.preamble != null ? meta.preamble
        : preLines.filter(l => l !== title && !/^(제개정\s*내역\s*보기|내용\s*보기)$/.test(l)).join('\n'),
      articles,
      addenda: meta.addenda != null ? meta.addenda : addenda.join('\n').trim(),
      enacted,
      revised,
    });
  }

  // 부칙을 개정 때마다 붙은 "부칙" 단위로 나눈다. 단위마다 인용 점검에 쓴다.
  // key: b1, b2 …(부칙이 실린 순서), no: "부칙" 또는 "부칙 <2024. 3. 1.>"
  function splitAddenda(text) {
    const units = [];
    let cur = null;
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      if (ADDENDA_RE.test(line)) {
        const d = line.match(DATE_RE);
        cur = { key: `b${units.length + 1}`, no: '부칙', title: d ? fmtDate(d) : '', chapter: '', text: '', addenda: true };
        units.push(cur);
        const rest = line.replace(ADDENDA_RE, '').trim();
        if (rest && !d) cur.text = rest;
        continue;
      }
      if (!cur) {
        cur = { key: 'b1', no: '부칙', title: '', chapter: '', text: '', addenda: true };
        units.push(cur);
      }
      if (!line) continue;
      // 부칙 끝에 붙는 첨부 목록("별표서식", "별표1.hwp")은 부칙 내용이 아니다.
      if (/^(?:별표\s*서식|별지\s*서식|별표서식)$|\.(?:hwp|hwpx|pdf|docx?|xlsx?)$/i.test(line)) continue;
      if (!cur.title && !cur.text) {
        const d = line.match(new RegExp('^[<(（\\[]?\\s*' + DATE_RE.source));
        if (d) { cur.title = fmtDate(d); continue; }
      }
      cur.text += (cur.text ? '\n' : '') + line;
    }
    // 날짜 줄이 없으면 "…년 …월 …일부터 시행" 문구의 날짜로 어느 부칙인지 표시한다.
    units.forEach(u => {
      if (u.title) return;
      const m = u.text.match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
      if (m) u.title = `${fmtDate(m)} 시행`;
    });
    return units.filter(u => u.text);
  }

  const ATTACH_RE = /\.(?:hwp|hwpx|pdf|docx?|xlsx?|zip)$/i;

  // 본문 끝의 첨부 목록("별표1.hwp", "2016-별지제1호서식.hwp")과 수집기가 찾은 받기 주소를 합친다.
  function attachmentList(r) {
    const out = [];
    const byName = new Map();
    const add = (name, url) => {
      name = String(name || '').trim();
      if (!name) return;
      const k = name.replace(/\s+/g, '');
      const got = byName.get(k);
      if (got) { if (url && !got.url) got.url = url; return; }
      const a = { name, label: name.replace(/^\d{4}-/, '').replace(/\.[a-z]+$/i, '').replace(/_/g, ' ').trim() || name, url: url || '' };
      byName.set(k, a);
      out.push(a);
    };
    for (const a of r.attachments || []) add(a.name, a.url);
    for (const raw of String(r.text || [r.preamble, r.addenda].join('\n')).split('\n')) {
      const line = raw.trim();
      if (ATTACH_RE.test(line) && line.length < 120) add(line);
    }
    return out;
  }

  // 외부 데이터(JSON)를 앱 내부 형식으로 정리한다.
  function normalizeRule(r, i) {
    let rule = r;
    if ((!r.articles || !r.articles.length) && r.text) rule = parseRuleText(r.text, Object.assign({}, r, { text: undefined }));
    const articles = (rule.articles || []).map((a, j) => {
      let key = a.key;
      if (!key) {
        const m = String(a.no || '').match(/(\d+)\s*조(?:\s*의\s*(\d+))?/);
        key = m ? artKey(+m[1], m[2] ? +m[2] : 0) : `x${j}`;
      }
      return { key, no: a.no || artLabel(key), title: a.title || '', chapter: a.chapter || '', text: a.text || '' };
    });
    // 조문(제N조) 형식이 아닌 규정은 본문 전체를 하나의 단위로 두어 검색·비교되게 한다.
    if (!articles.length && (rule.preamble || r.text)) {
      articles.push({ key: 'body', no: '본문', title: '', chapter: '', text: String(rule.preamble || r.text).trim() });
    }
    return {
      addendaUnits: splitAddenda(rule.addenda || ''),
      id: String(rule.id || rule.seq || `r${i}`),
      title: String(rule.title || '(제목 없음)').trim(),
      category: rule.category || '',
      code: rule.code || '',
      url: rule.url || '',
      enacted: rule.enacted || '',
      revised: rule.revised || '',
      abolished: rule.abolished || '',
      preamble: articles.length === 1 && articles[0].key === 'body' ? '' : rule.preamble || '',
      addenda: rule.addenda || '',
      attachments: attachmentList(r),
      articles,
    };
  }

  /* ---------- 인덱스 ---------- */

  /**
   * @param rules 규정 목록
   * @param laws  국가법령정보센터 확인 결과(laws.json의 laws: {정규화한 인용 이름: 결과}), 없으면 생략
   */
  function buildIndex(rules, laws) {
    rules = rules.map(normalizeRule);
    const seen = new Set();
    rules.forEach(r => { while (seen.has(r.id)) r.id += '_'; seen.add(r.id); });
    const byId = new Map(rules.map(r => [r.id, r]));
    const byTitle = new Map();
    rules.forEach(r => { if (!byTitle.has(normTitle(r.title))) byTitle.set(normTitle(r.title), r); });
    // 앞말을 뺀 이름도 다른 규정과 겹치지 않으면 별칭으로 등록
    const alias = new Map();
    rules.forEach(r => nameKeys(r.title).slice(1).forEach(k => {
      if (!byTitle.has(k)) alias.set(k, alias.has(k) && alias.get(k) !== r ? null : r);
    }));
    alias.forEach((r, k) => { if (r) byTitle.set(k, r); });
    // 긴 규정명부터 매칭해야 "학칙 시행세칙" 안의 "학칙"을 따로 잡지 않는다.
    const titlesByLen = [...byTitle.entries()].map(([norm, rule]) => ({ rule, norm, alias: norm !== normTitle(rule.title) }))
      .filter(t => t.norm.length >= 2)
      .sort((a, b) => b.norm.length - a.norm.length);
    const articles = [];
    rules.forEach(r => r.articles.forEach(a => { a.ruleId = r.id; articles.push(a); }));
    const lawMap = new Map(Object.entries(laws || {}));
    // 괄호 없이 쓴 법령명("고등교육법 제6조")을 찾을 때 쓰는, 확인된 법령 이름 목록
    const lawNames = [...lawMap.entries()].filter(([k, v]) => v.found && k.length >= 3)
      .map(([norm, law]) => ({ norm, law })).sort((a, b) => b.norm.length - a.norm.length);
    return { rules, byId, byTitle, titlesByLen, articles, laws: lawMap, lawNames };
  }

  function findRuleByName(index, name) {
    for (const k of nameKeys(name)) {
      const r = index.byTitle.get(k);
      if (r) return r;
    }
    return null;
  }

  function findArticle(rule, key) {
    return rule ? rule.articles.find(a => a.key === key) || null : null;
  }

  /* ---------- 검색 ---------- */

  function parseQuery(q) {
    const terms = [];
    String(q || '').replace(/"([^"]+)"|(\S+)/g, (_, phrase, word) => { terms.push(phrase || word); });
    return terms.filter(Boolean);
  }

  function makeMatchers(q, ignoreSpace) {
    return parseQuery(q).map(t => ignoreSpace ? looseRegex(t, 'gi') : new RegExp(escapeRegex(t), 'gi'));
  }

  function countMatches(re, s) {
    re.lastIndex = 0;
    let c = 0;
    while (re.exec(s)) { c++; if (re.lastIndex === 0) break; }
    return c;
  }

  function snippet(text, re, width) {
    width = width || 40;
    re.lastIndex = 0;
    const m = re.exec(text);
    if (!m) return text.slice(0, width * 2);
    const s = Math.max(0, m.index - width);
    const e = Math.min(text.length, m.index + m[0].length + width);
    return (s > 0 ? '…' : '') + text.slice(s, e).replace(/\n/g, ' ') + (e < text.length ? '…' : '');
  }

  /**
   * @param {'all'|'title'|'body'} opts.scope
   * @returns [{rule, titleHit, score, hits:[{article, snippet, count}]}]
   */
  function search(index, q, opts) {
    opts = Object.assign({ scope: 'all', ignoreSpace: true, category: '' }, opts);
    const res = makeMatchers(q, opts.ignoreSpace);
    if (!res.length) return [];
    const out = [];
    for (const rule of index.rules) {
      if (opts.category && rule.category !== opts.category) continue;
      const titleHit = opts.scope !== 'body' && res.every(re => countMatches(re, rule.title) > 0);
      const hits = [];
      if (opts.scope !== 'title') {
        for (const a of rule.articles.concat(rule.addendaUnits || [])) {
          const full = `${a.no}(${a.title}) ${a.text}`;
          // 각 검색어가 해당 조 또는 규정명 어딘가에 있으면 일치로 본다.
          if (!res.every(re => countMatches(re, full) > 0 || countMatches(re, rule.title) > 0)) continue;
          const bodyRes = res.filter(re => countMatches(re, full) > 0);
          if (!bodyRes.length) continue;
          const count = bodyRes.reduce((s, re) => s + countMatches(re, full), 0);
          hits.push({ article: a, count, snippet: snippet(a.text || a.title, bodyRes[0]) });
        }
      }
      if (!titleHit && !hits.length) continue;
      const score = (titleHit ? 1000 : 0) + hits.reduce((s, h) => s + h.count, 0) + (titleHit ? -rule.title.length : 0);
      out.push({ rule, titleHit, hits, score });
    }
    return out.sort((a, b) => b.score - a.score || a.rule.title.localeCompare(b.rule.title, 'ko'));
  }

  /* ---------- 위임·참조 분석 ---------- */

  const EXTERNAL_LAW_RE = /(법|법률|령|시행규칙|헌법|조례|고시|훈령|예규)$/;
  // 학내 규정이 아닌 국가 법령·지침으로 자주 인용되는 것 (이름 끝만으로는 구분이 안 됨)
  const EXTERNAL_NAME_RE = /^(?:공무원|교육공무원|교육부|국가|대학교원자격기준|대학설립|사학기관|평가인정학습과정|사업주직업능력개발|유치원및초등|교원양성과정이수|대학등록금에관한|대학재정지원사업|재직중인대학교원|중소기업회계|유전자재조합실험)/;
  // 지침·기준·요령 등은 규정이 아니어서 규정집에 실리지 않는다. 규정집에 없어도 오류가 아니다.
  const GUIDELINE_RE = /(지침|기준|요령|매뉴얼|편람|운영계획|방침)$/;
  // 「 」 안이 규정 이름 꼴일 때만 규정 인용으로 본다(교과목명·서식명 등 제외)
  const RULE_NAME_RE = /(규정|학칙|세칙|규칙|지침|정관|요령|기준|내규|준칙|강령|회칙|규약|요강|수칙|헌장|약관|규범|법|법률|령|조례|고시|훈령|예규)$/;
  const REF_ART_RE = /^\s*(?:의\s*)?제\s*(\d+)\s*조(?:\s*의\s*(\d+))?(?:\s*의?\s*제\s*(\d+)\s*항)?(?:\s*제\s*[\dㆍ·,\s]+호)?/;
  const INTERNAL_ART_RE = /제\s*(\d+)\s*조(?:\s*의\s*(\d+))?(?:\s*제\s*(\d+)\s*항)?(?:\s*제\s*(\d+)\s*호)?/g;

  // 참조 뒤 문맥으로 관계 유형을 판정한다.
  function classify(after) {
    const s = after.replace(/\s+/g, '');
    if (/^(?:[^.。]{0,30}?)준용/.test(s)) return 'apply';
    if (/^(?:으로|로|에서)(?:따로|별도로)?정(?:한다|할수|하며|하고|하되|하는바|하여야|함)/.test(s)) return 'delegate';
    if (/^(?:[^.。,]{0,8}?)(?:의위임|에서위임|이위임|가위임|에위임|위임에)/.test(s)) return 'basis';
    if (/^(?:[^.。,]{0,12}?)(?:에따라|에따른|에의하여|에의한|에의해|에근거|을근거|를근거|근거하여|의규정에의|의규정에따)/.test(s)) return 'basis';
    if (/^(?:으로|로|에서)(?:[^.。]{0,25}?)(?:정한다|정할수있다|정하며|정하고|정하되|정하는바|정하여야|따로정|별도로정|위임)/.test(s)) return 'delegate';
    return 'ref';
  }

  const UNNAMED_DELEGATION_RE = /(?:별도로|따로|별도의\s*(?:규정|세칙|지침|내규)으?로)\s*정(?:한다|할\s*수\s*있다|하며|하고|하되|하여야|하는\s*바)|(?:시행\s*)?(?:세칙|내규|지침|요령|규칙)\s*으?로\s*정(?:한다|할\s*수\s*있다|하며|하고|하되)|(?:총장|이사장|학장|대학원장|원장|처장|위원회|위원장|교무처장|기획처장)(?:이|가|은|는)\s*(?:따로\s*|별도로\s*)?정(?:한다|할\s*수\s*있다|하며|하고|하되)/g;

  /**
   * 모든 조문에서 규정 간 참조/위임 관계를 추출한다.
   * edge: {from:{rule,article}, to:{name, rule, artKey, article}, type, phrase}
   *   type: delegate(이 조가 대상 규정에 위임) | basis(대상 규정·조항에 근거) | apply(준용) | ref(단순 참조)
   * unnamed: 대상을 특정하지 않은 위임("별도로 정한다", "총장이 정한다" 등)
   * internal: 같은 규정 안의 "제N조" 참조
   */
  function analyze(index) {
    const edges = [];
    const unnamed = [];
    const internal = [];

    for (const rule of index.rules) {
      for (const art of rule.articles.concat(rule.addendaUnits || [])) {
        const text = art.text;
        const masked = new Array(text.length).fill(false);
        const mark = (s, e) => { for (let i = s; i < e; i++) masked[i] = true; };

        const pushEdge = (name, start, end, target, innerKey) => {
          mark(start, end);
          const tail = text.slice(end);
          const am = tail.match(REF_ART_RE);
          let akey = innerKey || '', aEnd = end;
          if (am) { akey = artKey(+am[1], am[2] ? +am[2] : 0); aEnd = end + am[0].length; mark(end, aEnd); }
          // "…법 제33조 및 제39조"처럼 이어지는 조 번호도 같은 대상을 가리킨다.
          let cm;
          const CHAIN_RE = /^(?:\s*(?:및|또는|내지|부터|와|과|,|·|ㆍ|~|∼)\s*제\s*\d+\s*조(?:\s*의\s*\d+)?(?:\s*제\s*\d+\s*[항호])*)+/;
          if ((cm = text.slice(aEnd).match(CHAIN_RE))) { mark(aEnd, aEnd + cm[0].length); aEnd += cm[0].length; }
          const after = text.slice(aEnd, aEnd + 80);
          // "~에 따라/의하여"는 대부분 요건·절차를 끌어 쓰는 단순 인용이다(예: "직원인사규정 제35조에
          // 의하여 표창을 받을 때"). 위임 문언이 있거나 제1조(목적)에서 근거로 든 경우만 '근거'로 본다.
          let type = classify(after);
          const explicit = /위\s*임/.test(text.slice(Math.max(0, start - 15), aEnd + 30));
          const purpose = /목적/.test(art.title) || art.key === '1';
          if (type === 'basis' && !explicit && !purpose) type = 'ref';
          const sentS = Math.max(text.lastIndexOf('.', start) + 1, text.lastIndexOf('\n', start) + 1, 0);
          let sentE = text.indexOf('.', aEnd); if (sentE < 0) sentE = text.length;
          const law = target ? null : index.laws.get(normTitle(name)) || null;
          edges.push({
            from: { rule, article: art },
            to: { name, rule: target, artKey: akey, article: target && akey ? findArticle(target, akey) : null },
            type,
            explicit,
            phrase: text.slice(sentS, Math.min(sentE + 1, sentS + 200)).trim(),
            external: !target && (!!(law && law.found) || EXTERNAL_LAW_RE.test(normTitle(name)) || EXTERNAL_NAME_RE.test(normTitle(name)) || GUIDELINE_RE.test(normTitle(name))),
            // 규정집 밖 문서의 종류: law(국가 법령) | guideline(지침·기준 등)
            outside: target ? '' : (law && law.found) || EXTERNAL_LAW_RE.test(normTitle(name)) || EXTERNAL_NAME_RE.test(normTitle(name)) ? 'law'
              : GUIDELINE_RE.test(normTitle(name)) ? 'guideline' : '',
            // 국가법령정보센터 확인 결과 (law_check.py로 만든 laws.json이 있을 때)
            law,
            pos: [start, aEnd],
          });
        };

        // 1) 「규정명」 형태의 명시 참조
        const br = /[「『]([^」』\n]{1,60})[」』]/g;
        let m;
        while ((m = br.exec(text))) {
          // 「청주대학교 학칙 제93조」처럼 괄호 안에 조 번호까지 쓴 경우
          const name = m[1].trim().replace(/\s*제\s*\d+\s*조(?:\s*의\s*\d+)?.*$/, '');
          const target = findRuleByName(index, name);
          if (target && target.id === rule.id) { mark(m.index, m.index + m[0].length); continue; }
          if (!target && !RULE_NAME_RE.test(normTitle(name))) continue;
          const inner = m[1].match(/제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/);
          pushEdge(name, m.index, m.index + m[0].length, target, inner ? artKey(+inner[1], inner[2] ? +inner[2] : 0) : '');
        }

        // 2) 괄호 없이 쓴 규정명 (DB에 있는 규정명과 일치하는 경우만)
        const compact = [];
        const posMap = [];
        for (let i = 0; i < text.length; i++) {
          if (!/\s/.test(text[i])) { compact.push(text[i]); posMap.push(i); }
        }
        const cstr = compact.join('');
        for (const { rule: target, norm, alias } of index.titlesByLen) {
          let from = 0, idx;
          while ((idx = cstr.indexOf(norm, from)) >= 0) {
            from = idx + norm.length;
            const s = posMap[idx], e = posMap[idx + norm.length - 1] + 1;
            if (masked[s] || masked[e - 1]) continue;
            // "학칙"이 "학칙시행세칙"의 일부로 쓰인 경우 등 단어 중간 매칭 배제
            const next = text.slice(e, e + 1);
            if (next && /[가-힣]/.test(next) && !/^[은는이가을를의에과와로으도만]/.test(next)) continue;
            // 자기 규정 이름(예: 대학원학칙 안의 "대학원 학칙")은 가려 두어 짧은 이름("학칙")으로 다시 잡히지 않게 한다.
            if (target.id === rule.id) { mark(s, e); continue; }
            // "학칙", "정관"처럼 앞말을 뺀 짧은 별칭은 일반 낱말로도 쓰이므로("학칙을 위반한") 조 번호가 따라올 때만 인용으로 본다.
            if (alias && norm.length <= 3 && !/^\s*(?:의\s*)?제\s*\d+\s*조/.test(text.slice(e, e + 12))) continue;
            // "본 학칙", "이 규정", "동 규정"은 다른 규정이 아니라 자기 자신(또는 앞서 든 규정)을 가리킨다.
            if (/(?:^|[\s(,“"'])(?:본|이|동)\s*$/.test(text.slice(Math.max(0, s - 4), s))) { mark(s, e); continue; }
            pushEdge(target.title, s, e, target);
          }
        }

        // 2-1) 괄호 없이 쓴 국가 법령명("고등교육법 제6조") — 국가법령정보센터에서 확인된 이름만
        for (const { norm, law } of index.lawNames) {
          let from = 0, idx;
          while ((idx = cstr.indexOf(norm, from)) >= 0) {
            from = idx + norm.length;
            const s = posMap[idx], e = posMap[idx + norm.length - 1] + 1;
            if (masked[s] || masked[e - 1] || /[가-힣·ㆍ]/.test(text.slice(s - 1, s))) continue;
            if (!/^\s*(?:의\s*)?제\s*\d+\s*조/.test(text.slice(e, e + 12))) continue;
            pushEdge(law.name, s, e, null);
            edges[edges.length - 1].law = law;
            edges[edges.length - 1].external = true;
            edges[edges.length - 1].outside = 'law';
          }
        }

        // 3) 같은 규정 내부 "제N조" 참조 (조문 형식이 아닌 규정은 제외)
        INTERNAL_ART_RE.lastIndex = 0;
        // 부칙의 "제N조"는 그 개정 당시의 조문을 가리키는 경과 규정이 많아 점검하지 않는다.
        while (art.key !== 'body' && !art.addenda && (m = INTERNAL_ART_RE.exec(text))) {
          if (masked[m.index]) continue;
          const before = text.slice(Math.max(0, m.index - 12), m.index).replace(/\s+/g, '');
          const self = /(?:이|본|같은)(?:규정|학칙|정관|세칙|지침|요령|내규|기준|회칙)$/.test(before);
          // 다른 규정·법령 이름(괄호 없이 쓴 것 포함)이나 "(이하 '영'이라 한다)" 뒤의 조문, "내지" 범위는 건너뛴다.
          if (!self && (/(?:법|령|영|규칙|규정|학칙|정관|세칙|지침|요령|내규|기준|분장|회칙|」|』|\)|내지|부터|및|또는|,|·|ㆍ)$/.test(before))) {
            // 앞의 조 번호와 이어진 경우 그 조도 같은 대상으로 처리
            const cm = text.slice(m.index).match(/^제\s*\d+\s*조(?:\s*의\s*\d+)?(?:(?:\s*(?:및|또는|내지|부터|와|과|,|·|ㆍ)\s*)제\s*\d+\s*조(?:\s*의\s*\d+)?)*/);
            mark(m.index, m.index + (cm ? cm[0].length : m[0].length));
            continue;
          }
          const key = artKey(+m[1], m[2] ? +m[2] : 0);
          internal.push({ rule, article: art, artKey: key, target: findArticle(rule, key), phrase: m[0], pos: [m.index, m.index + m[0].length] });
        }

        // 4) 대상을 특정하지 않은 위임
        UNNAMED_DELEGATION_RE.lastIndex = 0;
        while (!art.addenda && (m = UNNAMED_DELEGATION_RE.exec(text))) {
          if (masked[m.index]) continue;
          // 바로 앞에 「규정명」으로/에서가 있으면 이미 명시 위임으로 처리됨
          const before = text.slice(Math.max(0, m.index - 30), m.index);
          if (/[」』]\s*(?:으로|로|에서|에)\s*$/.test(before)) continue;
          const sentS = Math.max(text.lastIndexOf('.', m.index) + 1, text.lastIndexOf('\n', m.index) + 1, 0);
          const toHead = /^(?:총장|이사장|학장|대학원장|원장|처장|위원회|위원장|교무처장|기획처장)/.test(m[0]);
          unnamed.push({
            rule, article: art,
            // head: 총장 등에게 맡김, guideline: 지침·요령·기준으로 정하게 함(규정집 밖), rule: 세칙·내규 등 규정
            kind: toHead ? 'head' : /지침|요령|기준/.test(m[0]) ? 'guideline' : 'rule',
            phrase: text.slice(sentS, m.index + m[0].length).trim(),
          });
        }
      }
    }
    return { edges, unnamed, internal };
  }

  // 법령 조문 본문의 "<개정 2016.12.20, 2019.12.3>", "[본조신설 2014.1.28]" 표시 중 가장 최근 날짜 (YYYY.MM.DD)
  function lawAmendedAt(text) {
    let best = '';
    const tag = /[<\[]([^>\]]*?(?:개정|신설)[^>\]]*)[>\]]/g;
    let m;
    while ((m = tag.exec(String(text || '')))) {
      const dr = /(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/g;
      let d;
      while ((d = dr.exec(m[1]))) {
        const v = fmtDate(d);
        if (v > best) best = v;
      }
    }
    return best;
  }

  // 상위 규정 제N조가 하위 규정에 위임하는 내용을 담고 있는지
  function articleDelegates(article, lowerRule) {
    if (!article) return false;
    const s = article.text.replace(/\s+/g, '');
    if (lowerRule && s.includes(normTitle(lowerRule.title))) return true;
    return /정한다|정할수있다|정하며|정하고|정하되|위임|따로|별도/.test(s);
  }

  /**
   * 위임·참조 정합성 검증.
   * @returns {issues:[{level, type, rule, article, message, detail, edge}], stats}
   */
  function validate(index, analysis) {
    analysis = analysis || analyze(index);
    let issues = [];
    const DOWN = { error: 'warn', warn: 'info', info: 'info' };
    const add = (level, type, rule, article, message, detail, extra) => {
      if (article && article.addenda) {
        // 부칙은 개정 당시 기준의 경과 규정일 수 있어 한 단계 낮춰 알린다.
        level = DOWN[level];
        detail = `${detail} 부칙의 인용이라 개정 당시 기준일 수 있습니다.`;
      }
      issues.push(Object.assign({ level, type, rule, article, message, detail }, extra || {}));
    };

    // 하위 규정에서 받은 근거(역방향) 집계
    const inbound = new Map(); // `${ruleId}|${artKey}` -> [edge]
    for (const e of analysis.edges) {
      if (!e.to.rule || e.type !== 'basis') continue;
      const k = `${e.to.rule.id}|${e.to.artKey}`;
      if (!inbound.has(k)) inbound.set(k, []);
      inbound.get(k).push(e);
      const k2 = `${e.to.rule.id}|`;
      if (!inbound.has(k2)) inbound.set(k2, []);
      inbound.get(k2).push(e);
    }

    for (const e of analysis.edges) {
      const fr = e.from.rule, fa = e.from.article;
      if (e.to.rule && e.to.rule.abolished) {
        // "「…규정」은 폐지한다"처럼 폐지하는 조항 자체는 문제가 아니다.
        if (/폐\s*지/.test(e.phrase)) continue;
        add('error', 'abolished-ref', fr, fa, `폐지된 「${e.to.rule.title}」을 인용 (${e.to.rule.abolished} 폐지)`,
          '폐지된 규정을 아직 인용하고 있습니다. 대신하는 규정으로 바꾸거나 문구를 정리해야 하는지 확인이 필요합니다.', { edge: e });
        continue;
      }
      if (!e.to.rule) {
        const L = e.law;
        if (L && L.found) {
          // 국가법령정보센터에서 확인한 법령: 현행 여부와 인용한 조를 점검
          if (L.current === false) {
            add('warn', 'law-not-current', fr, fa, `「${L.name}」은 현행 법령이 아님`,
              '국가법령정보센터에 연혁 법령으로만 있습니다. 폐지되었거나 다른 법령으로 바뀌었는지 확인이 필요합니다.', { edge: e });
          }
          const a = e.to.artKey && L.articles ? L.articles[e.to.artKey] : null;
          if (a && a.missing) {
            add('error', 'law-article-missing', fr, fa, `「${L.name}」에 ${artLabel(e.to.artKey)}가 없음`,
              `국가법령정보센터의 현행 「${L.name}」에는 이 조가 없습니다. 법령 개정으로 조 번호가 바뀌었는지 확인이 필요합니다.`, { edge: e });
          } else if (a && a.deleted) {
            add('warn', 'law-article-deleted', fr, fa, `「${L.name}」 ${artLabel(e.to.artKey)}는 삭제된 조`,
              `현행 법령에서 삭제된 조를 인용하고 있습니다: ${a.text}`, { edge: e });
          } else if (a && !fa.addenda) {
            // 인용한 법령 조가 이 규정의 마지막 개정 뒤에 바뀌었으면 규정이 따라 바뀌어야 하는지 확인이 필요하다.
            const amended = lawAmendedAt(a.text);
            const ruleAt = fr.revised || fr.enacted;
            if (amended && ruleAt && amended > ruleAt) {
              add('warn', 'law-amended', fr, fa,
                `인용한 「${L.name}」 ${artLabel(e.to.artKey)}가 이 규정의 마지막 개정 뒤에 개정됨`,
                `법령 개정 ${amended} · 규정 ${fr.revised ? '개정' : '제정'} ${ruleAt}. 규정 내용이 현행 법령과 맞는지 확인이 필요합니다.`,
                { edge: e, amended });
            }
          }
          continue;
        }
        if (L && !L.found && !/규정$/.test(normTitle(e.to.name)) && !GUIDELINE_RE.test(normTitle(e.to.name))) {
          // 비슷한 현행 법령 중 인용한 것과 같은 단계(법률/시행령/시행규칙)를 먼저 권한다.
          const tier = n => (/시행령$/.test(n) ? 1 : /시행규칙$/.test(n) ? 2 : 0);
          const sim = (L.similar || []).slice().sort((a, b) =>
            (tier(normTitle(a)) !== tier(normTitle(e.to.name))) - (tier(normTitle(b)) !== tier(normTitle(e.to.name))));
          add('error', 'law-missing', fr, fa, `「${e.to.name}」을 규정집·국가법령정보센터 어디에서도 찾을 수 없음`,
            (sim.length ? `현행 명칭 확인 필요: 「${sim[0]}」일 수 있습니다.` : '법령 이름이 바뀌었거나 폐지되었을 수 있습니다.')
            + (sim.length > 1 ? ` (그 밖의 비슷한 법령: ${sim.slice(1, 4).join(', ')})` : ''), { edge: e });
          continue;
        }
        if (e.external) continue; // 고등교육법 등 외부 법령, 지침·기준 등 규정집 밖 문서는 검증 대상 아님
        add('error', 'missing-rule', fr, fa, `참조한 「${e.to.name}」 규정을 찾을 수 없음`,
          '규정명이 바뀌었거나 폐지된 규정을 인용하고 있을 수 있습니다.' + (L ? ' 국가법령정보센터에도 없습니다.' : ''), { edge: e });
        continue;
      }
      if (e.to.artKey && !e.to.article) {
        add('error', 'missing-article', fr, fa, `「${e.to.rule.title}」에 ${artLabel(e.to.artKey)}가 없음`,
          '조문 번호가 개정으로 변경되었는지 확인이 필요합니다.', { edge: e });
        continue;
      }
      if (e.type === 'basis' && e.to.article && !articleDelegates(e.to.article, fr)) {
        const at = `${e.to.article.no}${e.to.article.title ? '(' + e.to.article.title + ')' : ''}`;
        if (e.explicit) {
          // "제N조의 위임에 따라"라고 했는데 그 조에 위임 문언이 없는 경우
          add('warn', 'basis-mismatch', fr, fa,
            `위임 근거로 든 「${e.to.rule.title}」 ${e.to.article.no}에 위임 문언이 없음`,
            `"위임"을 근거로 들었으나 ${at}에는 이 규정이나 하위 규정에 정하도록 맡기는 내용이 없습니다. 조 번호가 바뀌었는지 확인이 필요합니다.`,
            { edge: e });
        } else {
          add('info', 'basis-weak', fr, fa,
            `근거 조항 「${e.to.rule.title}」 ${e.to.article.no}에 명시적 위임 문언 없음`,
            `목적 조항에서 근거로 든 ${at}에 "~으로 정한다" 같은 위임 문언은 없습니다. 기구 설치 조항 등 근거 규정으로는 적절할 수 있습니다.`,
            { edge: e });
        }
      }
      if (e.type === 'delegate') {
        // 상위 규정이 위임한 하위 규정이 실제로 그 조항을 근거로 두는지
        const back = analysis.edges.some(b => b.from.rule === e.to.rule && b.to.rule === fr);
        if (!back) {
          add('info', 'delegate-no-backref', fr, fa,
            `「${e.to.rule.title}」에 위임했으나 해당 규정에 「${fr.title}」 근거 문언이 없음`,
            '하위 규정 제1조(목적) 등에 위임 근거를 명시하면 위임 관계가 명확해집니다.', { edge: e });
        }
      }
    }

    for (const it of analysis.internal) {
      if (!it.target) {
        add('error', 'internal-missing', it.rule, it.article, `같은 규정 안의 ${artLabel(it.artKey)}가 없음`,
          `"${it.phrase}" 인용 대상이 이 규정에 존재하지 않습니다.`);
      }
    }

    for (const u of analysis.unnamed) {
      if (u.kind !== 'rule') continue; // 기관장 위임·지침 위임은 규정집에 하위 규정이 생기지 않음
      const got = inbound.get(`${u.rule.id}|${u.article.key}`);
      if (got && got.length) continue;
      const stem = normTitle(u.rule.title);
      const guess = index.rules.find(r => r !== u.rule && normTitle(r.title).startsWith(stem) && /세칙|지침|요령|내규|기준/.test(r.title));
      add('info', 'unresolved-delegation', u.rule, u.article,
        guess ? `위임 사항의 하위 규정 추정: 「${guess.title}」` : '위임한 하위 규정(세칙·내규 등)을 확인할 수 없음',
        `"${u.phrase}"` + (guess ? ' — 하위 규정에 근거 조항 표기가 없어 이름으로 추정했습니다.' : ''),
        { guess });
    }

    // 한 조에서 같은 대상을 여러 번 인용해 생긴 같은 지적은 하나로. 폐지된 규정 자체는 점검하지 않는다.
    const seenIssue = new Set();
    issues = issues.filter(i => {
      if (i.rule.abolished) return false;
      const k = `${i.rule.id}|${i.article.key}|${i.type}|${i.message}`;
      if (seenIssue.has(k)) return false;
      seenIssue.add(k);
      return true;
    });
    const order = { error: 0, warn: 1, info: 2 };
    issues.sort((a, b) => order[a.level] - order[b.level] || a.rule.title.localeCompare(b.rule.title, 'ko'));
    const stats = {
      edges: analysis.edges.length,
      delegate: analysis.edges.filter(e => e.type === 'delegate').length,
      basis: analysis.edges.filter(e => e.type === 'basis').length,
      apply: analysis.edges.filter(e => e.type === 'apply').length,
      external: analysis.edges.filter(e => e.outside === 'law').length,
      guideline: analysis.edges.filter(e => e.outside === 'guideline').length,
      abolished: index.rules.filter(r => r.abolished).length,
      unnamed: analysis.unnamed.length,
      error: issues.filter(i => i.level === 'error').length,
      warn: issues.filter(i => i.level === 'warn').length,
      info: issues.filter(i => i.level === 'info').length,
    };
    return { issues, stats, analysis };
  }

  /**
   * 규정 단위 위임 관계(상위/하위) 요약
   */
  function relations(analysis, rule) {
    const parents = new Map(); // 이 규정이 근거로 삼거나 이 규정에 위임한 상위 규정
    const children = new Map(); // 이 규정이 위임하거나 이 규정을 근거로 삼는 하위 규정
    const others = new Map();
    const push = (map, r, e) => { if (!map.has(r.id)) map.set(r.id, { rule: r, edges: [] }); map.get(r.id).edges.push(e); };
    for (const e of analysis.edges) {
      if (!e.to.rule) continue;
      if (e.from.rule === rule) {
        if (e.type === 'basis') push(parents, e.to.rule, e);
        else if (e.type === 'delegate') push(children, e.to.rule, e);
        else push(others, e.to.rule, e);
      } else if (e.to.rule === rule) {
        if (e.type === 'basis') push(children, e.from.rule, e);
        else if (e.type === 'delegate') push(parents, e.from.rule, e);
        else push(others, e.from.rule, e);
      }
    }
    for (const id of parents.keys()) { children.delete(id); others.delete(id); }
    for (const id of children.keys()) others.delete(id);
    return {
      parents: [...parents.values()],
      children: [...children.values()],
      others: [...others.values()],
      external: analysis.edges.filter(e => e.from.rule === rule && !e.to.rule),
      unnamed: analysis.unnamed.filter(u => u.rule === rule),
    };
  }

  /* ---------- 동일·유사 조항 ---------- */

  const K = 4;

  function normBody(text) {
    return String(text || '')
      .replace(/[①-⑳㉑-㉟]/g, '')
      .replace(/^\s*\d+\.\s*/gm, '')
      .replace(/^\s*[가-하]\.\s*/gm, '')
      .replace(/[\s.,·:;'"“”‘’()（）「」『』\[\]<>〈〉-]/g, '');
  }

  function shingles(s) {
    const set = new Set();
    for (let i = 0; i + K <= s.length; i++) {
      let h = 0;
      for (let j = i; j < i + K; j++) h = (h * 31 + s.charCodeAt(j)) | 0;
      set.add(h);
    }
    return set;
  }

  // 조문을 항(①②…) 단위로 나눈다. 항이 없으면 조문 전체가 한 단위.
  function paragraphs(text) {
    const parts = String(text || '').split(/(?=[①-⑳㉑-㉟])/).map(t => t.trim()).filter(Boolean);
    return parts.length ? parts : [''];
  }

  const MIN_BODY = 15; // "목적", "시행일" 같은 짧은 문장은 비교 대상에서 제외

  function makeItem(article, rule, text) {
    const body = normBody(text);
    return { article, rule, text, body, sh: shingles(body) };
  }

  function prepare(index) {
    if (index._prep) return index._prep;
    const items = [];
    for (const a of index.articles) {
      const rule = index.byId.get(a.ruleId);
      if (rule.abolished) continue; // 폐지된 규정은 중복 비교에서 뺀다
      const paras = paragraphs(a.text);
      if (paras.length > 1) {
        const whole = makeItem(a, rule, a.text);
        if (whole.body.length >= MIN_BODY) items.push(whole);
      }
      for (const p of paras) {
        const it = makeItem(a, rule, p);
        if (it.body.length >= MIN_BODY) items.push(it);
      }
    }
    const posting = new Map();
    items.forEach((it, i) => it.sh.forEach(h => {
      if (!posting.has(h)) posting.set(h, []);
      posting.get(h).push(i);
    }));
    index._prep = { items, posting };
    return index._prep;
  }

  function sim(a, b) {
    if (a.body === b.body) return { jaccard: 1, contain: 1 };
    let inter = 0;
    const [small, big] = a.sh.size <= b.sh.size ? [a.sh, b.sh] : [b.sh, a.sh];
    small.forEach(h => { if (big.has(h)) inter++; });
    return {
      jaccard: inter / (a.sh.size + b.sh.size - inter || 1),
      contain: inter / (small.size || 1),
    };
  }

  // 조문 쌍마다 가장 비슷한 단위(조 전체 또는 항)만 남긴다.
  function keepBest(map, a, b, s) {
    const [x, y] = a.article.ruleId + a.article.key <= b.article.ruleId + b.article.key ? [a, b] : [b, a];
    const k = `${x.article.ruleId}|${x.article.key}|${y.article.ruleId}|${y.article.key}`;
    const score = Math.max(s.jaccard, s.contain);
    const prev = map.get(k);
    if (prev && (prev.score > score || (prev.score === score && prev.jaccard >= s.jaccard))) return;
    map.set(k, {
      a: x.article, b: y.article, ruleA: x.rule, ruleB: y.rule, textA: x.text, textB: y.text,
      jaccard: s.jaccard, contain: s.contain, score, identical: x.body === y.body,
    });
  }

  /**
   * 서로 다른 규정 사이에서 동일·유사 조항(항 단위 포함) 쌍을 찾는다.
   * @param opts.threshold  유사도 하한 (0~1). 자카드 유사도 또는 포함률(한쪽이 다른 쪽에 들어 있는 정도)
   * @param opts.sameRule   같은 규정 내부 쌍도 포함할지
   * @param opts.ruleA/ruleB 두 규정만 비교
   */
  function findSimilarPairs(index, opts) {
    opts = Object.assign({ threshold: 0.6, sameRule: false, ruleA: null, ruleB: null }, opts);
    const { items, posting } = prepare(index);
    const maxDf = Math.max(25, Math.floor(items.length * 0.01)); // 너무 흔한 문자열 조각은 후보 탐색에서 제외
    const containMin = Math.max(opts.threshold, 0.8);
    const best = new Map();
    const pick = it => !opts.ruleA || it.rule.id === opts.ruleA || it.rule.id === opts.ruleB;
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      if (!pick(a)) continue;
      const counts = new Map();
      a.sh.forEach(h => {
        const p = posting.get(h);
        if (p.length > maxDf) return;
        for (const j of p) if (j > i) counts.set(j, (counts.get(j) || 0) + 1);
      });
      counts.forEach((c, j) => {
        if (c < 3) return;
        const b = items[j];
        if (a.article === b.article) return;
        if (!opts.sameRule && a.rule.id === b.rule.id) return;
        if (opts.ruleA && (!pick(b) || a.rule.id === b.rule.id)) return;
        const s = sim(a, b);
        // 한쪽 문장이 다른 쪽에 거의 그대로 들어 있는 경우(포함 관계)도 동일 내용으로 본다.
        if (s.jaccard >= opts.threshold || s.contain >= containMin) keepBest(best, a, b, s);
      });
    }
    return [...best.values()].sort((x, y) => y.score - x.score || y.jaccard - x.jaccard);
  }

  // 특정 조항과 유사한 조항 검색
  function similarTo(index, article, opts) {
    opts = Object.assign({ threshold: 0.35, limit: 30 }, opts);
    const { items } = prepare(index);
    const rule = index.byId.get(article.ruleId);
    const mine = [makeItem(article, rule, article.text)].concat(paragraphs(article.text).length > 1 ? paragraphs(article.text).map(p => makeItem(article, rule, p)) : [])
      .filter(it => it.body.length >= MIN_BODY);
    const best = new Map();
    for (const me of mine) {
      for (const it of items) {
        if (it.article === article) continue;
        const s = sim(me, it);
        if (s.jaccard >= opts.threshold || s.contain >= 0.8) keepBest(best, me, it, s);
      }
    }
    // 기준 조문이 항상 a 쪽에 오도록 정리
    return [...best.values()].map(p => p.a === article ? p
      : Object.assign({}, p, { a: p.b, b: p.a, ruleA: p.ruleB, ruleB: p.ruleA, textA: p.textB, textB: p.textA }))
      .sort((a, b) => b.score - a.score).slice(0, opts.limit);
  }

  // 규정 쌍별로 묶기
  function groupPairs(pairs) {
    const g = new Map();
    for (const p of pairs) {
      const [r1, r2] = p.ruleA.title <= p.ruleB.title ? [p.ruleA, p.ruleB] : [p.ruleB, p.ruleA];
      const k = `${r1.id}|${r2.id}`;
      if (!g.has(k)) g.set(k, { r1, r2, pairs: [], identical: 0 });
      const item = g.get(k);
      item.pairs.push(p.ruleA === r1 ? p : Object.assign({}, p, { a: p.b, b: p.a, ruleA: r1, ruleB: r2, textA: p.textB, textB: p.textA }));
      if (p.identical) item.identical++;
    }
    return [...g.values()].sort((a, b) => b.pairs.length - a.pairs.length || b.identical - a.identical);
  }

  /* ---------- 개정 전후 비교 (신구대비) ---------- */

  /**
   * 같은 규정의 이전·이후 전문을 조(부칙 포함) 단위로 맞대어 바뀐 조만 돌려준다.
   * @returns {before, after, rows:[{key, no, title, status:'added'|'removed'|'modified', before, after}]}
   */
  function compareRuleTexts(title, beforeText, afterText) {
    const b = beforeText ? normalizeRule({ title, text: beforeText }, 0) : null;
    const a = afterText ? normalizeRule({ title, text: afterText }, 0) : null;
    const units = r => (r ? r.articles.concat(r.addendaUnits || []) : []);
    const bm = new Map(units(b).map(u => [u.key, u]));
    const am = new Map(units(a).map(u => [u.key, u]));
    const label = u => `${u.no}${u.title ? '(' + u.title + ')' : ''}`;
    const rows = [];
    for (const u of units(a)) {
      const o = bm.get(u.key);
      if (!o) rows.push({ key: u.key, no: u.no, title: u.title, status: 'added', before: '', after: u.text });
      else if (o.text !== u.text || o.title !== u.title) {
        rows.push({ key: u.key, no: u.no, title: u.title, status: 'modified', before: o.text, after: u.text,
          beforeLabel: label(o), afterLabel: label(u) });
      }
    }
    for (const u of units(b)) {
      if (!am.has(u.key)) rows.push({ key: u.key, no: u.no, title: u.title, status: 'removed', before: u.text, after: '' });
    }
    return { before: b, after: a, rows };
  }

  /* ---------- 차이 비교 ---------- */

  function tokenize(s) {
    return String(s).match(/\d+(?:\.\d+)?|[가-힣]+|[A-Za-z]+|\s+|./g) || [];
  }

  /** 토큰 단위 LCS diff → [{op:'=', '-', '+', text}] */
  function diff(a, b) {
    const x = tokenize(a), y = tokenize(b);
    const n = x.length, m = y.length;
    if (n * m > 4e6) return [{ op: '-', text: a }, { op: '+', text: b }];
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    const push = (op, t) => {
      const last = out[out.length - 1];
      if (last && last.op === op) last.text += t; else out.push({ op, text: t });
    };
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { push('=', x[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) push('-', x[i++]);
      else push('+', y[j++]);
    }
    while (i < n) push('-', x[i++]);
    while (j < m) push('+', y[j++]);
    return out;
  }

  // 유사 조항 사이의 숫자(기간·금액·학점 등) 불일치
  function numberConflicts(a, b) {
    const nums = s => (String(s).match(/\d+(?:\.\d+)?\s*(?:년|개월|월|일|주|시간|학점|점|명|원|만원|%|퍼센트|회|학기|분의)/g) || []).map(t => t.replace(/\s+/g, ''));
    const na = nums(a), nb = nums(b);
    const sa = new Set(na), sb = new Set(nb);
    return { onlyA: na.filter(t => !sb.has(t)), onlyB: nb.filter(t => !sa.has(t)) };
  }

  /* ---------- 상위법 기준 비교 ---------- */

  const AMOUNT_RE = /(\d+(?:\.\d+)?)\s*(개월|년|주|일|세)/g;
  const FOLLOWS_RE = /준용|(?:에|을|를)\s*따른다|에\s*의한다|에서\s*정하는\s*바에\s*따/;

  // "1년"·"6개월"·90 → {n, unit, text}. 기간은 개월로 맞춰 비교한다.
  function amount(n, u) {
    n = Number(n);
    if (u === '년') return { n: n * 12, unit: '기간', text: n + '년' };
    if (u === '개월') return { n, unit: '기간', text: n + '개월' };
    if (u === '주') return { n: n * 7, unit: '일', text: n + '주', week: true };
    if (u === '세') return { n, unit: '세', text: n + '세' };
    return { n, unit: '일', text: n + '일' };
  }

  function catalogAmount(v, unit) {
    if (v == null) return null;
    const m = String(v).match(/^(\d+(?:\.\d+)?)\s*(개월|년|주|일|세)?$/);
    if (!m) return null;
    return amount(m[1], m[2] || (unit === '세' ? '세' : unit === '기간' ? '개월' : '일'));
  }

  function unitOk(a, unit) {
    return a.unit === unit || (unit === '일' && a.week);
  }

  /** 줄에서 clause가 처음 나온 곳 뒤의 가장 가까운 숫자, 없으면 앞의 가장 가까운 숫자 */
  function amountNear(line, clauseRe, unit) {
    const m = clauseRe.exec(line);
    if (!m) return null;
    const all = [];
    AMOUNT_RE.lastIndex = 0;
    let t;
    while ((t = AMOUNT_RE.exec(line))) {
      const a = amount(t[1], t[2]);
      if (unitOk(a, unit)) all.push(Object.assign(a, { pos: t.index }));
    }
    const after = all.find(a => a.pos >= m.index);
    const before = all.filter(a => a.pos < m.index).pop();
    return { match: m, value: after || before || null };
  }

  // 줄에 다른 대상만 적혀 있으면("교원의 정년은…") 그 대상의 기준과만 비교한다.
  function lineGroupOk(line, group) {
    if (group === '공통') return true;
    const other = group === '교원' ? /직원/ : /교원|교수|강사/;
    const own = group === '교원' ? /교원|교수|강사/ : /직원/;
    return !other.test(line) || own.test(line) || /교직원/.test(line);
  }

  function findAmount(text, check, ruleSide, group) {
    const re = new RegExp((ruleSide && check.ruleClause) || check.clause);
    const not = check.not ? new RegExp(check.not) : null;
    let follows = null;
    for (const line of String(text || '').split('\n')) {
      if (not && not.test(line)) continue;
      if (ruleSide && group && !lineGroupOk(line, group)) continue;
      const r = amountNear(line, re, check.unit);
      if (!r) continue;
      if (r.value) return { value: r.value, line: line.trim() };
      if (!follows && ruleSide && FOLLOWS_RE.test(line)) follows = line.trim();
    }
    return follows ? { follows, line: follows } : null;
  }

  function wideCandidates(index, check, cand) {
    const re = new RegExp(check.ruleClause || check.clause);
    const seen = new Set(cand.map(c => c.article));
    const out = [];
    for (const r of index.rules) {
      if (r.abolished) continue;
      for (const a of r.articles) if (!a.addenda && !seen.has(a) && re.test(a.text)) out.push({ rule: r, article: a, group: ruleGroup(r.title) });
    }
    return out;
  }

  function ruleGroup(title) {
    if (/교원|교수|강사|교육공무원/.test(title)) return '교원';
    if (/직원/.test(title)) return '직원';
    return '공통';
  }

  /**
   * 규정을 상위 법령 기준(topics.json)과 비교한다.
   * @param topics topics.json의 topics
   * @returns [{topic, refs: [{ref, law, article, checks: [{check, law: {value, line, source}, rows: [{rule, article, value, line, status}]}]}], candidates}]
   * status: ok(같음) | worse(법 기준 미달) | better(법보다 유리) | diff(법과 다름) | ref-diff(참고 기준과 다름) | follows(법령 준용)
   */
  function conformance(index, topics) {
    const out = [];
    for (const topic of topics || []) {
      const findRe = new RegExp(topic.find);
      const cand = [];
      for (const r of index.rules) {
        if (r.abolished) continue;
        for (const a of r.articles) {
          if (a.addenda) continue;
          if (findRe.test(a.title || '') || findRe.test(a.text)) cand.push({ rule: r, article: a, group: ruleGroup(r.title) });
        }
      }
      const res = { topic, refs: [], candidates: cand };
      for (const ref of topic.refs || []) {
        const law = index.laws.get(normTitle(ref.law)) || null;
        const lawArt = law && law.found && law.articles ? law.articles[ref.article] : null;
        const lawText = lawArt && !lawArt.missing ? lawArt.text : '';
        const R = { ref, law, article: lawArt && !lawArt.missing ? lawArt : null, checks: [] };
        for (const check of ref.checks || []) {
          const got = lawText ? findAmount(lawText, check, false) : null;
          const lv = got && got.value
            ? { value: got.value, line: got.line, source: 'law' }
            : { value: catalogAmount(check.value, check.unit), line: '', source: 'catalog' };
          const rows = [];
          // wide: 조 제목·본문에 주제어가 없어도 규정 쪽 문구만으로 찾는다(예: "자녀 1명에 대하여 3년")
          const pool = check.wide ? cand.concat(wideCandidates(index, check, cand)) : cand;
          for (const c of pool) {
            if (ref.group !== '공통' && c.group !== '공통' && c.group !== ref.group) continue;
            const f = findAmount(c.article.text, check, true, ref.group);
            if (!f) continue;
            let status = 'follows';
            if (f.value && lv.value) {
              const d = f.value.n - lv.value.n;
              status = d === 0 ? 'ok' : ref.kind === 'min' ? (d < 0 ? 'worse' : 'better') : ref.kind === 'eq' ? 'diff' : 'ref-diff';
            } else if (f.value) status = 'unknown';
            rows.push({ rule: c.rule, article: c.article, value: f.value || null, line: f.line, status });
          }
          R.checks.push({ check, law: lv, rows });
        }
        res.refs.push(R);
      }
      out.push(res);
    }
    return out;
  }

  /* ---------- 규정 ↔ 상위법 조문 대조 ---------- */

  // 개정 표시("(변경 2019. 5. 7.)", "<개정 2020. 1. 1.>", "[본조신설 …]")는 비교에서 뺀다.
  function stripNotes(text) {
    return String(text || '')
      .replace(/<[^<>\n]{0,60}>/g, '')
      .replace(/\[[^\[\]\n]{0,60}\]/g, '')
      .replace(/\(\s*(?:조명\s*)?(?:변경|신설|개정|삭제|본조신설|본조전문변경|전문개정|단서조항\s*신설)[^()\n]{0,80}\)/g, '');
  }

  function lawBody(text) {
    return stripNotes(text).replace(/^\s*제\s*\d+\s*조(?:\s*의\s*\d+)?\s*(?:\([^)\n]*\))?\s*/, '').trim();
  }

  /**
   * 규정과 관련된 상위 법령 목록.
   * 이유: cite(인용) | basis(목적 조항의 근거) | topic(주제 기준) | area(분야별 기본 법령)
   * @returns [{key, name, law, reasons: [{kind, label}], articles: [조키]}]
   */
  function relatedLaws(index, rule, analysis, catalog) {
    const keyOf = new Map([...index.laws].map(([k, v]) => [v, k]));
    const out = new Map();
    const add = (key, name, kind, label, art) => {
      if (!out.has(key)) out.set(key, { key, name, law: index.laws.get(key) || null, reasons: [], articles: [] });
      const it = out.get(key);
      if (!it.reasons.some(r => r.kind === kind && r.label === label)) it.reasons.push({ kind, label });
      if (art && !it.articles.includes(art)) it.articles.push(art);
    };
    for (const e of analysis.edges) {
      if (e.from.rule !== rule || e.to.rule || e.from.article.addenda) continue;
      if (!e.law && e.outside !== 'law') continue;
      const key = e.law ? keyOf.get(e.law) : normTitle(e.to.name);
      const name = (e.law && e.law.name) || e.to.name;
      const purpose = /목적/.test(e.from.article.title) || e.from.article.key === '1';
      add(key, name, purpose ? 'basis' : 'cite', purpose ? '근거 법령' : '인용', e.to.artKey);
    }
    if (catalog) {
      for (const t of conformance(index, catalog.topics || [])) {
        for (const R of t.refs) {
          if (R.checks.some(c => c.rows.some(w => w.rule === rule))) add(normTitle(R.ref.law), R.ref.law, 'topic', t.topic.name, R.ref.article);
        }
      }
      for (const a of catalog.areas || []) {
        if (new RegExp(a.match).test(rule.title)) for (const name of a.laws) add(normTitle(name), name, 'area', a.name);
      }
    }
    const rank = it => Math.min(...it.reasons.map(r => ({ basis: 0, cite: 1, topic: 2, area: 3 })[r.kind]));
    return [...out.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ko'));
  }

  /**
   * 규정 조문을 상위 법령 조문과 대조한다.
   * @param texts Map(법령 키 → {name, articles: {조키: {no, title, text, deleted}}}) — 전체 조문(없으면 laws.json의 인용 조문)
   * @returns {citations: [...], similar: [...]}
   *   citations: 규정이 인용한 법 조문과 나란히 보기 {article, lawKey, lawName, lawArt, ruleText, lawText, nums}
   *   similar: 문장이 비슷한 법 조문 {article, lawKey, lawName, lawArt, ruleText, lawText, score, identical, nums, numDiff}
   */
  function compareWithLaws(index, rule, analysis, texts, opts) {
    opts = Object.assign({ threshold: 0.3, contain: 0.6, perArticle: 2 }, opts);
    const keyOf = new Map([...index.laws].map(([k, v]) => [v, k]));
    const nums = (a, b) => {
      const n = numberConflicts(a, b);
      return Object.assign(n, { differ: n.onlyA.length > 0 && n.onlyB.length > 0 });
    };
    const citations = [];
    const seen = new Set();
    for (const e of analysis.edges) {
      if (e.from.rule !== rule || !e.law || !e.to.artKey || e.from.article.addenda) continue;
      const key = keyOf.get(e.law);
      if (!texts.has(key)) continue;
      const k = `${e.from.article.key}|${key}|${e.to.artKey}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const L = texts.get(key);
      const lawArt = (L.articles && L.articles[e.to.artKey]) || null;
      const ruleText = stripNotes(e.from.article.text).trim();
      const lawText = lawArt && !lawArt.missing ? lawBody(lawArt.text) : '';
      citations.push({ article: e.from.article, lawKey: key, lawName: L.name || e.law.name, artKey: e.to.artKey, lawArt, ruleText, lawText,
        phrase: e.phrase, nums: lawText ? nums(ruleText, lawText) : null });
    }

    // 법 조문(항 단위) 색인
    const lawItems = [];
    const posting = new Map();
    for (const [key, L] of texts) {
      for (const [ak, la] of Object.entries(L.articles || {})) {
        if (!la || la.missing || la.deleted) continue;
        const body = lawBody(la.text);
        const paras = paragraphs(body);
        const units = paras.length > 1 ? [body].concat(paras) : paras;
        for (const p of units) {
          const it = { key, name: L.name, ak, la, text: p, body: normBody(p) };
          if (it.body.length < 25) continue;
          it.sh = shingles(it.body);
          const idx = lawItems.push(it) - 1;
          it.sh.forEach(h => { if (!posting.has(h)) posting.set(h, []); posting.get(h).push(idx); });
        }
      }
    }
    const maxDf = Math.max(30, Math.floor(lawItems.length * 0.05));
    const similar = [];
    for (const art of rule.articles) {
      const clean = stripNotes(art.text);
      const paras = paragraphs(clean);
      const units = paras.length > 1 ? [clean].concat(paras) : paras;
      const best = new Map(); // 법 조문별 가장 비슷한 단위
      for (const p of units) {
        const me = { body: normBody(p), text: p.trim() };
        if (me.body.length < 25) continue;
        me.sh = shingles(me.body);
        const counts = new Map();
        me.sh.forEach(h => {
          const ps = posting.get(h);
          if (!ps || ps.length > maxDf) return;
          for (const j of ps) counts.set(j, (counts.get(j) || 0) + 1);
        });
        counts.forEach((c, j) => {
          if (c < 4) return;
          const it = lawItems[j];
          const s = sim(me, it);
          if (s.jaccard < opts.threshold && s.contain < opts.contain) return;
          const score = Math.max(s.jaccard, s.contain * 0.9);
          const k = `${it.key}|${it.ak}`;
          const prev = best.get(k);
          if (!prev || prev.score < score) best.set(k, { me, it, s, score });
        });
      }
      [...best.values()].sort((a, b) => b.score - a.score).slice(0, opts.perArticle).forEach(b => {
        const n = nums(b.me.text, b.it.text);
        similar.push({ article: art, lawKey: b.it.key, lawName: b.it.name, artKey: b.it.ak, lawArt: b.it.la,
          ruleText: b.me.text, lawText: b.it.text, score: b.score, identical: b.me.body === b.it.body, nums: n, numDiff: n.differ });
      });
    }
    similar.sort((a, b) => (b.numDiff - a.numDiff) || b.score - a.score);
    return { citations, similar };
  }

  return {
    conformance, relatedLaws, compareWithLaws,
    normTitle, looseRegex, escapeRegex, artKey, artLabel,
    parseRuleText, normalizeRule, buildIndex, findRuleByName, findArticle,
    parseQuery, makeMatchers, search, snippet,
    analyze, validate, relations, classify, lawAmendedAt, compareRuleTexts,
    findSimilarPairs, similarTo, groupPairs, diff, numberConflicts,
  };
});
