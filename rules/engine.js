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

    return Object.assign({}, meta, {
      title,
      preamble: meta.preamble != null ? meta.preamble
        : preLines.filter(l => l !== title && !/^(제개정\s*내역\s*보기|내용\s*보기)$/.test(l)).join('\n'),
      articles,
      addenda: meta.addenda != null ? meta.addenda : addenda.join('\n').trim(),
      enacted,
      revised,
    });
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
      id: String(rule.id || rule.seq || `r${i}`),
      title: String(rule.title || '(제목 없음)').trim(),
      category: rule.category || '',
      code: rule.code || '',
      url: rule.url || '',
      enacted: rule.enacted || '',
      revised: rule.revised || '',
      preamble: articles.length === 1 && articles[0].key === 'body' ? '' : rule.preamble || '',
      addenda: rule.addenda || '',
      articles,
    };
  }

  /* ---------- 인덱스 ---------- */

  function buildIndex(rules) {
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
    return { rules, byId, byTitle, titlesByLen, articles };
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
        for (const a of rule.articles) {
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
      for (const art of rule.articles) {
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
          edges.push({
            from: { rule, article: art },
            to: { name, rule: target, artKey: akey, article: target && akey ? findArticle(target, akey) : null },
            type,
            explicit,
            phrase: text.slice(sentS, Math.min(sentE + 1, sentS + 200)).trim(),
            external: !target && (EXTERNAL_LAW_RE.test(normTitle(name)) || EXTERNAL_NAME_RE.test(normTitle(name))),
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

        // 3) 같은 규정 내부 "제N조" 참조 (조문 형식이 아닌 규정은 제외)
        INTERNAL_ART_RE.lastIndex = 0;
        while (art.key !== 'body' && (m = INTERNAL_ART_RE.exec(text))) {
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
        while ((m = UNNAMED_DELEGATION_RE.exec(text))) {
          if (masked[m.index]) continue;
          // 바로 앞에 「규정명」으로/에서가 있으면 이미 명시 위임으로 처리됨
          const before = text.slice(Math.max(0, m.index - 30), m.index);
          if (/[」』]\s*(?:으로|로|에서|에)\s*$/.test(before)) continue;
          const sentS = Math.max(text.lastIndexOf('.', m.index) + 1, text.lastIndexOf('\n', m.index) + 1, 0);
          const toHead = /^(?:총장|이사장|학장|대학원장|원장|처장|위원회|위원장|교무처장|기획처장)/.test(m[0]);
          unnamed.push({
            rule, article: art,
            kind: toHead ? 'head' : 'rule',
            phrase: text.slice(sentS, m.index + m[0].length).trim(),
          });
        }
      }
    }
    return { edges, unnamed, internal };
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
    const add = (level, type, rule, article, message, detail, extra) =>
      issues.push(Object.assign({ level, type, rule, article, message, detail }, extra || {}));

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
      if (!e.to.rule) {
        if (e.external) continue; // 고등교육법 등 외부 법령은 검증 대상 아님
        add('error', 'missing-rule', fr, fa, `참조한 「${e.to.name}」 규정을 찾을 수 없음`,
          '규정명이 바뀌었거나 폐지된 규정을 인용하고 있을 수 있습니다.', { edge: e });
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
      if (u.kind === 'head') continue; // 총장 등 기관장 위임은 규정 제정 의무가 아님
      const got = inbound.get(`${u.rule.id}|${u.article.key}`);
      if (got && got.length) continue;
      const stem = normTitle(u.rule.title);
      const guess = index.rules.find(r => r !== u.rule && normTitle(r.title).startsWith(stem) && /세칙|지침|요령|내규|기준/.test(r.title));
      add('info', 'unresolved-delegation', u.rule, u.article,
        guess ? `위임 사항의 하위 규정 추정: 「${guess.title}」` : '위임한 하위 규정(세칙·지침 등)을 확인할 수 없음',
        `"${u.phrase}"` + (guess ? ' — 하위 규정에 근거 조항 표기가 없어 이름으로 추정했습니다.' : ''),
        { guess });
    }

    // 한 조에서 같은 대상을 여러 번 인용해 생긴 같은 지적은 하나로
    const seenIssue = new Set();
    issues = issues.filter(i => {
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
      external: analysis.edges.filter(e => e.external).length,
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

  return {
    normTitle, looseRegex, escapeRegex, artKey, artLabel,
    parseRuleText, normalizeRule, buildIndex, findRuleByName, findArticle,
    parseQuery, makeMatchers, search, snippet,
    analyze, validate, relations, classify,
    findSimilarPairs, similarTo, groupPairs, diff, numberConflicts,
  };
});
