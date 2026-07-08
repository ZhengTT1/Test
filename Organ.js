// ==UserScript==
// @name         RPG 状态栏 - 器官系统
// @namespace    http://tampermonkey.net/
// @version      3.0.0
// @description  器官系统模块（独立运行版，不依赖主脚本）
// @author       Niccole
// @match        */*
// @grant        none
// ==/UserScript==
!(function() {
  "use strict";
  let $ = window.jQuery || (window.parent && window.parent.jQuery);
  const SCRIPT_ID = "rpg_status_bar";
  let mvuWriteQueue = Promise.resolve();
  let _mvuQueueLen = 0;

  const getCore = () => {
    try {
      const win = window.parent || window;
      const jQueryInstance = window.jQuery || win.jQuery;
      return { window: win, $: jQueryInstance, getDB: () => win.AutoCardUpdaterAPI || window.AutoCardUpdaterAPI };
    } catch (e) {
      return { window: window, $: window.jQuery, getDB: () => window.AutoCardUpdaterAPI };
    }
  };

  const mvuState = {
    ready: false,
    mvu: null,
    check: () => {
      const win = getCore().window;
      if (typeof win.Mvu === 'undefined') { mvuState.ready = false; mvuState.mvu = null; return false; }
      if (typeof win.Mvu.getMvuData !== 'function' || typeof win.Mvu.replaceMvuData !== 'function') { mvuState.ready = false; mvuState.mvu = null; return false; }
      mvuState.ready = true;
      mvuState.mvu = win.Mvu;
      return true;
    }
  };

  const decodeJsonPointerToken = (token) => String(token || '').replace(/~1/g, '/').replace(/~0/g, '~');

  const splitPatchPath = (path) => {
    const rawParts = String(path || '').split('/').filter(Boolean);
    const parts = rawParts.map(decodeJsonPointerToken);
    if (!parts.length) return parts;
    const dynamicKeyRules = [
      { prefix: ['人物', '装备列表'], suffixMin: 1 },
      { prefix: ['人物', '背包', '道具'], suffixMin: 0 },
      { prefix: ['人物', '主动技能槽'], suffixMin: 1 },
      { prefix: ['人物', '觉醒技能槽'], suffixMin: 1 },
      { prefix: ['人物', '连携奥义槽'], suffixMin: 1 },
      { prefix: ['人物', '技能树', '技能列表'], suffixMin: 1 },
      { prefix: ['任务列表'], suffixMin: 0 },
      { prefix: ['羁绊列表'], suffixMin: 0 }
    ];
    for (const rule of dynamicKeyRules) {
      const { prefix, suffixMin } = rule;
      if (parts.length < prefix.length + suffixMin + 1) continue;
      const isMatch = prefix.every((seg, idx) => parts[idx] === seg);
      if (!isMatch) continue;
      const keyStart = prefix.length;
      const keyEnd = parts.length - suffixMin;
      if (keyEnd <= keyStart) continue;
      const key = parts.slice(keyStart, keyEnd).join('/');
      const suffix = parts.slice(keyEnd);
      return [...prefix, key, ...suffix];
    }
    return parts;
  };

  const enqueueMvuWrite = (writeTask) => {
    _mvuQueueLen++;
    const task = mvuWriteQueue.then(() => writeTask(), () => writeTask());
    mvuWriteQueue = task.catch(() => undefined);
    task.finally(() => {
      _mvuQueueLen--;
      if (_mvuQueueLen <= 0) { _mvuQueueLen = 0; mvuWriteQueue = Promise.resolve(); }
    });
    return task;
  };

  // 监听 Mvu 变量变化，自动刷新器官面板
  const setupMvuListener = () => {
    const tryBind = () => {
      if (!mvuState.check()) return false;
      const win = getCore().window;
      if (typeof win.eventOn !== 'function' || !mvuState.mvu || !mvuState.mvu.events) return false;
      try {
        win.eventOn(mvuState.mvu.events.VARIABLE_UPDATE_ENDED, () => {
          if (parent$(`#organ-system-panel`).length) {
            try { updateOrganUI(); } catch (e) { console.error('[OrganModule] 自动刷新失败:', e); }
          }
        });
        win.eventOn(mvuState.mvu.events.VARIABLE_INITIALIZED, () => {
          runOnceOrganSystemInitialization();
          if (parent$(`#organ-system-panel`).length) {
            try { updateOrganUI(); } catch (e) { console.error('[OrganModule] 初始化刷新失败:', e); }
          }
        });
        console.log('[OrganModule] Mvu 变量变化监听已绑定');
        return true;
      } catch (e) {
        console.warn('[OrganModule] Mvu 监听绑定失败:', e);
        return false;
      }
    };
    if (tryBind()) return;
    if (typeof win_waitGlobalInitialized === 'function') {
      win_waitGlobalInitialized('Mvu').then(tryBind);
    } else {
      let tries = 0;
      const timer = setInterval(() => { if (tryBind() || ++tries > 30) clearInterval(timer); }, 200);
    }
  };

  const fetchLatestMvuData = () => {
    try {
      if (mvuState.ready || mvuState.check()) {
        const mvuData = mvuState.mvu.getMvuData({ type: 'message', message_id: 'latest' });
        if (mvuData && mvuData.stat_data && Object.keys(mvuData.stat_data).length > 0) {
          return mvuData.stat_data;
        }
      }
    } catch (error) {
      console.error('[OrganModule] 获取MVU数据失败:', error);
    }
    return {};
  };

  const applyMvuPatches = async (patches) => {
    if (!Array.isArray(patches) || patches.length === 0) return true;
    try {
      const ok = await enqueueMvuWrite(async () => {
        if (!mvuState.ready && !mvuState.check()) {
          console.warn('[OrganModule] MVU系统不可用');
          return false;
        }
        const mvuData = mvuState.mvu.getMvuData({ type: 'message', message_id: 'latest' });
        if (!mvuData || !mvuData.stat_data) {
          console.warn('[OrganModule] 无法获取游戏数据');
          return false;
        }
        patches.forEach(patch => {
          const pathParts = splitPatchPath(patch.path);
          if (patch.op === 'replace' || patch.op === 'add') {
            const o = mvuData.stat_data;
            let cur = o;
            for (let i = 0; i < pathParts.length - 1; i++) {
              if (cur[pathParts[i]] === undefined) cur[pathParts[i]] = {};
              cur = cur[pathParts[i]];
            }
            cur[pathParts[pathParts.length - 1]] = patch.value;
          } else if (patch.op === 'remove') {
            const o = mvuData.stat_data;
            let cur = o;
            for (let i = 0; i < pathParts.length - 1; i++) {
              if (cur[pathParts[i]] === undefined) return;
              cur = cur[pathParts[i]];
            }
            delete cur[pathParts[pathParts.length - 1]];
          }
        });
        await mvuState.mvu.replaceMvuData(mvuData, { type: 'message', message_id: 'latest' });
        return true;
      });
      return ok;
    } catch (error) {
      console.error('[OrganModule] 应用MVU更新失败:', error);
      return false;
    }
  };

  const showToast = (type, message, duration = 2200) => {
    let $panel = $(`#organ-system-panel`);
    if (!$panel.length) $panel = $(`#${SCRIPT_ID}-panel`);
    if (!$panel.length) { console.info(message); return; }
    const icons = { success: 'ri-check-line', error: 'ri-close-circle-line', warning: 'ri-error-warning-line', info: 'ri-information-line' };
    const icon = icons[type] || icons.info;
    const $t = $(`<div class="rpg-toast rpg-toast-${type}"><i class="${icon}"></i><span>${message}</span></div>`);
    $panel.append($t);
    requestAnimationFrame(() => $t.addClass('show'));
    setTimeout(() => { $t.removeClass('show'); setTimeout(() => $t.remove(), 300); }, duration);
  };

  // 轻量版 updateStatusBarUI
  const updateStatusBarUI = (data) => {
    if (!data) return;
    const $panel = $(`#${SCRIPT_ID}-panel`);
    if (!$panel.length) return;
    const 人物 = data.人物 || {};
    const 属性 = 人物.属性 || {};
    const 战斗属性 = 人物.战斗属性 || {};
    $panel.find('.stat-level').text(人物.等级 || '?');
    const hp = 战斗属性.生命值 || 属性.HP || 0;
    const maxHp = 战斗属性.最大生命值 || 属性.最大HP || hp;
    $panel.find('.stat-hp').text(`${hp}/${maxHp}`);
    Object.entries(属性).forEach(([k, v]) => {
      const $el = $panel.find(`.stat-${k}`);
      if ($el.length) $el.text(v);
    });
  };

  const updateTraitsPageUI = () => {
    if (typeof window.rpg_status_bar_fetchData === 'function') {
      try { window.rpg_status_bar_fetchData(); } catch(e) {}
    }
  };

  const syncSkillSlots = (skillTree, 人物) => {
    if (!(skillTree || {}).技能列表) return;
  };

  // ---
  // 单一来源：所有脚本内的器官数据均从此处查询，避免重复硬编码
  const ORGAN_SLOTS = {
    眼球: { icon: 'ri-eye-fill',              std: true,  种类: '视觉类' },
    心脏: { icon: 'ri-heart-pulse-fill',      std: true,  种类: '核心类' },
    肺脏: { icon: 'ri-windy-fill',            std: true,  种类: '呼吸类' },
    胃:   { icon: 'ri-restaurant-fill',       std: true,  种类: '消化类' },
    肠子: { icon: 'ri-loop-left-line',        std: true,  种类: '消化类' },
    阑尾: { icon: 'ri-heart-add-fill',        std: true,  种类: '免疫类' },
    肌肉: { icon: 'ri-hand-sanitizer-fill',   std: true,  种类: '肌肉类' },
    肝脏: { icon: 'ri-contrast-drop-2-fill',  std: true,  种类: '代谢类' },
    脾脏: { icon: 'ri-shield-user-fill',      std: true,  种类: '血液类' },
    肾脏: { icon: 'ri-drop-fill',             std: true,  种类: '血液类' },
    肋骨: { icon: 'ri-split-cells-vertical',  std: true,  种类: '骨骼类' },
    脊柱: { icon: 'ri-node-tree',             std: true,  种类: '神经类' },
    脑:   { icon: 'ri-brain-line',            std: false, 种类: '神经类' },
    胆:   { icon: 'ri-contrast-drop-line',    std: false, 种类: '消化类' },
    膀胱: { icon: 'ri-ink-bottle-line',       std: false, 种类: '排泄类' },
    胰腺: { icon: 'ri-bubble-chart-line',     std: false, 种类: '代谢类' },
    生殖: { icon: 'ri-genderless-line',       std: false, 种类: '生殖类' }
  };
  const ORGAN_SLOT_KEYS = Object.keys(ORGAN_SLOTS);
  const ORGAN_STANDARD_SLOTS = ORGAN_SLOT_KEYS.filter(k => ORGAN_SLOTS[k].std);
  const ORGAN_VALID_SLOTS = ORGAN_SLOT_KEYS; // 17 个槽位都是合法
  const PHYSIOLOGY_ATTRIBUTES = {
    健康度:        { icon: 'ri-heart-pulse-line',     初始: 1,   描述: '影响最大生命值' },
    视觉:          { icon: 'ri-eye-line',              初始: 2,   描述: '影响感知' },
    坚韧:          { icon: 'ri-shield-cross-line',     初始: 4.5, 描述: '影响防御' },
    神经传递效率:  { icon: 'ri-flashlight-line',       初始: 1,   描述: '影响敏捷与感知' },
    血液过滤效率:  { icon: 'ri-drop-line',             初始: 2,   描述: '影响体质与再生' },
    解毒效率:      { icon: 'ri-flask-line',            初始: 1,   描述: '影响药效与抗毒' },
    新陈代谢效率:  { icon: 'ri-speed-up-line',         初始: 1,   描述: '影响经验获取' },
    肺活量:        { icon: 'ri-windy-line',            初始: 2,   描述: '影响呼吸' },
    耐力:          { icon: 'ri-heart-3-line',          初始: 2,   描述: '影响战续能力' },
    消化效率:      { icon: 'ri-restaurant-line',       初始: 1,   描述: '影响进食与抗毒' },
    营养获取效率:  { icon: 'ri-hand-heart-line',       初始: 4,   描述: '影响恢复效率' },
    速度:          { icon: 'ri-run-line',              初始: 8,   描述: '影响移动与先攻' },
    筋力:          { icon: 'ri-hand-sanitizer-line',   初始: 8,   描述: '影响物理伤害与负重' },
    幸运:          { icon: 'ri-copper-coin-line',      初始: 1,   描述: '影响 D20 检定优势' }
  };
  const ORGAN_PHYSIOLOGY_MAP = {
    眼球: ['视觉'],
    心脏: ['健康度'],
    肺脏: ['肺活量', '耐力'],
    胃:   ['消化效率'],
    肠子: ['营养获取效率'],
    阑尾: ['幸运'],
    脊柱: ['坚韧', '神经传递效率'],
    肋骨: ['坚韧'],
    肾脏: ['血液过滤效率'],
    脾脏: ['解毒效率'],
    肝脏: ['新陈代谢效率'],
    肌肉: ['速度', '筋力']
  };
  const PHYSIOLOGY_DEBUFFS = {
    易伤:     { 来源: '坚韧',          公式: '(4.5 - 当前坚韧) × 20%' },
    迟钝:     { 来源: '神经传递效率',  公式: '(1 - 当前神经传递效率) × 100%' },
    流血:     { 来源: '血液过滤效率',  公式: '(2 - 当前血液过滤效率) / 2 × 100%' },
    治疗障碍: { 来源: '血液过滤效率',  公式: '(2 - 当前血液过滤效率) / 2 × 100%' },
    中毒:     { 来源: '解毒效率',      公式: '每回合 5% 最大生命值' },
    半盲:     { 来源: '视觉',          公式: '(1 - 当前视觉) × 100%' },
    致盲:     { 来源: '视觉',          公式: '视觉 < 0' },
    生手:     { 来源: '新陈代谢效率',  公式: '(1 - 当前新陈代谢效率) × 100%' },
    窒息:     { 来源: '肺活量',        公式: '(2 - 当前肺活量) / 2 × 100%' },
    无法呼吸: { 来源: '肺活量',        公式: '肺活量 < 0' },
    体弱:     { 来源: '耐力',          公式: '(2 - 当前耐力) / 2 × 100%' },
    食物中毒: { 来源: '消化效率',      公式: '(3 - 当前消化效率) / 3 × 100%' },
    厄运:     { 来源: '幸运',          公式: '(1 - 当前幸运) × 10%' },
    瘫痪:     { 来源: '神经传递效率',  公式: '神经传递效率 < 0' }
  };
  const PHYSIOLOGY_BUFFS = {
    动态视力: { 来源: '视觉',          公式: '等级 = 当前视觉 - 2' },
    战续:     { 来源: '耐力',          公式: '(当前耐力 - 2) × 10%' },
    幸运一击: { 来源: '幸运',          公式: '当前幸运 × 5%' },
    体质强化: { 来源: '血液过滤效率',  公式: '(当前血液过滤效率 - 2) × 0.5' },
    恢复强化: { 来源: '血液过滤效率',  公式: '(当前血液过滤效率 - 2) × 5% 最大生命值' }
  };
  const REJECTION_SUCCESS_RATES = {
    普通: 1.00, 精良: 1.00, 稀有: 0.80, 史诗: 0.60, 传奇: 0.50, 神器: 0.30, 传说: 0.10
  };
  const REJECTION_MEDICINE_YIELD = {
    普通: 1, 稀有: 2, 精良: 4, 史诗: 5, 传奇: 6, 神器: 8, 传说: 10
  };
  const QUALITY_BUDGET = {
    普通: 2.0, 精良: 3.0, 稀有: 4.5, 史诗: 6.0, 传说: 8.0, 神话: 10.0
  };
  const TEST_GENERATION_POOLS = {
    种族:  ['人类', '天降者', '亡灵', '机械', '精灵', '兽人', '龙族'],
    特性:  ['聚焦', '超频爆发', '重击强化', '充能', '过载', '复苏', '不屈', '寒冰', '剧毒', '风行'],
    标签:  ['初火', '虚空', '深渊', '机械', '圣光', '暗影'],
    套装:  ['初火誓约', '机械主宰', '虚空行者', '亡灵协奏', '风暴使者']
  };
  const QUALITY_ATTR_COUNT_RULES = {
    普通: () => Math.random() < 0.8 ? 1 : 2,
    精良: () => Math.random() < 0.8 ? 1 : 2,
    稀有: () => { const d = Math.random(); return d < 0.3 ? 1 : (d < 0.8 ? 2 : 3); },
    史诗: () => { const d = Math.random(); return d < 0.3 ? 1 : (d < 0.8 ? 2 : 3); },
    传说: () => { const d = Math.random(); return d < 0.1 ? 1 : (d < 0.5 ? 2 : 3); },
    神话: () => { const d = Math.random(); return d < 0.1 ? 1 : (d < 0.5 ? 2 : 3); }
  };

  // 寻找适合该插槽的可植入器官
  const defaultOrgans = {
    "眼球": { 名称: "人类眼球", 品质: "普通", 属性加成: { "视觉": 2 }, 标签: ["血肉", "人类"], 描述: "人类的视觉感光器官，提供常规视界。" },
    "心脏": { 名称: "人类心脏", 品质: "普通", 属性加成: { "健康度": 1 }, 标签: ["血肉", "人类"], 描述: "人类的血液循环泵，源源不断输送能量。" },
    "肺脏": { 名称: "人类肺脏", 品质: "普通", 属性加成: { "肺活量": 2, "耐力": 2 }, 标签: ["血肉", "人类"], 描述: "人类的气体交互器官，维持日常呼吸。" },
    "胃": { 名称: "人类胃", 品质: "普通", 属性加成: { "消化效率": 1 }, 标签: ["血肉", "人类"], 描述: "人类的初步消化器官，分解常规膳食。" },
    "肠子": { 名称: "人类肠道", 品质: "普通", 属性加成: { "营养获取效率": 4 }, 标签: ["血肉", "人类"], 描述: "人类的主要吸收器官，吸取营养元素。" },
    "阑尾": { 名称: "人类阑尾", 品质: "普通", 属性加成: { "幸运": 1 }, 标签: ["血肉", "人类"], 描述: "人类的免疫辅助器官，虽然不起眼但也有些许用处。" },
    "脊柱": { 名称: "人类脊柱", 品质: "普通", 属性加成: { "坚韧": 4.5, "神经传递效率": 1 }, 标签: ["血肉", "人类"], 描述: "人类的躯干支柱与中枢神经通道，维持体态。" },
    "肋骨": { 名称: "人类肋骨", 品质: "普通", 属性加成: { "坚韧": 4.5 }, 标签: ["血肉", "人类"], 描述: "人类的胸腔保护骨骼，遮蔽脏器免受直接冲击。" },
    "肾脏": { 名称: "人类肾脏", 品质: "普通", 属性加成: { "血液过滤效率": 2 }, 标签: ["血肉", "人类"], 描述: "人类的多余水分与毒素排泄器官，平衡内环境。" },
    "脾脏": { 名称: "人类脾脏", 品质: "普通", 属性加成: { "解毒效率": 1 }, 标签: ["血肉", "人类"], 描述: "人类的免疫与解毒器官，过滤血液毒素。" },
    "肝脏": { 名称: "人类肝脏", 品质: "普通", 属性加成: { "新陈代谢效率": 1 }, 标签: ["血肉", "人类"], 描述: "人类的代谢核心器官，协调多种生化反应。" },
    "肌肉": { 名称: "人类肌肉", 品质: "普通", 属性加成: { "速度": 8, "筋力": 8 }, 标签: ["血肉", "人类"], 描述: "人类的运动收缩肌纤维，提供基础负重与行动力。" }
  };

  const guessSlotFromOrganName = (name) => {
    const slots = ['眼球','心脏','肺脏','胃','肠子','阑尾','肌肉','肝脏','脾脏','肾脏','肋骨','脊柱','脑','胆','膀胱','胰腺','生殖'];
    for (let s of slots) {
      if (name && name.includes(s)) return s;
    }
    return null;
  };

  const stripNativePrefix = (name) => {
    if (!name) return '';
    return name.replace(/^(原生|初始)/, '');
  };

  const getDefaultOrganForSlot = (slotKey, race) => {
    const raceName = race || '人类';
    // 阑尾和幸运只有人类有，其他种族默认无阑尾
    if (slotKey === '阑尾') {
      const isHuman = raceName.includes('人类') || raceName.includes('凡人');
      if (!isHuman) return { 空: true, 名称: '[空置阑尾]' };
    }
    const baseOrgan = defaultOrgans[slotKey];
    if (!baseOrgan) return { 空: true, 名称: `[${slotKey}]` };

    const organ = JSON.parse(JSON.stringify(baseOrgan));
    // 多槽位器官：每个槽位只承担 1/count 的属性（避免 8 肌肉 × 8 速度 = 64 重复累加）
    const count = (SLOTS_LAYOUT[slotKey] && SLOTS_LAYOUT[slotKey].count) || 1;
    if (count > 1 && organ.属性加成) {
      const divided = {};
      Object.entries(organ.属性加成).forEach(([k, v]) => {
        divided[k] = Number(v) / count;
      });
      organ.属性加成 = divided;
    }
    if (raceName !== '人类') {
      organ.名称 = `${raceName}${slotKey}`;
      organ.标签 = ["血肉", raceName];
      organ.描述 = `${raceName}的${slotKey}器官。`;
    }
    // 初始/默认生成的种族器官默认为已排异状态 (免疫排斥反应)
    organ.已排异 = true;
    return organ;
  };

  const getNormalizedOrgan = (organObj, race = '') => {
    if (!organObj || organObj.空) return organObj;
    const organ = JSON.parse(JSON.stringify(organObj));

    const tags = safeArr(organ.标签);
    const isUndead = (race && (race.includes('亡灵') || race.includes('不死'))) || tags.includes('亡灵') || tags.includes('不死');

    const part = safeStr(organ.部位) || guessSlotFromOrganName(safeStr(organ.名称));

    if (part === '心脏') {
      if (!organ.属性加成) organ.属性加成 = {};
      if (!isUndead) {
        const currentHealth = getOrganBonus(organ, '健康度');
        if (currentHealth < 1) {
          organ.属性加成['健康度'] = 1;
        }
      }
    }
    if (part === '眼球') {
      if (!organ.属性加成) organ.属性加成 = {};
      const currentVision = getOrganBonus(organ, '视觉');
      if (currentVision < 0.5) {
        organ.属性加成['视觉'] = 0.5;
      }
    }

    const traits = safeArr(organ.特性);
    if (traits.length > 0) {
      const traitsToMove = ['超频爆发', '超载爆发', '重击强化'];
      traitsToMove.forEach(t => {
        if (traits.includes(t)) {
          if (!organ.属性加成) organ.属性加成 = {};
          if (safeNum(organ.属性加成[t]) === 0) {
            organ.属性加成[t] = 1;
          }
          organ.特性 = traits.filter(x => x !== t);
        }
      });
    }
    return organ;
  };

  /**
   * 智能定位 tooltip：当 tooltip 超出容器上边界时，自动翻转到触发器下方。
   * @param {Element|string} root - 事件委托根元素/选择器
   * @param {string} triggerSel - 触发器选择器（如 '.organ-attr-compact-card'）
   * @param {string} tooltipSel - tooltip 选择器（如 '.compact-detail'）
   * @param {string} flipClass - 翻转到下方时添加的 class
   * @param {Object} [opts]
   * @param {Element|string} [opts.container] - 边界容器，默认 root
   * @param {number} [opts.offset=6] - 与容器边界的额外间距
   * @returns {Function} cleanup
   */
  const smartTooltipPosition = (root, triggerSel, tooltipSel, flipClass, opts = {}) => {
    const rootEl = typeof root === 'string' ? document.querySelector(root) : root;
    if (!rootEl) return () => {};
    const pad = opts.offset ?? 6;
    const entered = new WeakSet();

    function onOver(e) {
      const trigger = e.target.closest(triggerSel);
      if (!trigger || entered.has(trigger)) return;
      entered.add(trigger);
      // 取消可能待处理的退出清理，避免闪烁
      if (trigger._stpCleanup) { clearTimeout(trigger._stpCleanup); delete trigger._stpCleanup; }

      const tooltip = trigger.querySelector(tooltipSel);
      if (!tooltip) return;

      const tr = tooltip.getBoundingClientRect();
      let boundEl = opts.container
        ? (typeof opts.container === 'string' ? e.target.closest(opts.container) || document.querySelector(opts.container) : opts.container)
        : rootEl;
      const br = boundEl ? boundEl.getBoundingClientRect() : { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };

      trigger.classList.toggle(flipClass, tr.top < br.top + pad);
      const overflowsRight = tr.right > br.right - pad;
      const overflowsLeft = tr.left < br.left + pad;
      trigger.classList.toggle('tt-right', overflowsRight && !overflowsLeft && tr.width < br.right - br.left - pad);
      trigger.classList.toggle('tt-left', overflowsLeft);
    }

    function onOut(e) {
      const trigger = e.target.closest(triggerSel);
      if (!trigger) return;
      const rel = e.relatedTarget;
      if (!rel || !trigger.contains(rel)) {
        trigger.classList.remove(flipClass);
        // 延迟移除水平定位类，避免退出时 transform 突变造成位移
        trigger._stpCleanup = setTimeout(() => {
          trigger.classList.remove('tt-right', 'tt-left');
          entered.delete(trigger);
          delete trigger._stpCleanup;
        }, 200);
      }
    }

    rootEl.addEventListener('mouseover', onOver, true);
    rootEl.addEventListener('mouseout', onOut, true);
    return () => { rootEl.removeEventListener('mouseover', onOver, true); rootEl.removeEventListener('mouseout', onOut, true); };
  };

  // ---
  const ORGAN_QUALITY_COLORS = {
    '普通': '#57606a',
    '精良': '#6e7681',
    '稀有': '#9b51e0',
    '史诗': '#9b51e0',
    '传说': '#f2994a',
    '神话': '#f2994a',
    '诅咒': '#eb5757'
  };
  const buildOrganTooltipHtml = (organ, { name, level = '', quality, qColor, slot, sourceLabel = null, compact = false } = {}) => {
    if (!organ) return '';
    const q = quality || safeStr(organ.品质, '普通');
    const c = qColor || ORGAN_QUALITY_COLORS[q] || '#57606a';
    const n = name || safeStr(organ.名称, '未知器官');
    const lv = level || (safeNum(organ.强化等级) > 0 ? ` +${safeNum(organ.强化等级)}` : '');

    let html = '';
    if (!compact) {
      html += `<div style="font-weight:700;font-size:14px;color:${c};text-shadow:0 1px 1.5px rgba(0,0,0,0.45),0 -1px 1.5px rgba(0,0,0,0.45),1px 0 1.5px rgba(0,0,0,0.45),-1px 0 1.5px rgba(0,0,0,0.45);margin-bottom:4px;">${n}${lv}</div>`;
      const slotHtml = slot ? `部位: ${slot} | ` : '';
      const src = sourceLabel ? ` | 来源: ${sourceLabel}` : '';
      html += `<div style="color:var(--ot-text-weak);font-size:11px;margin-bottom:6px;">${slotHtml}品质: ${q}${src}</div>`;
    }

    const bonus = safeObj(organ.属性加成);
    const isUnadapted = safeBool(organ.已排异) !== true;
    const bonusEntries = Object.entries(bonus).filter(([, v]) => v !== 0);
    if (bonusEntries.length > 0) {
      html += `<div style="font-weight:600;color:#58a6ff;margin-top:6px;">[属性加成]</div>`;
      bonusEntries.forEach(([k, v]) => {
        const displayVal = isUnadapted ? v / 2 : v;
        html += `<div style="margin-left:4px;font-size:11px;">· ${k} ${displayVal > 0 ? '+' : ''}${formatAttrVal(displayVal)}</div>`;
      });
      if (isUnadapted) {
        html += `<div style="margin-left:4px;font-size:10px;color:#cf222e;">⚠ 未排异，属性暂时减半</div>`;
      }
    }

    const desc = safeStr(organ.描述);
    if (desc) {
      if (bonusEntries.length === 0) html += '<div style="margin-top:4px;"></div>';
      html += `<div style="color:var(--ot-text-sub);font-style:italic;margin-top:4px;">${desc}</div>`;
    }

    return html;
  };
  const buildOrganHeader = ({ icon = '', metaLabel, title, badges = '', borderColor = 'rgba(0,0,0,0.08)' }) => `
    <div class="f-header" style="border-bottom: 1px solid ${borderColor}; padding-bottom: 8px; margin-bottom: 10px;">
      <div class="f-meta-row" style="font-size: 10px; color: var(--ot-text-sub); text-transform: uppercase; letter-spacing: 0.5px;">
        <span class="f-type">${icon ? `<i class="${icon}" style="margin-right:3px;"></i>` : ''}// ${metaLabel}</span>
      </div>
      <div class="f-title-row" style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
        <span class="f-name" style="font-size: 14px; font-weight: 700; color: var(--ot-text-main);">${title}</span>
        ${badges}
      </div>
    </div>
  `;
  const renderOrganSharedTooltip = () => `
    <div id="organ-shared-tooltip" class="organ-tooltip-container"></div>
  `;

  // 4b. 统一器官 tooltip 定位函数（修复越界 bug）
  const placeOrganTooltip = ($tooltip, anchorEl, anchorCard, margin = 6) => {
    const ttEl = $tooltip[0];
    if (!ttEl) return;
    // 先显示出来才能测真实尺寸
    $tooltip.css({ display: 'block', visibility: 'hidden' });
    const tr = ttEl.getBoundingClientRect();
    const cr = anchorEl.getBoundingClientRect();
    const pr = anchorCard.getBoundingClientRect();

    // 智能方向：上方空间大就放上方，否则下方
    const spaceAbove = cr.top - pr.top;
    const spaceBelow = pr.bottom - cr.bottom;
    let vAlign = spaceBelow >= spaceAbove ? 'bottom' : 'top';

    let top;
    if (vAlign === 'top') {
      top = cr.top - pr.top - tr.height - margin;
    } else {
      top = cr.bottom - pr.top + margin;
    }

    let left = cr.left - pr.left + (cr.width - tr.width) / 2;

    // 顶部越界 → 翻向下方
    if (vAlign === 'top' && top < margin) {
      vAlign = 'bottom';
      top = cr.bottom - pr.top + margin;
    }
    // 底部越界 → 翻向上方
    if (vAlign === 'bottom' && top + tr.height > pr.height - margin) {
      vAlign = 'top';
      top = cr.top - pr.top - tr.height - margin;
    }
    // 终极钳制：保证 tooltip 完全在 popup 内
    if (top < margin) top = margin;
    if (top + tr.height > pr.height - margin) top = pr.height - tr.height - margin;

    // 横向裁剪
    if (left < margin) left = margin;
    if (left + tr.width > pr.width - margin) left = pr.width - tr.width - margin;

    $tooltip.css({
      visibility: 'visible',
      display: 'block',
      transform: `translate(${left}px, ${top}px)`
    });
  };

  // 4c. 统一器官卡片 HTML 构建函数（所有弹窗/背包/槽位共用）
  const buildOrganCardHtml = ({ iconClass, iconColor, name, extra, extraAfter, stateClass = '', dataAttrs = '', innerStyle = '' }) => `
    <div class="organ-card-base organ-slot-card-base${stateClass}" ${dataAttrs} style="position: relative;${innerStyle}">
      <div class="organ-slot-card-inner">
        <i class="${iconClass} card-icon" style="color:${iconColor};"></i>
        <span class="card-name" style="color:${iconColor};text-shadow:0 1px 1.5px rgba(0,0,0,0.45),0 -1px 1.5px rgba(0,0,0,0.45),1px 0 1.5px rgba(0,0,0,0.45),-1px 0 1.5px rgba(0,0,0,0.45);">${name}</span>
        ${extra || ''}
      </div>
      ${extraAfter || ''}
    </div>
  `;
  const ensureOrganPopupBaseStyle = (doc) => {
    doc = doc || document;
    if (doc.getElementById('organ-submenu-unclip-style')) return;
    const style = doc.createElement('style');
    style.id = 'organ-submenu-unclip-style';
    style.textContent = `#${SCRIPT_ID}-popup .organ-theme-card,
#${SCRIPT_ID}-popup .organ-theme-card * { overflow: visible !important; }
#${SCRIPT_ID}-popup .organ-theme-card .sub-slots-container,
#${SCRIPT_ID}-popup .organ-theme-card .organ-candidates-grid {
    overflow-y: auto !important; scrollbar-width: none; -ms-overflow-style: none;
}
#${SCRIPT_ID}-popup .organ-theme-card .sub-slots-container::-webkit-scrollbar,
#${SCRIPT_ID}-popup .organ-theme-card .organ-candidates-grid::-webkit-scrollbar { display: none; width: 0; height: 0; }
#${SCRIPT_ID}-popup .organ-theme-card .rejection-grid { overflow-y: auto !important; scrollbar-width: none; -ms-overflow-style: none; }
#${SCRIPT_ID}-popup .organ-theme-card .rejection-grid::-webkit-scrollbar { display: none; width: 0; height: 0; }
#${SCRIPT_ID}-popup .organ-theme-card .rejection-grid::-webkit-scrollbar-track { background: transparent; }
#${SCRIPT_ID}-popup .organ-theme-card .rejection-grid::-webkit-scrollbar-thumb { background: transparent; }`;
    doc.head.appendChild(style);
  };
  const bindOrganPopupClose = ($popup) => {
    $popup.on('click', function(e) {
      if (e.target === this || $(e.target).closest('.popup-close').length) $(this).remove();
    });
  };

  const getOrganIconClass = (slotName, organName) => {
    const baseSlot = String(slotName || '').trim();
    if (ORGAN_SLOTS[baseSlot]) return ORGAN_SLOTS[baseSlot].icon;

    // 从名字里猜测槽位类型
    const guessed = guessSlotFromOrganName(organName);
    if (guessed && ORGAN_SLOTS[guessed]) return ORGAN_SLOTS[guessed].icon;

    // 非 12 标准种类的器官使用通用神秘图标
    return "ri-hexagon-line";
  };

  // 任意器官都可以装配到任意位置（更接近饰品的特性），仅筛选出"器官"类型的备用件
  const findAvailableOrgansForSlot = (slotName, data) => {
    const results = [];
    const validOrganSlots = ORGAN_STANDARD_SLOTS;

    // 扫描器官背包
    const 器官背包 = safeObj(data?.人物?.器官系统?.器官背包) || safeObj(data?.人物?.背包?.器官);
    Object.entries(器官背包).forEach(([key, eq]) => {
      if (!eq) return;
      const eqPart = safeStr(eq.部位);
      const eqName = safeStr(eq.名称);
      const eqType = safeStr(eq.类型);
      const isOrgan = validOrganSlots.includes(eqPart) ||
                      eqName.includes('器官') ||
                      eqType.includes('器官');
      if (isOrgan) {
        results.push({
          source: 'organpack',
          key: key,
          name: eqName || key,
          quality: safeStr(eq.品质, '普通'),
          desc: safeStr(eq.描述, '无描述'),
          level: safeNum(eq.强化等级),
          data: eq
        });
      }
    });

    // 扫描装备箱
    const 装备列表 = safeObj(data?.人物?.装备列表);
    Object.entries(装备列表).forEach(([key, eq]) => {
      if (!eq) return;
      const isUnequipped = safeBool(eq.装备箱) === true;
      const eqName = safeStr(eq.名称);
      const eqType = safeStr(eq.类型);
      const eqPart = safeStr(eq.部位);
      const isOrgan = eqName.includes('器官') ||
                      eqType.includes('器官') ||
                      validOrganSlots.includes(eqPart);

      if (isUnequipped && isOrgan) {
        results.push({
          source: 'equip',
          key: key,
          name: eqName,
          quality: safeStr(eq.品质, '普通'),
          desc: safeStr(eq.描述, '无描述'),
          level: safeNum(eq.强化等级),
          data: eq
        });
      }
    });

    // 扫描道具背包
    const 道具 = safeObj(data?.人物?.背包?.道具);
    Object.entries(道具).forEach(([name, item]) => {
      if (!item) return;
      const isMatchSlot = name.includes(slotName);
      const isOrgan = name.includes('器官') || isMatchSlot;

      if (isOrgan && isMatchSlot) {
        const itemObj = typeof item === 'object' ? item : { 数量: 1, 描述: '道具器官' };
        results.push({
          source: 'item',
          key: name,
          name: name,
          quality: safeStr(itemObj.品质, '普通'),
          desc: safeStr(itemObj.描述, '无描述'),
          level: safeNum(itemObj.强化等级),
          data: itemObj
        });
      }
    });

    return results;
  };

  const equipOrganToSlot = async (slotName, organItem) => {
    const data = fetchLatestMvuData();
    const patches = [];
    const baseSlot = String(slotName || '').split('_')[0];

    // First unequip current organ if it exists to avoid overwriting it
    // 初始器官不在器官列表中，需要从默认配置读取
    const race = safeStr(data?.人物?.种族);
    const currentOrgan = (data?.人物?.器官系统?.器官列表 || {})[slotName] || getDefaultOrganForSlot(baseSlot, race);
    if (currentOrgan && !currentOrgan.空) {
      const 装备列表 = safeObj(data?.人物?.装备列表);
      let foundKey = null;
      Object.entries(装备列表).forEach(([key, eq]) => {
        if (eq && safeStr(eq.名称) === safeStr(currentOrgan.名称) && safeBool(eq.装备箱) === false) {
          foundKey = key;
        }
      });
      if (foundKey) {
        patches.push({
          op: 'replace',
          path: `/人物/装备列表/${foundKey}/装备箱`,
          value: true
        });
      } else {
        const newKey = `器官_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
        patches.push({
          op: 'add',
          path: `/人物/装备列表/${newKey}`,
          value: {
            名称: safeStr(currentOrgan.名称),
            品质: safeStr(currentOrgan.品质, '普通'),
            描述: safeStr(currentOrgan.描述, '从躯体卸下的器官'),
            部位: baseSlot,
            装备箱: true,
            属性加成: safeObj(currentOrgan.属性加成),
            特性: safeArr(currentOrgan.特性),
            标签: safeArr(currentOrgan.标签),
            种族: safeStr(currentOrgan.种族),
            强化等级: safeNum(currentOrgan.强化等级),
            已排异: safeBool(currentOrgan.已排异)
          }
        });
      }
    }

    patches.push({
      op: 'replace',
      path: `/人物/器官系统/器官列表/${slotName}`,
      value: {
        名称: safeStr(organItem.name),
        品质: safeStr(organItem.quality),
        描述: safeStr(organItem.desc),
        强化等级: safeNum(organItem.level),
        属性加成: safeObj(organItem.data?.属性加成),
        特性: safeArr(organItem.data?.特性),
        标签: safeArr(organItem.data?.标签),
        种族: safeStr(organItem.data?.种族),
        已排异: safeBool(organItem.data?.已排异)
      }
    });

    if (organItem.source === 'equip') {
      patches.push({
        op: 'replace',
        path: `/人物/装备列表/${organItem.key}/装备箱`,
        value: false
      });
    } else if (organItem.source === 'item') {
      const currentQty = safeNum(organItem.data?.数量, 1);
      if (currentQty <= 1) {
        patches.push({
          op: 'remove',
          path: `/人物/背包/道具/${organItem.key}`
        });
      } else {
        patches.push({
          op: 'replace',
          path: `/人物/背包/道具/${organItem.key}/数量`,
          value: currentQty - 1
        });
      }
    } else if (organItem.source === 'organpack') {
      const currentQty = safeNum(organItem.data?.数量 || organItem.数量, 1);
      const packPath = data?.人物?.器官系统?.器官背包 ? `/人物/器官系统/器官背包/${organItem.key}` : `/人物/背包/器官/${organItem.key}`;
      if (currentQty <= 1) {
        patches.push({
          op: 'remove',
          path: packPath
        });
      } else {
        patches.push({
          op: 'replace',
          path: `${packPath}/数量`,
          value: currentQty - 1
        });
      }
    }

    const success = await applyMvuPatches(patches);
    if (success) {
      showToast('success', `移植成功：已将 [${organItem.name}] 替换 [${slotName}] 槽位`);
      updateOrganUI();
    }
  };

  const unequipOrganFromSlot = async (slotName) => {
    const data = fetchLatestMvuData();
    const baseSlot = String(slotName || '').split('_')[0];
    const organ = (data?.人物?.器官系统?.器官列表 || {})[slotName] || defaultOrgans[baseSlot];
    if (!organ || organ.空) return;

    const patches = [];
    patches.push({
      op: 'replace',
      path: `/人物/器官系统/器官列表/${slotName}`,
      value: { 空: true, 名称: `[${slotName}]` }
    });

    const 装备列表 = safeObj(data?.人物?.装备列表);
    let foundKey = null;
    Object.entries(装备列表).forEach(([key, eq]) => {
      if (eq && safeStr(eq.名称) === safeStr(organ.名称) && safeBool(eq.装备箱) === false) {
        foundKey = key;
      }
    });

    if (foundKey) {
      patches.push({
        op: 'replace',
        path: `/人物/装备列表/${foundKey}/装备箱`,
        value: true
      });
    } else {
      const newKey = `器官_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
      patches.push({
        op: 'add',
        path: `/人物/装备列表/${newKey}`,
        value: {
          名称: safeStr(organ.名称),
          品质: safeStr(organ.品质, '普通'),
          描述: safeStr(organ.描述, '从躯体卸下的器官'),
          部位: baseSlot,
          装备箱: true,
          属性加成: safeObj(organ.属性加成),
          特性: safeArr(organ.特性),
          标签: safeArr(organ.标签),
          种族: safeStr(organ.种族)
        }
      });
    }

    const success = await applyMvuPatches(patches);
    if (success) {
      showToast('success', `剥离成功：已将 [${safeStr(organ.名称)}] 从 [${slotName}] 槽位剥离并放入背包`);
      updateOrganUI();
    }
  };

  const showOrganSelectPopup = (slotName, initialSelectedSubKey = null) => {
    const data = fetchLatestMvuData();
    const parts = String(slotName || '').split('_');
    const baseSlot = parts[0] || slotName;

    const s = slotsDef.find(x => x.key === baseSlot);
    const count = s ? (s.count || 1) : 1;
    const organSystem = data?.人物?.器官系统 || {};
    const 器官列表 = organSystem.器官列表 || {};

    // Determine selectedSubKey
    let selectedSubKey = initialSelectedSubKey;
    if (!selectedSubKey) {
      for (let i = 1; i <= count; i++) {
        const subKey = count > 1 ? `${baseSlot}_${i}` : baseSlot;
        const organInList = 器官列表[subKey];
        if (!organInList || organInList.空) {
          selectedSubKey = subKey;
          break;
        }
      }
      if (!selectedSubKey) {
        selectedSubKey = count > 1 ? `${baseSlot}_1` : baseSlot;
      }
    }

    // Candidates
    const available = findAvailableOrgansForSlot(baseSlot, data);

    // Sub-slots cards rendering
    let cardsHtml = '<div class="sub-slots-container">';
    const race = data?.人物?.种族 || '';
    for (let i = 1; i <= count; i++) {
      const subKey = count > 1 ? `${baseSlot}_${i}` : baseSlot;
      const organInList = 器官列表[subKey];
      const isEmpty = !!organInList && organInList.空;
      const isEquipped = !!organInList && !organInList.空;
      const isNative = !organInList;
      
      let organ = null;
      if (isEquipped) {
        organ = organInList;
      } else if (!isEmpty) {
        organ = getDefaultOrganForSlot(baseSlot, race);
      }
      if (organ && organ.空) {
        organ = null;
      }

      const isSelected = (selectedSubKey === subKey);
      const stateClass = (isEmpty || isNative) ? ' is-empty' : ' has-organ';
      const unadaptedClass = (organ && safeBool(organ.已排异) !== true) ? ' is-unadapted' : '';

      let displayTitle = count > 1 ? `${baseSlot} #${i}` : `${baseSlot}`;
      let displayOrganName = (!organ) ? '空置插槽' : stripNativePrefix(isNative ? baseSlot : (safeStr(organ.名称) || baseSlot));
      let qColor = isNative ? '#8c8c8c' : (isEquipped ? (ORGAN_QUALITY_COLORS[safeStr((organ || {}).品质)] || '#57606a') : '#afb8c1');

      // Tooltip HTML content to be loaded dynamically
      const tooltipContent = organ ? buildOrganTooltipHtml(organ, {
        name: displayOrganName,
        quality: isNative ? '普通' : ((organ || {}).品质 || '普通'),
        qColor,
        slot: baseSlot,
      }) : '';

      // Escape quotes safely
      const escapedTooltip = tooltipContent.replace(/"/g, '&quot;').replace(/'/g, '&#39;');

      cardsHtml += `
        <div class="organ-card-base organ-slot-card-base sub-slot-card${stateClass}${unadaptedClass} ${isSelected ? 'selected' : ''}"
             data-sub-key="${subKey}"
             data-tooltip-html="${escapedTooltip}">
          <div class="organ-slot-card-inner">
            ${isEquipped ? `
              <button class="btn-sub-unequip" data-sub-key="${subKey}"
                      style="position: absolute; top: 1px; right: 1px; background: none; border: none; padding: 2px; color: #cf222e; cursor: pointer; font-size: 10px; line-height: 1; z-index: 10;"
                      title="卸下">
                <i class="ri-close-circle-fill"></i>
              </button>
            ` : ''}
            <div style="font-size: 8.5px; color: var(--ot-text-sub); font-weight: 600; line-height: 1;">${displayTitle}</div>
            <div class="card-icon" style="color: ${qColor};">
              <i class="${(organ && !isEmpty) ? getOrganIconClass(organ.部位 || baseSlot, organ.名称) : getOrganIconClass(baseSlot, baseSlot)}"></i>
            </div>
            <div class="card-name" style="color: ${qColor};text-shadow:0 1px 1.5px rgba(0,0,0,0.45),0 -1px 1.5px rgba(0,0,0,0.45),1px 0 1.5px rgba(0,0,0,0.45),-1px 0 1.5px rgba(0,0,0,0.45);">${displayOrganName}</div>
          </div>
        </div>
      `;
    }
    cardsHtml += '</div>';

    let html = `
      <div id="${SCRIPT_ID}-popup" class="fusion-popup-overlay">
        <div class="fusion-card organ-theme-card" style="width: 440px; --quality-color: #8b6b4a; position: relative;">
          <button class="popup-close"><i class="ri-close-line"></i></button>

          ${renderOrganSharedTooltip()}

          ${buildOrganHeader({ metaLabel: '躯体器官管理', title: `${baseSlot} 部位 (${count} 槽位)` })}
          <div class="f-body" style="display: flex; flex-direction: column; gap: 12px;">

            <div class="current-organ-display">
              <div class="section-title" style="font-size: 11px; font-weight: 600; color: var(--ot-text-sub); margin-bottom: 6px;">槽位选择与状态 <span style="font-size: 9px; color: var(--ot-text-weak); font-weight: normal;">(鼠标悬停卡片查看详情)</span></div>
              ${cardsHtml}
            </div>

            <div class="candidate-section-title" style="font-size: 11px; font-weight: 600; color: var(--ot-text-sub); margin-top: 4px; border-top: 1px solid #e8ddc8; padding-top: 8px;">
              当前选中装配目标: <b style="color: #8b6b4a;">${selectedSubKey.includes('_') ? `${baseSlot} #${selectedSubKey.split('_')[1]}` : baseSlot}</b>
            </div>
    `;

    if (available.length === 0) {
      html += `
        <div class="empty-candidate-hint" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px 10px; font-size: 11px; color: var(--ot-text-weak); text-align: center; gap: 6px;">
          <i class="ri-heart-add-line" style="font-size: 20px; color: #afb8c1;"></i>
          <div>暂无匹配 [${baseSlot}] 的备用器官配件</div>
        </div>
      `;
    } else {
      html += `<div class="organ-candidates-grid">`;
      available.forEach((item, idx) => {
        const qColor = ORGAN_QUALITY_COLORS[item.quality] || '#57606a';
        const level = item.level > 0 ? ` +${item.level}` : '';

        // Dynamic candidate tooltip HTML
        const candidateTooltipContent = buildOrganTooltipHtml(item.data, {
          name: item.name,
          level: level,
          quality: item.quality,
          qColor,
          slot: '',
        });
        
        const escapedCandidateTooltip = candidateTooltipContent.replace(/"/g, '&quot;').replace(/'/g, '&#39;');

        const candidateStateClass = (item.data && item.data.已排异 !== true) ? ' is-unadapted' : '';
        html += buildOrganCardHtml({
          iconClass: getOrganIconClass(item.data.部位 || baseSlot, item.name),
          iconColor: qColor,
          name: item.name + level,
          stateClass: ' organ-candidate-card-grid' + candidateStateClass,
          dataAttrs: 'data-idx="' + idx + '" data-tooltip-html="' + escapedCandidateTooltip + '"',
        });
	      });
	      html += `</div>`;
    }

    html += `
          </div>
        </div>
      </div>
    `;

    $(`#${SCRIPT_ID}-popup`).remove();
    // 优先挂到独立面板，没有再退回基础面板
    let $popupHost = $(`#organ-system-panel`);
    if (!$popupHost.length) $popupHost = $(`#${SCRIPT_ID}-panel`);
    $popupHost.append(html);

    const $popup = $(`#${SCRIPT_ID}-popup`);

    // 绑定关闭事件
    bindOrganPopupClose($popup);

    // Style adjustments for compact grid (physiological evaluation look-alike)
    if (!$('#sub-slot-tooltip-css').length) {
      $('head').append(`
        <style id="sub-slot-tooltip-css"> .sub-slots-container{display:grid !important;grid-template-columns:repeat(4,1fr) !important;gap:6px !important;margin-bottom:12px !important;width:100% !important;}
.sub-slot-card:hover{border-color:#8b6b4a !important;box-shadow:0 0 0 1px #8b6b4a !important;}
.organ-candidates-grid{display:grid !important;grid-template-columns:repeat(4,1fr) !important;gap:6px !important;margin-top:8px !important;max-height:180px !important;overflow-y:auto !important;padding:4px !important;width:100% !important;}
.organ-candidate-card-grid{border:1px solid var(--ot-border) !important;}
.organ-candidate-card-grid:hover{border-color:#8b6b4a !important;box-shadow:0 0 6px rgba(139,107,74,0.45) !important;}
.equip-target-slot-card:hover{border-color:#8b6b4a !important;box-shadow:0 0 6px rgba(139,107,74,0.45) !important;}
.sub-slot-pick-item:hover{border-color:#8b6b4a !important;box-shadow:0 0 6px rgba(139,107,74,0.45) !important;}
</style>
      `);
    } else {
      // Style already exists, let's update it dynamically by replacing style element content
      $('#sub-slot-tooltip-css').html(`
        .sub-slots-container {
          display: grid !important;
          grid-template-columns: repeat(4, 1fr) !important;
          gap: 6px !important;
          margin-bottom: 12px !important;
          width: 100% !important;
        }
        .sub-slot-card:hover {
          border-color: #8b6b4a !important;
          box-shadow: 0 0 0 1px #8b6b4a !important;
        }

        .organ-candidates-grid {
          display: grid !important;
          grid-template-columns: repeat(4, 1fr) !important;
          gap: 6px !important;
          margin-top: 8px !important;
          max-height: 180px !important;
          overflow-y: auto !important;
          padding: 4px !important;
          width: 100% !important;
        }
        .organ-candidate-card-grid {
          border: 1px solid var(--ot-border) !important;
        }
        .organ-candidate-card-grid:hover {
          border-color: #8b6b4a !important;
          box-shadow: 0 0 6px rgba(139, 107, 74, 0.45) !important;
        }

        .equip-target-slot-card:hover {
          border-color: #8b6b4a !important;
          box-shadow: 0 0 6px rgba(139, 107, 74, 0.45) !important;
        }
        .sub-slot-pick-item:hover {
          border-color: #8b6b4a !important;
          box-shadow: 0 0 6px rgba(139, 107, 74, 0.45) !important;
        }
      `);
    }
    const popCard = $popup.find('.fusion-card')[0];
    const tooltip = popCard.querySelector('#organ-shared-tooltip');
    const placeTooltip = (card, content) => {
      tooltip.innerHTML = content;
      placeOrganTooltip($(tooltip), card, popCard, 8);
    };
    const hideTooltip = () => { tooltip.style.display = 'none'; };
    // 用原生事件，避免 jQuery 委托开销
    popCard.addEventListener('mouseover', e => {
      const card = e.target.closest('.sub-slot-card, .organ-candidate-card-grid');
      if (!card || !card.dataset.tooltipHtml) return;
      placeTooltip(card, card.dataset.tooltipHtml);
    });
    popCard.addEventListener('mouseout', e => {
      const card = e.target.closest('.sub-slot-card, .organ-candidate-card-grid');
      if (!card) return;
      // 只在真正离开卡片区域时隐藏（避免子元素切换闪烁）
      if (!e.relatedTarget || !card.contains(e.relatedTarget)) hideTooltip();
    });

    // Click card to select slot
    $popup.on('click', '.sub-slot-card', function(e) {
      if ($(e.target).closest('.btn-sub-unequip').length) return;
      const subKey = $(this).data('sub-key');
      selectedSubKey = subKey;

      // 只 toggle class，视觉由 CSS 控制（line 11013+ 的 organ-slot-card-base.selected）
      $popup.find('.sub-slot-card').removeClass('selected');
      $(this).addClass('selected');

      const slotIdxLabel = subKey.includes('_') ? `${baseSlot} #${subKey.split('_')[1]}` : baseSlot;
      $popup.find('.candidate-section-title b').text(slotIdxLabel);
    });

    // Click unequip
    $popup.on('click', '.btn-sub-unequip', async function(e) {
      e.stopPropagation();
      const subKey = $(this).data('sub-key');
      $popup.remove();
      await unequipOrganFromSlot(subKey);
    });

    // Click candidate to equip
    $popup.on('click', '.organ-candidate-card-grid', async function(e) {
      e.stopPropagation();
      const idx = $(this).data('idx');
      const targetOrgan = available[idx];
      if (targetOrgan) {
        $popup.remove();
        await equipOrganToSlot(selectedSubKey, targetOrgan);
      }
    });
  };

  const findAllBackpackOrgans = (data) => {
    const results = [];
    const validOrganSlots = ORGAN_SLOT_KEYS;
    const 器官背包 = safeObj(data?.人物?.器官系统?.器官背包) || safeObj(data?.人物?.背包?.器官);
    Object.entries(器官背包).forEach(([key, eq]) => {
      if (!eq) return;
      results.push({
        source: 'organpack',
        key: key,
        name: safeStr(eq.名称) || key,
        quality: safeStr(eq.品质, '普通'),
        desc: safeStr(eq.描述, '无描述'),
        level: safeNum(eq.强化等级),
        data: eq
      });
    });
    const 道具 = safeObj(data?.人物?.背包?.道具);
    Object.entries(道具).forEach(([name, item]) => {
      if (!item) return;
      const isOrgan = name.includes('器官') || (safeStr(item.描述).includes('器官'));
      if (isOrgan) {
        results.push({
          source: 'item',
          key: name,
          name: name,
          quality: safeStr(item.品质, '普通'),
          desc: safeStr(item.描述, '无描述'),
          level: safeNum(item.强化等级),
          data: item
        });
      }
    });
    const 装备列表 = safeObj(data?.人物?.装备列表);
    Object.entries(装备列表).forEach(([key, eq]) => {
      if (!eq) return;
      const isUnequipped = safeBool(eq.装备箱) === true;
      const eqName = safeStr(eq.名称);
      const eqType = safeStr(eq.类型);
      const eqPart = safeStr(eq.部位);
      const isOrgan = eqName.includes('器官') || eqType.includes('器官') || (eqPart && validOrganSlots.includes(eqPart));
      if (isUnequipped && isOrgan) {
        results.push({
          source: 'equip',
          key: key,
          name: eqName || key,
          quality: safeStr(eq.品质, '普通'),
          desc: safeStr(eq.描述, '无描述'),
          level: safeNum(eq.强化等级),
          data: eq
        });
      }
    });
    return results;
  };

  ;

  ;

  const showRejectionMedicinePopup = async () => {
    const data = fetchLatestMvuData();
    const sys = data?.人物?.器官系统;
    const 列表 = safeObj((sys || {}).器官列表);
    const 药数量 = safeNum((sys || {}).排异药剂数量);
    if (药数量 <= 0) {
      showToast('warn', '排异药剂不足，无法使用');
      return;
    }
    const 未排异槽位 = Object.entries(列表).filter(([k, o]) => o && !o.空 && safeBool(o.已排异) !== true)
      .map(([k, o]) => ({ source: 'slot', key: k, organ: o }));
    const 背包器官 = findAllBackpackOrgans(data)
      .filter(item => safeBool(item.data?.已排异) !== true)
      .map(item => ({ source: item.source, key: item.key, organ: item.data }));

    const 未排异器官 = [...未排异槽位, ...背包器官];
    if (未排异器官.length === 0) {
      showToast('info', '当前没有需要排异的器官');
      return;
    }
    const organMap = new Map(未排异器官.map(i => [i.key + '_' + i.source, i]));
    const qColorMap = ORGAN_QUALITY_COLORS;

    // Store tooltip HTML in a map, keyed by composite key (key + source)
    const tooltipMap = {};
    let cardsHtml = '';
    未排异器官.forEach(item => {
      const organ = item.organ;
      const slotKey = item.key;
      const qColor = qColorMap[safeStr(organ.品质)] || '#57606a';
      const baseSlot = slotKey.includes('_') ? slotKey.split('_')[0] : slotKey;
      const slotIcon = getOrganIconClass(baseSlot, safeStr(organ.名称));
      const organName = stripNativePrefix(safeStr(organ.名称) || '未知器官');
      const lvl = safeNum(organ.强化等级);
      const level = lvl > 0 ? ` +${lvl}` : '';

      const sourceLabel = item.source === 'slot' ? '已装备' : '背包';
      tooltipMap[slotKey + '_' + item.source] = buildOrganTooltipHtml(organ, {
        name: organName,
        level,
        quality: safeStr(organ.品质, '普通'),
        qColor,
        slot: slotKey,
        sourceLabel,
      });

      cardsHtml += buildOrganCardHtml({
        iconClass: slotIcon,
        iconColor: qColor,
        name: organName + level,
        stateClass: ' rejection-organ-card is-unadapted',
        dataAttrs: 'data-slot="' + slotKey + '" data-source="' + item.source + '"',
      });
    });

    const html = `
      <div id="${SCRIPT_ID}-popup" class="fusion-popup-overlay">
        <div class="fusion-card organ-theme-card" style="width: 360px; --quality-color: #8e44ad; position: relative;">
          <button class="popup-close"><i class="ri-close-line"></i></button>
          ${renderOrganSharedTooltip()}
          ${buildOrganHeader({
            icon: 'ri-flask-fill',
            metaLabel: '排异药剂',
            title: '选择需要排异的器官',
            badges: `<span style="font-size: 10px; padding: 1px 6px; border-radius: 3px; background: rgba(142,68,173,0.1); color: #8e44ad; font-weight: 600;">×${药数量}</span>`,
            borderColor: 'rgba(142,68,173,0.25)'
          })}
          <div class="f-body" style="display: flex; flex-direction: column; gap: 8px;">
            <div style="font-size: 10px; color: var(--ot-text-weak); line-height: 1.3;">悬停查看详情，点击器官进行排异</div>
            <div class="rejection-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:4px;max-height:340px;overflow-y:auto !important;padding:2px;scrollbar-width:none;">
              ${cardsHtml}
            </div>
          </div>
        </div>
      </div>
    `;

    let $panel2 = $(`#organ-system-panel`);
    if (!$panel2.length) $panel2 = $(`#${SCRIPT_ID}-panel`);
    $panel2.find(`#${SCRIPT_ID}-popup`).remove();
    $panel2.append(html);
    const $popup = $panel2.find(`#${SCRIPT_ID}-popup`);
    ensureOrganPopupBaseStyle();

    bindOrganPopupClose($popup);

    // Tooltip on hover - 使用统一 placeOrganTooltip（修复越界 bug）
    // 视觉 hover（红辉光 + scale）由 CSS organ-slot-card-base.is-unadapted:hover 处理
    const rejectionPopCard = $popup.find('.fusion-card')[0];
    $popup.on('mouseenter', '.rejection-organ-card', function() {
      const slotKey = $(this).data('slot');
      const source = $(this).data('source') || 'slot';
      const tipContent = tooltipMap[slotKey + '_' + source];
      if (!tipContent) return;
      const $tooltip = $popup.find('#organ-shared-tooltip');
      $tooltip.html(tipContent);
      placeOrganTooltip($tooltip, this, rejectionPopCard, 8);
    }).on('mouseleave', '.rejection-organ-card', function() {
      $popup.find('#organ-shared-tooltip').hide();
    });

    // Click organ -> show confirm dialog
    $popup.on('click', '.rejection-organ-card', function(e) {
      e.stopPropagation();
      const slotKey = $(this).data('slot');
      const source = $(this).data('source') || 'slot';
      if (!slotKey) return;
      // Look up from combined list (supports both slot and backpack)
      const item = organMap.get(slotKey + '_' + source);
      if (!item) return;
      const organ = item.organ;
      const qColor = qColorMap[safeStr(organ.品质)] || '#57606a';
      const organName = stripNativePrefix(safeStr(organ.名称) || '未知器官');
      const baseSlot = slotKey.includes('_') ? slotKey.split('_')[0] : slotKey;
      const slotIcon = getOrganIconClass(baseSlot, safeStr(organ.名称));
      const sourceLabel = source === 'slot' ? '已装备' : '背包';

      const confirmHtml = `
        <div id="rejection-confirm-overlay" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:10000;filter:none !important;">
          <div style="background:var(--tt-bg-soft);border-radius:12px;padding:20px 24px;box-shadow:0 8px 32px rgba(0,0,0,0.2);max-width:280px;width:90%;text-align:center;color:var(--tt-bg-soft-text);filter:none !important;">
            <i class="${slotIcon}" style="font-size:28px;color:${qColor};display:block;margin-bottom:8px;"></i>
            <div style="font-size:14px;font-weight:700;color:${qColor};text-shadow:0 1px 1.5px rgba(0,0,0,0.45),0 -1px 1.5px rgba(0,0,0,0.45),1px 0 1.5px rgba(0,0,0,0.45),-1px 0 1.5px rgba(0,0,0,0.45);margin-bottom:4px;">${organName}</div>
            <div style="font-size:11px;color:var(--ot-text-sub);margin-bottom:4px;">部位: ${slotKey} | ${sourceLabel}</div>
            <div style="font-size:11px;color:var(--ot-text-weak);margin-bottom:16px;">是否消耗 1 瓶排异药剂进行排异？</div>
            <div style="display:flex;gap:10px;justify-content:center;">
              <button id="rejection-confirm-yes" style="flex:1;padding:8px 0;border:1.5px solid #8e44ad;border-radius:8px;background:rgba(142,68,173,0.08);color:#8e44ad;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.12s;">是</button>
              <button id="rejection-confirm-no" style="flex:1;padding:8px 0;border:1.5px solid var(--ot-border);border-radius:8px;background:var(--ot-bg);color:var(--ot-text-sub);font-size:13px;font-weight:600;cursor:pointer;transition:all 0.12s;">否</button>
            </div>
          </div>
        </div>
      `;
      $popup.append(confirmHtml);
      const $overlay = $popup.find('#rejection-confirm-overlay');

      $overlay.find('#rejection-confirm-no').on('mouseenter', function() {
        $(this).css({ background: 'var(--ot-bg-soft)', borderColor: 'var(--ot-text-weak)' });
      }).on('mouseleave', function() {
        $(this).css({ background: 'var(--ot-bg)', borderColor: 'var(--ot-border)' });
      }).on('click', function(e) {
        e.stopPropagation();
        $overlay.remove();
      });

      $overlay.find('#rejection-confirm-yes').on('mouseenter', function() {
        $(this).css({ background: '#8e44ad', color: '#fff' });
      }).on('mouseleave', function() {
        $(this).css({ background: 'rgba(142,68,173,0.08)', color: '#8e44ad' });
      }).on('click', async function(e) {
        e.stopPropagation();
        $overlay.remove();
        // Build patch path based on source
        let organPath;
        if (source === 'slot') {
          organPath = `/人物/器官系统/器官列表/${slotKey}/已排异`;
        } else if (source === 'organpack') {
          organPath = `/人物/器官系统/器官背包/${slotKey}/已排异`;
        } else if (source === 'item') {
          organPath = `/人物/背包/道具/${slotKey}/已排异`;
        } else if (source === 'equip') {
          organPath = `/人物/装备列表/${slotKey}/已排异`;
        } else {
          showToast('error', '未知器官来源');
          return;
        }
        const patches = [
          { op: 'replace', path: organPath, value: true },
          { op: 'replace', path: `/人物/器官系统/排异药剂数量`, value: 药数量 - 1 }
        ];
        const success = await applyMvuPatches(patches);
        if (success) {
          showToast('success', `已对 ${organName} 完成排异`);
          $popup.remove();
          updateOrganUI();
        } else {
          showToast('error', '保存数据失败');
        }
      });
    });
  };

const showOrganItemDetailPopup = (organItem, $targetPanel) => {
  // Use target panel's document context so the popup appears in the right frame
  const targetDoc = $targetPanel && $targetPanel.length ? $targetPanel[0].ownerDocument : document;
  const $ = (targetDoc.defaultView && targetDoc.defaultView.jQuery) || window.parent.jQuery || window.parent.$ || window.jQuery || window.$;
  // ---
  const 器官列表 = fetchLatestMvuData()?.人物?.器官系统?.器官列表 || {};
  const subKey = (key, count, i) => count > 1 ? key + '_' + i : key;
  // 接受已算好的 subKey，避免循环里反复计算
  const organName = (k) => {
    const o = 器官列表[k];
    return (!o || o.空) ? '空' : (safeStr(o.名称) || '未知');
  };
  const organData = safeObj(organItem.data);
  const bonus = safeObj(organData.属性加成);
  const isUnadaptedDetail = safeBool(organData.已排异) !== true;
  const tagsHtml = Object.entries(bonus).filter(([, v]) => v !== 0)
    .map(([k, v]) => {
      const displayVal = isUnadaptedDetail ? v / 2 : v;
      return `<span class="organ-bonus-chip">${k} ${displayVal>0?'+':''}${formatAttrVal(displayVal)}</span>`;
    }).join('');
  const unadaptedWarning = isUnadaptedDetail
    ? '<div style="margin-top:4px;font-size:9px;color:#cf222e;">⚠ 未排异，属性暂时减半</div>'
    : '';
  const statsHtml = (tagsHtml || unadaptedWarning)
    ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">${tagsHtml}${unadaptedWarning}</div>`
    : '<div style="font-size:10px;color:var(--tt-bg-soft-text-sub);font-style:italic;margin-top:6px;">无属性加成</div>';
  const itemQColor = ORGAN_QUALITY_COLORS[safeStr(organItem.quality, '普通')] || '#57606a';
  const slotCard = ({ key, count, icon }) => {
    let best = { key, name: '空', lv: -1 };
    for (let i = 1; i <= count; i++) {
      const k = subKey(key, count, i);
      const o = 器官列表[k];
      const hasOrgan = o && !o.空;
      if (hasOrgan) {
        const lv = safeNum(o.强化等级, 0);
        if (lv > best.lv) best = { key: k, name: organName(k), lv };
      }
    }
    const isEmpty = (best.lv === -1);
    const stateClass = isEmpty ? ' is-empty' : ' has-organ';
    // 检查所有子槽位的未排异状态
    let hasAnyUnadapted = false;
    let bestIsUnadapted = false;
    for (let i = 1; i <= count; i++) {
      const k = subKey(key, count, i);
      const o = 器官列表[k];
      if (o && !o.空 && safeBool(o.已排异) !== true) {
        hasAnyUnadapted = true;
        if (k === best.key) bestIsUnadapted = true;
      }
    }
    const innerUnadaptedClass = hasAnyUnadapted ? ' is-unadapted' : '';
    const targetBestOrgan = (!isEmpty) ? 器官列表[best.key] : null;
    const bestQColor = (!isEmpty && targetBestOrgan)
      ? (ORGAN_QUALITY_COLORS[safeStr(targetBestOrgan.品质, '普通')] || '#57606a')
      : 'var(--ot-text-weak)';
    const subItemsHtml = Array.from({ length: count }, (_, i) => {
      const k = subKey(key, count, i + 1);
      const o = 器官列表[k];
      const hasOrg = o && !o.空;
      const isUnad = hasOrg && safeBool(o.已排异) !== true;
      const subColor = isUnad ? '#cf222e' : 'var(--ot-text-main)';
      const subBorder = isUnad ? '1px solid rgba(207,34,46,0.35)' : '1px solid rgba(139,107,74,0.2)';
      return `<div class="sub-menu-item" data-target-slot="${k}" style="display:flex;align-items:center;gap:8px;padding:5px 8px;font-size:11.5px;cursor:pointer;border-radius:5px;transition:background 0.12s;color:${subColor};border:${subBorder};"><i class="${icon}" style="font-size:13px;color:#8b6b4a;flex-shrink:0;"></i><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${organName(k)}</span></div>`;
    }).join('');
    const iconColor = isEmpty ? 'var(--ot-text-weak)' : 'var(--ot-text-sub)';
    const subName = isEmpty ? key : best.name;
    return `<div class="organ-card-base organ-slot-card-base target-slot-btn${stateClass}" data-target-slot="${best.key}" data-slot-key="${key}" data-slot-count="${count}" style="z-index:1;min-height:56px;overflow:visible;"><div class="organ-slot-card-inner${innerUnadaptedClass}"><i class="${icon} card-icon" style="color:${iconColor};"></i><span style="font-size:10px;color:${bestQColor};text-shadow:0 1px 1.5px rgba(0,0,0,0.45),0 -1px 1.5px rgba(0,0,0,0.45),1px 0 1.5px rgba(0,0,0,0.45),-1px 0 1.5px rgba(0,0,0,0.45);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:74px;line-height:1.2;margin-top:2px;">${subName}</span></div><div class="slot-sub-menu" data-slot-key="${key}" style="display:none;position:absolute;min-width:120px;background:var(--tt-bg-soft,#f2e6ce);border:1px solid rgba(139,107,74,0.25);border-radius:8px;padding:4px;box-shadow:0 6px 20px rgba(0,0,0,0.18);z-index:99999;pointer-events:auto;">${subItemsHtml}</div></div>`;
  };

  // ---
  const html = `<div id="${SCRIPT_ID}-popup" class="fusion-popup-overlay" style="display:flex;align-items:center;justify-content:center;position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;"><div class="fusion-card organ-theme-card" style="width:480px !important;max-width:480px !important;"><button class="popup-close"><i class="ri-close-line"></i></button><div class="f-body" style="display:flex;flex-direction:column;gap:8px;"><div class="organ-info" style="background:var(--ot-bg-soft);border:1px solid var(--ot-border);border-radius:8px;padding:8px 10px;"><div style="font-size:10px;color:var(--ot-text-sub);margin-bottom:4px;">器官背包详情</div><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="font-size:15px;font-weight:700;color:${itemQColor};">${safeStr(organItem.name)}</span><span style="font-size:10px;padding:2px 7px;border-radius:3px;background:${itemQColor}22;color:${itemQColor};font-weight:600;">${safeStr(organItem.quality)}</span></div><div style="font-size:10.5px;color:var(--ot-text-sub);line-height:1.5;">${safeStr(organItem.desc) || '无描述'}</div>${statsHtml}</div><div style="font-size:11px;font-weight:600;color:#4a3c31;margin-top:2px;display:flex;align-items:center;gap:4px;"><i class="ri-grid-line"></i> 选择装配部位</div><div class="target-slots-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">${slotsDef.map(slotCard).join('')}</div><div style="font-size:9.5px;color:var(--ot-text-weak);margin-top:4px;text-align:center;">点击直接装配 · 悬停查看多槽位</div></div></div></div>`;

  const $panel = ($targetPanel && $targetPanel.length) ? $targetPanel : $('#' + SCRIPT_ID + '-panel');
  // Remove any existing popup in the target panel
  $panel.find('#' + SCRIPT_ID + '-popup').remove();
  $panel.append(html);
  const $popup = $panel.find('#' + SCRIPT_ID + '-popup');
  const popCard = $popup[0];
  if (!popCard) return;

  // ---
  // 基础样式（与排异弹窗共享）由 ensureOrganPopupBaseStyle() 注入；
  ensureOrganPopupBaseStyle(targetDoc);

  // ---
  // 关键：sub 必须始终在 fusion-card 内（popup 自身框内），不是视口内
  // 视口作为边界没意义——popup 在视口中央，sub 跨出 popup 才需要避屏边；
  // 但只要 popup 自身的 fusion-card overflow:visible + sub 在 card 内钳制，跨出 popup 也不会被切。
  const cardEl = popCard.querySelector('.fusion-card.organ-theme-card') || popCard.querySelector('.fusion-card');
  if (!cardEl) return;
  const cardRect = cardEl.getBoundingClientRect();
  const M = 6;
  popCard.querySelectorAll('.target-slot-btn').forEach(btn => {
    const sub = btn.querySelector('.slot-sub-menu');
    let hideTimer = null;
    const show = () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      // 立即提升按钮 stacking context 到最顶层——必须在 reflow/sub 显示之前，
      // 否则浏览器会先在 z-index:1 那一帧绘制 sub（被其他按钮遮挡），
      // 再在下一帧提升后绘制 sub（不再被遮挡）→ 视觉闪烁
      btn.style.zIndex = '100';
      // 重置 sub 定位 + 拿到 sw/sh
      sub.style.cssText += ';visibility:hidden;display:block;top:0;left:0;right:auto;bottom:auto;transform:none';
      void sub.offsetHeight; // 强制 reflow 测真实尺寸
      const sw = sub.offsetWidth;
      const sh = sub.offsetHeight;

      // ---
      const br = btn.getBoundingClientRect();
      const minSubL = cardRect.left + M;
      const maxSubL = cardRect.right - sw - M;
      const idealSubL = br.left + br.width / 2 - sw / 2;
      const subL = Math.max(minSubL, Math.min(maxSubL, idealSubL));
      sub.style.left = (subL - br.left) + 'px';

      const minSubT = cardRect.top + M;
      const maxSubT = cardRect.bottom - sh - M;
      const idealSubT = br.bottom + M;
      let subT;
      if (idealSubT + sh <= cardRect.bottom - M) {
        subT = idealSubT;
      } else if (br.top - sh - M >= cardRect.top + M) {
        subT = br.top - sh - M;
      } else {
        // 都不够：在 card 内找一个居中位置
        subT = Math.max(minSubT, Math.min(maxSubT, br.top + br.height / 2 - sh / 2));
      }
      sub.style.top = (subT - br.top) + 'px';

      sub.style.visibility = 'visible';
      // 凸起效果由 CSS :hover 接管（.target-slot-btn:hover .organ-slot-card-inner）
    };
    const scheduleHide = () => {
      hideTimer = setTimeout(() => {
        sub.style.display = 'none';
        btn.style.zIndex = '1';
        hideTimer = null;
      }, 45);
    };
    const iconEl = btn.querySelector('.card-icon');
    if (!iconEl) return;
    iconEl.addEventListener('mouseenter', show);
    iconEl.addEventListener('mouseleave', scheduleHide);
    sub.addEventListener('mouseenter', () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    });
    sub.addEventListener('mouseleave', scheduleHide);
    sub.querySelectorAll('.sub-menu-item').forEach(it => {
      it.addEventListener('mouseenter', () => it.style.background = 'rgba(139,107,74,0.12)');
      it.addEventListener('mouseleave', () => it.style.background = 'transparent');
    });
  });
  popCard.addEventListener('click', async e => {
    const t = e.target.closest('.target-slot-btn, .sub-menu-item');
    if (!t) return;
    e.stopPropagation();
    const slot = t.dataset.targetSlot;
    if (!slot) return;

    const isSubMenuItem = t.classList.contains('sub-menu-item');

    if (isSubMenuItem) {
      // sub-menu 项：装备后**留在弹窗内**，重绘 popup 以刷新 slot 状态
      await equipOrganToSlot(slot, organItem);
      $popup.remove();
      showOrganItemDetailPopup(organItem);
    } else {
      // 直接点 target-slot-btn（单槽位）：装备后退出弹窗
      $popup.remove();
      equipOrganToSlot(slot, organItem);
    }
  });

  // ---
  bindOrganPopupClose($popup);
};
  // 12 个标准槽位（位置坐标 + 数量）— 视觉布局元数据
  const SLOTS_LAYOUT = {
    眼球: { count: 2, x: 50.0, y: 7.0 },
    心脏: { count: 1, x: 72.0, y: 12.9 },
    肺脏: { count: 2, x: 88.1, y: 29.0 },
    胃:   { count: 1, x: 94.0, y: 51.0 },
    肠子: { count: 1, x: 88.1, y: 73.0 },
    阑尾: { count: 1, x: 72.0, y: 89.1 },
    肌肉: { count: 8, x: 50.0, y: 95.0 },
    肝脏: { count: 1, x: 28.0, y: 89.1 },
    脾脏: { count: 1, x: 11.9, y: 73.0 },
    肾脏: { count: 2, x: 6.0,  y: 51.0 },
    肋骨: { count: 4, x: 11.9, y: 29.0 },
    脊柱: { count: 1, x: 28.0, y: 12.9 }
  };
  const slotsDef = ORGAN_STANDARD_SLOTS.map(key => ({
    key,
    count: SLOTS_LAYOUT[key].count,
    icon: ORGAN_SLOTS[key].icon,
    x: SLOTS_LAYOUT[key].x,
    y: SLOTS_LAYOUT[key].y
  }));

  
  const formatAttrVal = (v) => {
    const num = Number(v);
    if (!Number.isFinite(num)) return v;
    const rounded = Math.round(num * 10) / 10;
    return rounded % 1 === 0 ? rounded.toString() : rounded.toFixed(1);
  };
  const safeNum=(v,f=0)=>typeof v==="number"&&!isNaN(v)?v:typeof v==="string"?parseFloat(v)||f:f;
  const safeStr=(v,f="")=>v!=null&&v!==""&&v!==false?String(v):f;
  const safeArr=(v,f=[])=>Array.isArray(v)?v:f;
  const safeObj=(v,f={})=>v&&typeof v==="object"&&!Array.isArray(v)?v:f;
  const safeBool=(v,f=false)=>typeof v==="boolean"?v:f;
  // 安全读取器官属性加成中的数值
  const getOrganBonus = (organ, attr, fallback = 0) => {
    const bonus = safeObj(organ.属性加成);
    return safeNum(bonus[attr], fallback);
  };

  const recalculateOrganSystemStats = async () => {
    const data = fetchLatestMvuData();
    if (!data || !data.人物) return { 排斥等级: 0, 健康度: 100 };
    const sys = data.人物.器官系统 = data.人物.器官系统 || {};
    const 列表 = sys.器官列表 = sys.器官列表 || {};

    let 排斥等级 = 0;

    Object.values(列表).forEach(organ => {
      if (organ && !organ.空) {
        if (safeBool(organ.已排异) !== true) {
          排斥等级++;
        }
      }
    });

    // 基础健康度 100，每 1 个未排异器官扣除 15%，最低 0
    const 健康度 = Math.max(0, 100 - 排斥等级 * 15);

    // 如果数据有变化则保存 (异步)
    if (sys.排斥等级 !== 排斥等级 || sys.健康度 !== 健康度) {
      sys.排斥等级 = 排斥等级;
      sys.健康度 = 健康度;
      const patches = [
        { op: 'replace', path: '/人物/器官系统/排斥等级', value: 排斥等级 },
        { op: 'replace', path: '/人物/器官系统/健康度', value: 健康度 }
      ];
      applyMvuPatches(patches).catch(err => console.error('[RPG] Failed to save rejection stats:', err));
    }

    return { 排斥等级, 健康度 };
  };

  const updateOrganUI = () => {
    if (!$) {
      console.warn('[RPG StatusBar] jQuery not available in updateOrganUI');
      return;
    }
    // 同时更新基础面板和独立面板
    const $panels = [];
    const $basePanel = $(`#${SCRIPT_ID}-panel`);
    if ($basePanel.length) $panels.push($basePanel);
    // 独立面板可能在父窗口
    let $standalonePanel;
    try {
      const pw$ = (window.parent && (window.parent.jQuery || window.parent.$));
      if (pw$) $standalonePanel = pw$('#organ-system-panel');
    } catch(e) {}
    if (!$standalonePanel || !$standalonePanel.length) {
      $standalonePanel = $(`#organ-system-panel`);
    }
    if ($standalonePanel && $standalonePanel.length) $panels.push($standalonePanel);

    $panels.forEach($panel => {
    const data = fetchLatestMvuData();
    const race = data?.人物?.种族 || '';
    const organSystem = data?.人物?.器官系统 || {};
    const 器官列表 = organSystem.器官列表 || {};
    // 动态计算排斥等级和健康度
    let 排斥等级 = 0;
    Object.values(器官列表).forEach(o => {
      if (o && !o.空 && o.已排异 !== true) 排斥等级++;
    });
    const 健康度Val = Math.max(0, 100 - 排斥等级 * 15);
    const 套装 = organSystem.已激活套装 || [];
    // 异步更新到 MVU (不阻塞 UI)
    recalculateOrganSystemStats().catch(err => console.error('[RPG] recalc error:', err));

    const getEffectColor = (name, desc = '') => {
      const text = (name + desc).toLowerCase();
      const isNegative = /诅诅|诅咒|排斥|受损|缺陷|惩罚|降低|减少|扣除|副作用|毒|病|弱化|流血/.test(text);
      if (isNegative) {
        return {
          color: '#cf222e',
          bg: 'rgba(207, 34, 46, 0.03)',
          border: '#cf222e40'
        };
      }
      if (name.includes('机械') || name.includes('金属') || name.includes('科技')) {
        return {
          color: '#0969da',
          bg: 'rgba(9, 105, 218, 0.03)',
          border: '#0969da40'
        };
      }
      // Default positive/buff (Green)
      return {
        color: '#2ea87a',
        bg: 'rgba(46, 168, 122, 0.03)',
        border: '#2ea87a40'
      };
    };

    const expandedSlots = [];
    slotsDef.forEach(s => {
      const count = s.count || 1;
      if (count > 1) {
        for (let i = 1; i <= count; i++) {
          expandedSlots.push({ key: `${s.key}_${i}`, baseKey: s.key });
        }
      } else {
        expandedSlots.push({ key: s.key, baseKey: s.key });
      }
    });

    const $organInfo = $panel.find('#organ-status-info');
    if ($organInfo.length) {
      const healthColor = 健康度Val > 70 ? '#2ea87a' : (健康度Val > 30 ? '#d4a017' : '#cf222e');
      const rejectColor = 排斥等级 === 0 ? '#2ea87a' : (排斥等级 < 3 ? '#d4a017' : '#cf222e');
      $organInfo.html(`
        <div class="organ-status-header-row">
          <span><i class="ri-heart-pulse-line animate-pulse"></i> 排斥健康度: <b style="color:${healthColor}">${健康度Val}%</b></span>
          <span><i class="ri-shield-flash-line"></i> 排斥等级: <b style="color:${rejectColor}">${排斥等级}</b></span>
        </div>
      `);
    }

    const $organSet = $panel.find('#organ-set-info');
    if ($organSet.length) {
      if (套装 && 套装.length > 0) {
        const setHtml = 套装.map(s => `<span class="organ-set-chip">${s}</span>`).join('');
        $organSet.html(`<div class="organ-set-active-row">已激活套装: ${setHtml}</div>`).show();
      } else {
        $organSet.html('').hide();
      }
    }

    // 14 个生理指数卡片（从 PHYSIOLOGY_ATTRIBUTES 数据库生成）
    const attrsDef = [
      { key: '健康度',        name: '健康度',    icon: PHYSIOLOGY_ATTRIBUTES['健康度'].icon,        default: PHYSIOLOGY_ATTRIBUTES['健康度'].初始,        desc: '生命值发生 {pct}% 变动。' },
      { key: '视觉',          name: '视觉',      icon: PHYSIOLOGY_ATTRIBUTES['视觉'].icon,          default: PHYSIOLOGY_ATTRIBUTES['视觉'].初始,          desc: '动态视力与感知变动 {val}。' },
      { key: '坚韧',          name: '坚韧',      icon: PHYSIOLOGY_ATTRIBUTES['坚韧'].icon,          default: PHYSIOLOGY_ATTRIBUTES['坚韧'].初始,          desc: '伤害发生 {pct}% 变动。' },
      { key: '神经传递效率',  name: '神经传递',  icon: PHYSIOLOGY_ATTRIBUTES['神经传递效率'].icon,  default: PHYSIOLOGY_ATTRIBUTES['神经传递效率'].初始,  desc: '先攻与反应速度发生 {pct}% 变动。' },
      { key: '血液过滤效率',  name: '血液过滤',  icon: PHYSIOLOGY_ATTRIBUTES['血液过滤效率'].icon,  default: PHYSIOLOGY_ATTRIBUTES['血液过滤效率'].初始,  desc: '流血恢复与再生效率发生 {pct}% 变动。' },
      { key: '解毒效率',      name: '解毒效率',  icon: PHYSIOLOGY_ATTRIBUTES['解毒效率'].icon,      default: PHYSIOLOGY_ATTRIBUTES['解毒效率'].初始,      desc: '药效与抗毒持续时间变动 {val} 秒。' },
      { key: '新陈代谢效率',  name: '新陈代谢',  icon: PHYSIOLOGY_ATTRIBUTES['新陈代谢效率'].icon,  default: PHYSIOLOGY_ATTRIBUTES['新陈代谢效率'].初始,  desc: '经验值获取率变动 {pct}%。' },
      { key: '肺活量',        name: '肺活量',    icon: PHYSIOLOGY_ATTRIBUTES['肺活量'].icon,        default: PHYSIOLOGY_ATTRIBUTES['肺活量'].初始,        desc: '屏息与窒息耐受率变动 {pct}%。' },
      { key: '耐力',          name: '耐力',      icon: PHYSIOLOGY_ATTRIBUTES['耐力'].icon,          default: PHYSIOLOGY_ATTRIBUTES['耐力'].初始,          desc: '濒死战续极限概率变动 {pct}%。' },
      { key: '消化效率',      name: '消化效率',  icon: PHYSIOLOGY_ATTRIBUTES['消化效率'].icon,      default: PHYSIOLOGY_ATTRIBUTES['消化效率'].初始,      desc: '抗毒与食物转化效率变动 {pct}%。' },
      { key: '营养获取效率',  name: '营养获取',  icon: PHYSIOLOGY_ATTRIBUTES['营养获取效率'].icon,  default: PHYSIOLOGY_ATTRIBUTES['营养获取效率'].初始,  desc: '药效吸收放大 {val} 倍。' },
      { key: '幸运',          name: '幸运',      icon: PHYSIOLOGY_ATTRIBUTES['幸运'].icon,          default: PHYSIOLOGY_ATTRIBUTES['幸运'].初始,          desc: '幸运一击触发几率提高 {pct}%。' },
      { key: '速度',          name: '速度',      icon: PHYSIOLOGY_ATTRIBUTES['速度'].icon,          default: PHYSIOLOGY_ATTRIBUTES['速度'].初始,          desc: '基础战术位移距离增减 {val} 米。' },
      { key: '筋力',          name: '筋力',      icon: PHYSIOLOGY_ATTRIBUTES['筋力'].icon,          default: PHYSIOLOGY_ATTRIBUTES['筋力'].初始,          desc: '近战伤害增幅 {pct}%，额外负重上限 {weight}kg。' }
    ];


    // 读取旧数据时自动除以count（兼容旧版本未除值的多槽位器官）
    const normalizeStoredOrgan = (organ, baseKey) => {
      if (!organ || organ.空 || !organ.属性加成) return organ;
      const count = (SLOTS_LAYOUT[baseKey] && SLOTS_LAYOUT[baseKey].count) || 1;
      if (count <= 1) return organ;
      const defOrg = defaultOrgans[baseKey];
      if (!defOrg || !defOrg.属性加成) return organ;
      let needsNorm = false;
      Object.entries(defOrg.属性加成).forEach(([attr, undividedVal]) => {
        if (organ.属性加成[attr] !== undefined && Math.abs(Number(organ.属性加成[attr]) - Number(undividedVal)) < 0.001) {
          needsNorm = true;
        }
      });
      if (!needsNorm) return organ;
      const norm = JSON.parse(JSON.stringify(organ));
      Object.entries(defOrg.属性加成).forEach(([attr, undividedVal]) => {
        if (norm.属性加成[attr] !== undefined && Math.abs(Number(norm.属性加成[attr]) - Number(undividedVal)) < 0.001) {
          norm.属性加成[attr] = Number(undividedVal) / count;
        }
      });
      return norm;
    };

    const getAttrVal = (key) => {
      let total = 0;

      expandedSlots.forEach(slot => {
        const organ = 器官列表[slot.key];
        const isEmpty = !!organ && organ.空;
        const isNative = !organ;
        const isEquipped = !!organ && !organ.空;

        let activeOrgan = null;
        if (isNative) {
          activeOrgan = getNormalizedOrgan(getDefaultOrganForSlot(slot.baseKey, race), race);
        } else if (isEquipped) {
          activeOrgan = getNormalizedOrgan(normalizeStoredOrgan(organ, slot.baseKey), race);
        }

        if (activeOrgan && !activeOrgan.空 && activeOrgan.属性加成 && activeOrgan.属性加成[key] !== undefined) {
          let val = Number(activeOrgan.属性加成[key]);
          // 未排异的器官属性减半
          if (isEquipped && activeOrgan.已排异 !== true) {
            val = val / 2;
          }
          total += val;
        }
      });

      // 亡灵/不死种族：每个亡灵器官额外 +0.15 健康度
      if (key === '健康度' && race && (race.includes('亡灵') || race.includes('不死'))) {
        let undeadOrganCount = 0;
        expandedSlots.forEach(slot => {
          const organ = 器官列表[slot.key];
          if (organ && !organ.空) {
            const tags = organ.标签 || [];
            if (tags.includes('亡灵') || tags.includes('不死')) {
              undeadOrganCount++;
            }
          }
        });
        total += (undeadOrganCount * 0.15);
      }
      const activeResources = ['燃点', '储能', '能量', '怒气', '法力', '主动能量'];
      if (activeResources.includes(key) && total < 0) {
        total = 0;
      }
      return total;
    };

        // ---
    try {
let slotsHtml = `
      <div class="organ-slots-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #d4c4a8; padding-bottom: 4px; margin-bottom: 8px;">
        <span><i class="ri-heart-pulse-fill"></i> 躯体</span>
        <div class="organ-bg-controls" style="display: flex; gap: 8px; font-size: 10.5px;">
          <label for="organ-bg-upload" style="cursor: pointer; color: #7a6b50; font-weight: 600; display: inline-flex; align-items: center; gap: 2px;"><i class="ri-upload-2-line"></i> 换底图</label>
          <input type="file" id="organ-bg-upload" accept="image/*" style="display: none;" />
          <span id="organ-bg-reset" style="cursor: pointer; color: #cf222e; font-weight: 600; display: ${localStorage.getItem(`${SCRIPT_ID}-organ-bg`) ? 'inline-flex' : 'none'}; align-items: center; gap: 2px;"><i class="ri-refresh-line"></i> 重置</span>
        </div>
      </div>
      <div class="visual-organ-container" style="position: relative; ${localStorage.getItem(`${SCRIPT_ID}-organ-bg`) ? `background-image: url('${localStorage.getItem(`${SCRIPT_ID}-organ-bg`)}'); background-size: 100% 100%; background-position: center center; background-repeat: no-repeat;` : ''}">
        <svg class="vitruvian-background-svg" viewBox="0 0 100 100" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; transition: opacity 0.2s ease; ${localStorage.getItem(`${SCRIPT_ID}-organ-bg`) ? 'opacity: 0;' : ''}">
          <!-- 外接圆 -->
          <circle cx="50" cy="51" r="44" stroke="rgba(90, 70, 50, 0.22)" stroke-width="0.5" fill="none" />
          <!-- 外接正方形 -->
          <rect x="12" y="12" width="76" height="76" stroke="rgba(90, 70, 50, 0.22)" stroke-width="0.5" fill="none" />
          <!-- 对角线和水平垂直辅助线 -->
          <line x1="50" y1="12" x2="50" y2="88" stroke="rgba(90, 70, 50, 0.12)" stroke-width="0.4" stroke-dasharray="1 1" />
          <line x1="12" y1="50" x2="88" y2="50" stroke="rgba(90, 70, 50, 0.12)" stroke-width="0.4" stroke-dasharray="1 1" />
          
          <!-- 达芬奇人体剪影（双姿态叠合，通过淡灰色填充与细致线条勾勒） -->
          <!-- 姿态1：直立十字人体 -->
          <circle cx="50" cy="17" r="3.2" fill="rgba(90, 70, 50, 0.25)" stroke="rgba(90, 70, 50, 0.35)" stroke-width="0.4" />
          <rect x="49" y="20.2" width="2" height="1.8" fill="rgba(90, 70, 50, 0.25)" />
          <path d="M 46.5 22 L 53.5 22 L 52.5 48 L 47.5 48 Z" fill="rgba(90, 70, 50, 0.25)" stroke="rgba(90, 70, 50, 0.35)" stroke-width="0.4" />
          <path d="M 46.5 22 L 20 22 C 18.5 22 18.5 23.6 20 23.6 L 46.5 23.6 Z" fill="rgba(90, 70, 50, 0.25)" stroke="rgba(90, 70, 50, 0.3)" stroke-width="0.4" />
          <path d="M 53.5 22 L 80 22 C 81.5 22 81.5 23.6 80 23.6 L 53.5 23.6 Z" fill="rgba(90, 70, 50, 0.25)" stroke="rgba(90, 70, 50, 0.3)" stroke-width="0.4" />
          <path d="M 47.5 48 L 50 48 L 49.5 87 C 49.5 88.5 47.5 88.5 47.5 87 Z" fill="rgba(90, 70, 50, 0.22)" stroke="rgba(90, 70, 50, 0.3)" stroke-width="0.4" />
          <path d="M 50 48 L 52.5 48 L 52.5 87 C 52.5 88.5 50.5 88.5 50.5 87 Z" fill="rgba(90, 70, 50, 0.22)" stroke="rgba(90, 70, 50, 0.3)" stroke-width="0.4" />

          <!-- 姿态2：大字形展开人体 -->
          <path d="M 46.5 22.5 L 24 13 C 22.5 12.3 22 13.8 23 14.8 L 46.5 24 Z" fill="rgba(90, 70, 50, 0.16)" stroke="rgba(90, 70, 50, 0.25)" stroke-width="0.4" />
          <path d="M 53.5 22.5 L 76 13 C 77.5 12.3 78 13.8 77 14.8 L 53.5 24 Z" fill="rgba(90, 70, 50, 0.16)" stroke="rgba(90, 70, 50, 0.25)" stroke-width="0.4" />
          <path d="M 47.5 48 L 33 82 C 32 83.2 33.8 84.2 34.8 83 L 48.5 48 Z" fill="rgba(90, 70, 50, 0.14)" stroke="rgba(90, 70, 50, 0.22)" stroke-width="0.4" />
          <path d="M 52.5 48 L 67 82 C 68 83.2 66.2 84.2 65.2 83 L 51.5 48 Z" fill="rgba(90, 70, 50, 0.14)" stroke="rgba(90, 70, 50, 0.22)" stroke-width="0.4" />
        </svg>
    `;

    const getOrganLevelColor = (lvl) => {
      if (!lvl || lvl <= 0) return '#4a3c31'; // 古典铁锈褐
      if (lvl <= 3) return '#1a7f37'; // 精良绿
      if (lvl <= 6) return '#0969da'; // 稀有蓝
      if (lvl <= 9) return '#8250df'; // 史诗紫
      return '#cf222e'; // 传说红
    };

    // 只渲染12个品类的大圆圈插槽（与上个版本完全一致的主界面显示种类）
    slotsDef.forEach(s => {
      const count = s.count || 1;
      let activeCount = 0;
      let firstOrgan = null;
      let allNative = true;
      let allEmpty = true;

      for (let i = 1; i <= count; i++) {
        const subKey = count > 1 ? `${s.key}_${i}` : s.key;
        const organInList = 器官列表[subKey];
        const isEmpty = !!organInList && organInList.空;
        const isEquipped = !!organInList && !organInList.空;
        const isNative = !organInList;

        if (!isEmpty) {
          activeCount++;
          if (isEquipped && !firstOrgan) {
            firstOrgan = organInList;
          }
          if (!isNative) {
            allNative = false;
          }
          allEmpty = false;
        }
      }

      let displayName = '';
      let qClass = 'quality-default';
      let borderStyle = '';
      let lvlColor = '#57606a';
      let slotClass = 'empty-organ';
      let nameColor = '#57606a';
      let isUnadapted = false;

      if (allEmpty) {
        displayName = `[${s.key}]`;
        qClass = 'is-empty';
        slotClass = 'is-empty';
        nameColor = '#afb8c1';
      } else {
        let baseName = '';
        let level = 0;
        if (firstOrgan) {
          baseName = firstOrgan.名称 || s.key;
          level = firstOrgan.强化等级 || 0;
          allNative = false;
        } else {
          baseName = `人类${s.key}`;
        }

        const organLevel = level > 0 ? ` +${level}` : "";
        const suffix = (count > 1) ? ` (${activeCount}/${count})` : "";
        displayName = `${baseName}${organLevel}${suffix}`;

        lvlColor = getOrganLevelColor(level);
        nameColor = allNative ? '#8c8c8c' : lvlColor;

        if (!allNative) {
          slotClass = 'has-organ';
          const quality = (firstOrgan || {}).品质 || '普通';
          if (quality === '稀有' || quality === '史诗') qClass = 'quality-rare';
          else if (quality === '传说' || quality === '神话') qClass = 'quality-legendary';
          else if (quality === '诅诅' || quality === '诅咒') qClass = 'quality-cursed';
          if (level > 0) {
            borderStyle = `border-color: ${lvlColor} !important; box-shadow: 0 0 5px ${lvlColor}aa;`;
          }
        }
        // 检测是否未排异
        isUnadapted = firstOrgan && firstOrgan.已排异 !== true;
        if (isUnadapted) {
          qClass += ' quality-unadapted';
        }
      }

      slotsHtml += `
        <div class="organ-gear-slot ${slotClass} ${qClass}"
             style="top: ${s.y}%; left: ${s.x}%; cursor: pointer;"
             data-slot-key="${s.key}">
          <div class="organ-gear-circle" style="${borderStyle}">
            <i class="${s.icon}"></i>
          </div>
          <div class="organ-gear-label-box">
            <span class="organ-gear-val-name" style="color: ${nameColor};">${displayName}</span>
          </div>
        </div>
      `;
    });
    slotsHtml += '</div>';

    const $list = $panel.find('#organ-page-list');
    if ($list.length) {
      $list.html(slotsHtml);
      // (backpack, medicine, click handlers continue directly below inside if)
      const allBackpackOrgans = findAllBackpackOrgans(data);
      const $backpackGrid = $panel.find('#organ-backpack-grid');
      const $backpackCount = $panel.find('.organ-backpack-count');
      if ($backpackGrid.length) {
        $backpackCount.text(`${allBackpackOrgans.length} 件`);
        if (allBackpackOrgans.length === 0) {
          $backpackGrid.html(`
            <div class="organ-backpack-empty" class="organ-empty-state">
              <i class="ri-briefcase-3-line" style="font-size: 22px; color: #c4b08a;"></i>
              <span>背包中暂无可用器官配件</span>
            </div>
          `);
        } else {
          const tooltipMap = {};
          let backpackHtml = '';
          allBackpackOrgans.forEach((item, idx) => {
            const color = ORGAN_QUALITY_COLORS[item.quality] || '#57606a';
            const slotGuess = item.data?.部位 || guessSlotFromOrganName(item.name) || '通用';
            const level = item.level > 0 ? ` +${item.level}` : '';
            const isBackpackAdapted = item.data?.已排异 === true;
            const backpackStateClass = isBackpackAdapted ? '' : ' is-unadapted';
            const cleanName = stripNativePrefix(item.name);
            tooltipMap[`bp_${idx}`] = buildOrganTooltipHtml(item.data, {
              name: cleanName,
              level,
              quality: item.quality,
              qColor: color,
              slot: slotGuess,
              sourceLabel: '背包',
            });
            backpackHtml += buildOrganCardHtml({
              iconClass: getOrganIconClass(slotGuess, item.name),
              iconColor: color,
              name: cleanName + level,
              stateClass: ' organ-backpack-item' + backpackStateClass,
              dataAttrs: 'data-bp-idx="' + idx + '"',
              innerStyle: '',
            });
          });
          $backpackGrid.html(backpackHtml);

          // 确保 tooltip 容器存在（.html() 会移除原有的）
          if (!$backpackGrid.find('#organ-backpack-tooltip').length) {
            $backpackGrid.prepend('<div id="organ-backpack-tooltip" class="organ-tooltip-container"></div>');
          }

          // 绑定悬停 tooltip
          $backpackGrid.off('mouseenter', '.organ-backpack-item').on('mouseenter', '.organ-backpack-item', function() {
            const idx = $(this).data('bp-idx');
            const tipContent = tooltipMap[`bp_${idx}`];
            if (!tipContent) return;
            const $tooltip = $panel.find('#organ-backpack-tooltip');
            if (!$tooltip.length) return;
            $tooltip.html(tipContent);
            placeOrganTooltip($tooltip, this, $backpackGrid[0], 8);
          }).off('mouseleave', '.organ-backpack-item').on('mouseleave', '.organ-backpack-item', function() {
            $panel.find('#organ-backpack-tooltip').hide();
          });

          // 绑定点击
          $backpackGrid.find('.organ-backpack-item').on('click', function() {
            const idx = $(this).data('bp-idx');
            const item = allBackpackOrgans[idx];
            if (item) showOrganItemDetailPopup(item, $panel);
          });
        }
      }

      // 渲染排异药剂数量并绑定按钮
      const 排异药剂数量 = (typeof data?.人物?.器官系统?.排异药剂数量 === 'number') ? data.人物.器官系统.排异药剂数量 : 0;
      const $medicineCount = $panel.find('.organ-medicine-count');
      if ($medicineCount.length) {
        $medicineCount.text(`${排异药剂数量 ?? 0}`);
      }
      $panel.find('#organ-medicine-btn').off('click').off('mouseenter').on('click', function() {
        showRejectionMedicinePopup();
      }).on('mouseenter', function() {
        $(this).css({ borderColor: '#8e44ad', background: 'rgba(142,68,173,0.18)' });
      }).on('mouseleave', function() {
        $(this).css({ borderColor: 'rgba(142,68,173,0.25)', background: 'rgba(142,68,173,0.08)' });
      });

      // 绑定部位插槽点击
      $list.find('.organ-gear-slot').on('click', function() {
        try {
          const slotKey = $(this).data('slot-key');
          console.log("[RPG] Organ slot clicked:", slotKey);
          showOrganSelectPopup(slotKey);
        } catch (e) {
          console.error("[RPG] Error showing organ popup:", e);
          alert("打开器官面板失败：" + e.message + "\n" + e.stack);
        }
      });

      // 测试随机生成器官监听（兼容：基础面板躯体头部 / 独立面板左下角工具栏）
      $panel.find('#organ-test-random').off('click').on('click', async function() {
        try {
          const races = TEST_GENERATION_POOLS.种族;
          const slots = ORGAN_STANDARD_SLOTS; // 12 个标准槽位
          const qualities = ['普通', '精良', '稀有', '史诗', '传说', '神话'];
          const traitsPool = TEST_GENERATION_POOLS.特性;
          const labelsPool = TEST_GENERATION_POOLS.标签;
          const setsPool = TEST_GENERATION_POOLS.套装;

          const randomRace = races[Math.floor(Math.random() * races.length)];
          const randomSlot = slots[Math.floor(Math.random() * slots.length)];
          const randomQuality = qualities[Math.floor(Math.random() * qualities.length)];

          const organName = `${randomRace}${randomSlot}`;

          const traits = [];
          const labels = [];

          // 40% chance of random trait
          if (Math.random() > 0.6) {
            traits.push(traitsPool[Math.floor(Math.random() * traitsPool.length)]);
          }
          // 20% chance of "源火" unique trait, forcing "初火" label
          if (Math.random() > 0.8) {
            if (!traits.includes("源火")) traits.push("源火");
            if (!labels.includes("初火")) labels.push("初火");
          }

          // 40% chance of random label
          if (Math.random() > 0.6) {
            const randomLabel = labelsPool[Math.floor(Math.random() * labelsPool.length)];
            if (!labels.includes(randomLabel)) labels.push(randomLabel);
          }

          const hasSet = Math.random() > 0.5;
          const setName = hasSet ? setsPool[Math.floor(Math.random() * setsPool.length)] : undefined;

          // 根据器官种类生成符合逻辑的属性（来自 ORGAN_PHYSIOLOGY_MAP 数据库）
          // 属性总值固定为 6（正数器官），负数器官为 -6（来自 [标签-生理.md]）
          const ATTR_TOTAL = 6;

          const attrPool = ORGAN_PHYSIOLOGY_MAP[randomSlot] || ['健康度'];
          // 决定属性词条数量（来自 QUALITY_ATTR_COUNT_RULES 数据库）
          const attrCount = QUALITY_ATTR_COUNT_RULES[randomQuality]
            ? QUALITY_ATTR_COUNT_RULES[randomQuality]()
            : 1;

          // 随机抽取属性条目
          const selectedAttrs = [];
          const poolCopy = [...attrPool];
          for (let i = 0; i < Math.min(attrCount, poolCopy.length); i++) {
            const idx = Math.floor(Math.random() * poolCopy.length);
            selectedAttrs.push(poolCopy.splice(idx, 1)[0]);
          }

          // 按加权分配总值 6（主属性 1.2x，其余均分剩余）
          const subAttrs = {};
          if (selectedAttrs.length === 1) {
            subAttrs[selectedAttrs[0]] = ATTR_TOTAL;
          } else if (selectedAttrs.length === 2) {
            const weights = [1.2, 0.8];
            const totalW = 2.0;
            selectedAttrs.forEach((attr, i) => {
              subAttrs[attr] = Math.round((ATTR_TOTAL * weights[i] / totalW) * 10) / 10;
            });
          } else if (selectedAttrs.length >= 3) {
            const weights = [1.2, 0.9, 0.9];
            const totalW = 3.0;
            selectedAttrs.forEach((attr, i) => {
              subAttrs[attr] = Math.round((ATTR_TOTAL * weights[i] / totalW) * 10) / 10;
            });
          }
          // 5 条属性时总值为 8
          if (selectedAttrs.length === 5) {
            const ATTR_TOTAL_5 = 8;
            const weights = [1.2, 0.95, 0.95, 0.95, 0.95];
            const totalW = 5.0;
            selectedAttrs.forEach((attr, i) => {
              subAttrs[attr] = Math.round((ATTR_TOTAL_5 * weights[i] / totalW) * 10) / 10;
            });
          }

          const win = typeof getCore === 'function' ? getCore().window : window;
          const mvuData = win.Mvu.getMvuData({ type: 'message', message_id: 'latest' });
          if (!mvuData || !mvuData.stat_data) {
            alert("获取存档数据失败");
            return;
          }
          
          const sys = mvuData.stat_data.人物 = mvuData.stat_data.人物 || {};
          sys.器官系统 = sys.器官系统 || {};
          sys.器官系统.器官背包 = sys.器官系统.器官背包 || {};
          
          let uniqueName = organName;
          let counter = 1;
          while (sys.器官系统.器官背包[uniqueName]) {
            uniqueName = `${organName} +${counter}`;
            counter++;
          }

          sys.器官系统.器官背包[uniqueName] = {
            名称: uniqueName,
            品质: randomQuality,
            描述: `来自随机种族 ${randomRace} 的 ${randomSlot} 测试器官。`,
            空: false,
            强化等级: 0,
            属性加成: subAttrs,
            特性: traits,
            标签: labels,
            套装: setName,
            // 排异成功率由品质决定（来自 REJECTION_SUCCESS_RATES）
            已排异: Math.random() < (REJECTION_SUCCESS_RATES[randomQuality] || 0.5)
          };

          await win.Mvu.replaceMvuData(mvuData, { type: 'message', message_id: 'latest' });

          // === 测试模式：额外发放排异药剂 x10 ===
          // 用于测试排异流程（排异药剂数量字段可能未定义，所以用 add 操作初始化）
          try {
            const curMedicine = (typeof sys?.器官系统?.排异药剂数量 === 'number') ? sys.器官系统.排异药剂数量 : 0;
            const newMedicine = curMedicine + 10;
            // 用 add 兼容字段不存在；用 replace 覆盖已有值
            const medicinePatch = (curMedicine === 0 && typeof sys?.器官系统?.排异药剂数量 !== 'number')
              ? { op: 'add', path: '/人物/器官系统/排异药剂数量', value: 10 }
              : { op: 'replace', path: '/人物/器官系统/排异药剂数量', value: newMedicine };
            await applyMvuPatches([medicinePatch]);
          } catch (medErr) {
            console.warn('[生成测试器官] 发放排异药剂失败（不影响主流程）:', medErr);
          }

          // Re-render UI
          updateOrganUI();

          // Show prompt
          alert(`成功获得：[${randomQuality}] ${uniqueName}\n特性: ${traits.join(', ') || '无'}\n标签: ${labels.join(', ') || '无'}\n套装: ${setName || '无'}\n排异药剂 +10（用于测试）`);
        } catch (err) {
          console.error(err);
          alert("随机生成器官失败：" + err.message);
        }
      });

      // 动态文件上传背景监听（兼容 input id: organ-bg-upload / organ-bg-upload-input）
      $panel.find('#organ-bg-upload, #organ-bg-upload-input').on('change', function(e) {
        const file = e.target.files[0];
        if (file) {
          if (file.size > 2 * 1024 * 1024) {
            alert("上传的背景图请小于 2MB ！");
            return;
          }
          const reader = new FileReader();
          reader.onload = function(evt) {
            const base64 = evt.target.result;
            try {
              localStorage.setItem(`${SCRIPT_ID}-organ-bg`, base64);
              $panel.find('.visual-organ-container').css('background-image', `url(${base64})`);
              $panel.find('.vitruvian-background-svg').css('opacity', '0');
              $panel.find('#organ-bg-reset').css('display', 'inline-flex');
            } catch(err) {
              alert("背景保存失败，可能是图片数据太大超出浏览器限制了！");
            }
          };
          reader.readAsDataURL(file);
        }
      });

      // 动态重置背景监听
      $panel.find('#organ-bg-reset').on('click', function(e) {
        e.preventDefault();
        localStorage.removeItem(`${SCRIPT_ID}-organ-bg`);
        $panel.find('.visual-organ-container').css('background-image', 'none');
        $panel.find('.vitruvian-background-svg').css('opacity', '1');
        $(this).css('display', 'none');
        $panel.find('#organ-bg-upload, #organ-bg-upload-input').val('');
      });
    }

    } catch (e) {
      console.error('[RPG] 构建/注入 slotsHtml 失败:', e);
    }

    // ---
    try {
let attrsGridHtml = '<div class="organ-attrs-header-bar">';
    attrsGridHtml += `<span><i class="ri-pulse-line"></i> 属性</span>`;
    attrsGridHtml += '</div>';
    
    attrsGridHtml += `<div class="organ-attrs-grid">`;
    
    let cardsHtml = '';
    attrsDef.forEach((attr, idxCard) => {
      const val = getAttrVal(attr.key, attr.default);

      let providers = [];
      const groupedProviders = {};
      
      expandedSlots.forEach(slot => {
        const organ = 器官列表[slot.key];
        const isEmpty = !!organ && organ.空;
        const isNative = !organ;
        const isEquipped = !!organ && !organ.空;
        
        let activeOrgan = null;
        if (isNative) {
          activeOrgan = getNormalizedOrgan(getDefaultOrganForSlot(slot.baseKey, race), race);
        } else if (isEquipped) {
          activeOrgan = getNormalizedOrgan(normalizeStoredOrgan(organ, slot.baseKey), race);
        }
        
        if (activeOrgan && activeOrgan.属性加成 && activeOrgan.属性加成[attr.key] !== undefined) {
          let val = Number(activeOrgan.属性加成[attr.key]);
          // 未排异的器官属性减半（[器官属性规则.md] 排异规则）
          if (isEquipped && activeOrgan.已排异 !== true) {
            val = val / 2;
          }
          if (val !== 0) {
            const groupName = isEquipped ? activeOrgan.名称 : `原生[${slot.baseKey}]`;
            if (!groupedProviders[groupName]) {
              groupedProviders[groupName] = 0;
            }
            groupedProviders[groupName] += val;
          }
        }
      });
      
      Object.entries(groupedProviders).forEach(([name, sumVal]) => {
        providers.push({
          name: name,
          val: sumVal
        });
      });

      let providersHtml = '';
      if (providers.length > 0) {
        providersHtml = `<div class="compact-providers" style="margin-top: 4px; border-top: 1px dashed rgba(90, 70, 50, 0.15); padding-top: 3px; font-size: 9.5px; color: #8c7e65; font-weight: 500; line-height: 1.2;">
          来源：${providers.map(p => `${p.name}+${formatAttrVal(p.val)}`).join(', ')}
        </div>`;
      }

      const colIndex = idxCard % 7;
      let edgeClass = '';
      if (colIndex === 0 || colIndex === 1) {
        edgeClass = 'edge-left';
      } else if (colIndex === 5 || colIndex === 6) {
        edgeClass = 'edge-right';
      }

      let valClass = '';
      let effectText = '';
      let effectClass = '';
      let detailedReport = '';

      if (attr.key === '健康度') {
        if (val < attr.default) {
          valClass = 'attr-down';
          const pct = Math.round((attr.default - val) * 10);
          effectText = val <= 0 ? '死亡' : `生命-${pct}%`;
          effectClass = 'effect-debuff';
          detailedReport = attr.desc.replace('{pct}', `-${pct}`);
        } else if (val > attr.default) {
          valClass = 'attr-up';
          const pct = Math.round((val - attr.default) * 5);
          effectText = `生命+${pct}%`;
          effectClass = 'effect-buff';
          detailedReport = attr.desc.replace('{pct}', `+${pct}`);
        } else {
          effectText = '正常';
          effectClass = 'effect-normal';
          detailedReport = "健康指数处于标准状态。";
        }
      }
      else if (attr.key === '坚韧') {
        if (val < attr.default) {
          valClass = 'attr-down';
          const pct = Math.round((attr.default - val) * 5);
          effectText = `易伤+${pct}%`;
          effectClass = 'effect-debuff';
          detailedReport = attr.desc.replace('{pct}', `+${pct}`);
        } else if (val > attr.default) {
          valClass = 'attr-up';
          const pct = Math.round((val - attr.default) * 5);
          effectText = `防御+${pct}%`;
          effectClass = 'effect-buff';
          detailedReport = attr.desc.replace('{pct}', `-${pct}`);
        } else {
          effectText = '正常';
          effectClass = 'effect-normal';
          detailedReport = "身体物理坚韧度处于普通标准。";
        }
      }
      else if (attr.key === '神经传递效率') {
        if (val < attr.default) {
          valClass = 'attr-down';
          const pct = Math.round((attr.default - val) * 10);
          effectText = val <= 0 ? '瘫痪' : `迟钝+${pct}%`;
          effectClass = 'effect-debuff';
          detailedReport = attr.desc.replace('{pct}', `-${pct}`);
        } else if (val > attr.default) {
          valClass = 'attr-up';
          const pct = Math.round((val - attr.default) * 5);
          effectText = `敏捷/先攻+${pct}%`;
          effectClass = 'effect-buff';
          detailedReport = attr.desc.replace('{pct}', `+${pct}`);
        } else {
          effectText = '正常';
          effectClass = 'effect-normal';
          detailedReport = "反射反应神经传导速度正常。";
        }
      }
      else if (attr.key === '血液过滤效率') {
        if (val < attr.default) {
          valClass = 'attr-down';
          const pct = Math.round((attr.default - val) * 10);
          effectText = `流血/治疗降${pct}%`;
          effectClass = 'effect-debuff';
          detailedReport = attr.desc.replace('{pct}', `-${pct}`);
        } else if (val > attr.default) {
          valClass = 'attr-up';
          const filterPct = Math.round((val - attr.default) * 5);
          effectText = `体质+${filterPct}%/再生`;
          effectClass = 'effect-buff';
          detailedReport = attr.desc.replace('{pct}', `+${filterPct}`);
        } else {
          effectText = '正常';
          effectClass = 'effect-normal';
          detailedReport = "红血球过滤携氧循环水平正常。";
        }
      }
      else if (attr.key === '解毒效率') {
        if (val < attr.default) {
          valClass = 'attr-down';
          const diff = formatAttrVal(attr.default - val);
          effectText = val <= 0 ? '中毒' : `Buff时间-${diff}s`;
          effectClass = 'effect-debuff';
          detailedReport = attr.desc.replace('{val}', `-${diff}`);
        } else if (val > attr.default) {
          valClass = 'attr-up';
          const pct = Math.round((val - attr.default) * 5);
          effectText = `Buff时间+${pct}%`;
          effectClass = 'effect-buff';
          detailedReport = attr.desc.replace('{val}', `+${pct}%`);
        } else {
          effectText = '正常';
          effectClass = 'effect-normal';
          detailedReport = "肝肾毒素排解效率正常。";
        }
      }
      else if (attr.key === '视觉') {
        if (val < attr.default) {
          valClass = 'attr-down';
          let diffText = val <= 0 ? "致盲" : (val < 1 ? "半盲" : `感知-${formatAttrVal(attr.default - val)}`);
          effectText = diffText;
          effectClass = 'effect-debuff';
          detailedReport = `受损：${diffText}。`;
        } else if (val > attr.default) {
          valClass = 'attr-up';
          const bonus = formatAttrVal(val - attr.default);
          effectText = `感知+${bonus}`;
          effectClass = 'effect-buff';
          detailedReport = attr.desc.replace('{val}', `+${bonus}`);
        } else {
          effectText = '正常';
          effectClass = 'effect-normal';
          detailedReport = "视力与环境感知度处于常规水平。";
        }
      }
      else if (attr.key === '新陈代谢效率') {
        if (val < attr.default) {
          valClass = 'attr-down';
          const pct = Math.round((attr.default - val) * 10);
          effectText = val <= 0 ? '无经验' : `经验-${pct}%`;
          effectClass = 'effect-debuff';
          detailedReport = attr.desc.replace('{pct}', `-${pct}`);
        } else if (val > attr.default) {
          valClass = 'attr-up';
          const pct = Math.round((val - attr.default) * 5);
          effectText = `经验+${pct}%`;
          effectClass = 'effect-buff';
          detailedReport = attr.desc.replace('{pct}', `+${pct}`);
        } else {
          effectText = '正常';
          effectClass = 'effect-normal';
          detailedReport = "细胞吸收新陈代谢速率稳定。";
        }
      }
      else if (attr.key === '肺活量') {
        if (val < attr.default) {
          valClass = 'attr-down';
          const pct = Math.round((attr.default - val) * 10);
          effectText = val <= 0 ? '窒息' : `窒息率+${pct}%`;
          effectClass = 'effect-debuff';
          detailedReport = attr.desc.replace('{pct}', `-${pct}`);
        } else if (val > attr.default) {
          valClass = 'attr-up';
          const pct = Math.round((val - attr.default) * 5);
          effectText = `屏息+${pct}%`;
          effectClass = 'effect-buff';
          detailedReport = attr.desc.replace('{pct}', `+${pct}`);
        } else {
          effectText = '正常';
          effectClass = 'effect-normal';
          detailedReport = "常规肺泡气体交互容积稳定。";
        }
      }
      else if (attr.key === '耐力') {
        if (val < attr.default) {
          valClass = 'attr-down';
          effectText = '疲劳';
          effectClass = 'effect-debuff';
          detailedReport = "体力衰退，处于易劳累状态。";
        } else if (val > attr.default) {
          valClass = 'attr-up';
          const pct = Math.round((val - attr.default) * 5);
          effectText = `战续+${pct}%`;
          effectClass = 'effect-buff';
          detailedReport = attr.desc.replace('{pct}', `+${pct}`);
        } else {
          effectText = '正常';
          effectClass = 'effect-normal';
          detailedReport = "细胞抗劳累持续耐受性稳定。";
        }
      }
      else if (attr.key === '消化效率') {
        if (val < attr.default) {
          valClass = 'attr-down';
          effectText = '消化不良';
          effectClass = 'effect-debuff';
          detailedReport = "胃肠动力受损，食物吸收率下降。";
        } else if (val > attr.default) {
          valClass = 'attr-up';
          const pct = Math.round((val - attr.default) * 5);
          effectText = `抗毒+${pct}%`;
          effectClass = 'effect-buff';
          detailedReport = attr.desc.replace('{pct}', `+${pct}`);
        } else {
          effectText = '正常';
          effectClass = 'effect-normal';
          detailedReport = "消化与食物附带增益获取顺畅。";
        }
      }
      else if (attr.key === '营养获取效率') {
        if (val < attr.default) {
          valClass = 'attr-down';
          const pct = Math.round((1 - val / attr.default) * 100);
          effectText = `药效-${pct}%`;
          effectClass = 'effect-debuff';
          detailedReport = attr.desc.replace('{val}', `x${formatAttrVal(val / attr.default)}`);
        } else if (val > attr.default) {
          valClass = 'attr-up';
          const multiplier = formatAttrVal(val / attr.default);
          effectText = `药效x${multiplier}`;
          effectClass = 'effect-buff';
          detailedReport = attr.desc.replace('{val}', `${multiplier}`);
        } else {
          effectText = '正常';
          effectClass = 'effect-normal';
          detailedReport = "对药水与生命恢复养分汲取度处于常规水平。";
        }
      }
      else if (attr.key === '幸运') {
        if (val < attr.default) {
          valClass = 'attr-down';
          effectText = '劣势';
          effectClass = 'effect-debuff';
          detailedReport = "气运低谷，面临倒霉几率增加。";
        } else if (val > attr.default) {
          valClass = 'attr-up';
          const pct = Math.round((val - attr.default) * 5);
          effectText = `幸运一击+${pct}%`;
          effectClass = 'effect-buff';
          detailedReport = attr.desc.replace('{pct}', `+${pct}`);
        } else {
          effectText = '正常';
          effectClass = 'effect-normal';
          detailedReport = "命中与爆率判定维持标准几率。";
        }
      }
      else if (attr.key === '速度') {
        if (val < attr.default) {
          valClass = 'attr-down';
          let diffText = val < 1 ? '偏瘫' : '减速';
          effectText = diffText;
          effectClass = 'effect-debuff';
          detailedReport = `移速降低。当前位移：${formatAttrVal(val)}m。`;
        } else if (val > attr.default) {
          valClass = 'attr-up';
          effectText = `移动${formatAttrVal(val)}m/先攻+${formatAttrVal(val / 2)}`;
          effectClass = 'effect-buff';
          detailedReport = attr.desc.replace('{val}', `+${formatAttrVal(val - attr.default)}`);
        } else {
          effectText = '正常';
          effectClass = 'effect-normal';
          detailedReport = "位移动力及先攻率处于常规水准。";
        }
      }
      else if (attr.key === '筋力') {
        if (val < attr.default) {
          valClass = 'attr-down';
          effectText = '虚弱';
          effectClass = 'effect-debuff';
          detailedReport = "近战负荷与抗击退判定大幅受损。";
        } else if (val > attr.default) {
          valClass = 'attr-up';
          const bonusDmg = Math.round((val - attr.default) * 5);
          const weightCap = val * 10;
          effectText = `伤害+${bonusDmg}%/负重${weightCap}kg`;
          effectClass = 'effect-buff';
          detailedReport = attr.desc.replace('{pct}', `+${bonusDmg}`).replace('{weight}', `${weightCap}`);
        } else {
          effectText = '正常';
          effectClass = 'effect-normal';
          detailedReport = "身体肌肉与骨骼承重力处于健康状态。";
        }
      }

      cardsHtml += `
        <div class="organ-attr-compact-card ${edgeClass}" data-attr-key="${attr.key}">
          <div class="compact-header-vertical">
            <i class="${attr.icon}"></i>
            <span class="organ-attr-value ${valClass}">${formatAttrVal(val)}</span>
          </div>
          <div class="compact-detail">
            <div class="compact-attr-name">${attr.name}</div>
            <div class="compact-brief ${effectClass}">${effectText}</div>
            <div class="compact-desc">${detailedReport}</div>
            ${providersHtml}
          </div>
        </div>
      `;
    });

    // 收集额外的自定义属性与特性

    const customAttrs = new Set();
    const activeTraits = {}; 
    const setCounts = {};
    const baseAttrKeys = new Set(attrsDef.map(a => a.key));

    expandedSlots.forEach(slot => {
      const organ = 器官列表[slot.key];
      const isEmpty = !!organ && organ.空;
      const isNative = !organ;
      const isEquipped = !!organ && !organ.空;
      
      let activeOrgan = null;
      if (isNative) {
        activeOrgan = getNormalizedOrgan(getDefaultOrganForSlot(slot.baseKey, race), race);
      } else if (isEquipped) {
        activeOrgan = getNormalizedOrgan(normalizeStoredOrgan(organ, slot.baseKey), race);
      }
      
      if (activeOrgan && !activeOrgan.空) {
        if (activeOrgan.属性加成) {
          Object.keys(activeOrgan.属性加成).forEach(k => {
            if (!baseAttrKeys.has(k) && Number(activeOrgan.属性加成[k]) !== 0) {
              customAttrs.add(k);
            }
          });
        }
        if (activeOrgan.特性) {
          activeOrgan.特性.forEach(t => {
            if (t) {
              if (!activeTraits[t]) activeTraits[t] = [];
              activeTraits[t].push({
                organName: activeOrgan.名称,
                slotKey: slot.key
              });
            }
          });
        }
        if (activeOrgan.套装) {
          const setName = activeOrgan.套装;
          setCounts[setName] = (setCounts[setName] || 0) + 1;
        }
      }
    });

    // 渲染自定义属性
    let customCardIdx = attrsDef.length;
    customAttrs.forEach(k => {
      let val = 0;
      let providers = [];
      expandedSlots.forEach(slot => {
        const organ = 器官列表[slot.key];
        const isEmpty = !!organ && organ.空;
        const isNative = !organ;
        const isEquipped = !!organ && !organ.空;
        
        let activeOrgan = null;
        if (isNative) {
          activeOrgan = getNormalizedOrgan(getDefaultOrganForSlot(slot.baseKey, race), race);
        } else if (isEquipped) {
          activeOrgan = getNormalizedOrgan(normalizeStoredOrgan(organ, slot.baseKey), race);
        }
        
        if (activeOrgan && !activeOrgan.空 && activeOrgan.属性加成 && activeOrgan.属性加成[k] !== undefined) {
          const v = Number(activeOrgan.属性加成[k]);
          if (v !== 0) {
            val += v;
            providers.push({
              name: isEquipped ? activeOrgan.名称 : `原生[${slot.baseKey}]`,
              val: v
            });
          }
        }
      });

      // 主动资源属性（如燃点、储能、能量、怒气、法力、主动能量）不为负数
      const activeResources = ['燃点', '储能', '能量', '怒气', '法力', '主动能量'];
      if (activeResources.includes(k) && val < 0) {
        val = 0;
      }

      let providersHtml = '';
      if (providers.length > 0) {
        providersHtml = `<div class="compact-providers" style="margin-top: 4px; border-top: 1px dashed rgba(90, 70, 50, 0.15); padding-top: 3px; font-size: 9.5px; color: #8c7e65; font-weight: 500; line-height: 1.2;">
          来源：${providers.map(p => `${p.name}+${formatAttrVal(p.val)}`).join(', ')}
        </div>`;
      }

      let valClass = val > 0 ? 'attr-up' : (val < 0 ? 'attr-down' : '');
      let effectText = val > 0 ? '强化' : (val < 0 ? '抑制' : '正常');
      let effectClass = val > 0 ? 'effect-buff' : (val < 0 ? 'effect-debuff' : 'effect-normal');
      
      let detailedReport = `特有附加生理机能：${k} 当前值为 ${formatAttrVal(val)}。`;
      if (k === '储能') {
        detailedReport = `机械器官特有资源（蓄电池槽）。上限 ${formatAttrVal(val)}。作为超频爆发等高能负荷技能的独立能量源。由于原生肉体不具备发电/恢复功能，需配合”充能”等机械功能运转恢复。`;
      } else if (k === '充能') {
        detailedReport = `动力机械回复效率。进行奔跑/位移等产生动能的动作时，可将动能转化为机械能，按效率恢复储能值。如果躯体储能上限为 0，此效果无法生效。`;
      } else if (k === '超频爆发') {
        detailedReport = `超频过载等级 +${formatAttrVal(val)}。允许随时开启/关闭。开启时每回合自动消耗 5 点储能值，极大幅度提升移动速度、感官反应与物理筋力，能量耗尽时自动关闭。`;
      } else if (k === '重击强化') {
        detailedReport = `肢体锤击强化等级 +${formatAttrVal(val)}。在使用空手、拳套或肢体物理近战攻击时，有 15% 的几率触发重击判定，造成 2.0 倍物理伤害及失衡震退判定。`;
        // 强化类效果不为负数
        if (val < 0) val = 0;
      }

      const colIndex = customCardIdx % 7;
      let edgeClass = '';
      if (colIndex === 0 || colIndex === 1) {
        edgeClass = 'edge-left';
      } else if (colIndex === 5 || colIndex === 6) {
        edgeClass = 'edge-right';
      }

      let customIcon = 'ri-pulse-line';
      if (k === '储能') customIcon = 'ri-battery-charge-line';
      else if (k === '充能') customIcon = 'ri-water-flash-line';
      else if (k === '超频爆发' || k === '超载爆发') customIcon = 'ri-flashlight-line';
      else if (k === '重击强化') customIcon = 'ri-hammer-line';

      cardsHtml += `
        <div class="organ-attr-compact-card custom-attr-card ${edgeClass}" data-attr-key="${k}">
          <div class="compact-header-vertical" style="color: #2ea87a;">
            <i class="${customIcon}"></i>
            <span class="organ-attr-value ${valClass}" style="font-size: 9.5px;">${formatAttrVal(val)}</span>
          </div>
          <div class="compact-detail">
            <div class="compact-attr-name">${k}</div>
            <div class="compact-brief ${effectClass}">${effectText}</div>
            <div class="compact-desc">${detailedReport}</div>
            ${providersHtml}
          </div>
        </div>
      `;
      customCardIdx++;
    });

    // 渲染特性
    Object.entries(activeTraits).forEach(([traitName, traitSources]) => {
      const providersHtml = `<div class="compact-providers" style="margin-top: 4px; border-top: 1px dashed rgba(90, 70, 50, 0.15); padding-top: 3px; font-size: 9.5px; color: #8c7e65; font-weight: 500; line-height: 1.2;">
        来源：${traitSources.map(ts => ts.organName).join(', ')}
      </div>`;

      const colIndex = customCardIdx % 7;
      let edgeClass = '';
      if (colIndex === 0 || colIndex === 1) {
        edgeClass = 'edge-left';
      } else if (colIndex === 5 || colIndex === 6) {
        edgeClass = 'edge-right';
      }

      let traitDesc = "由器官附带的额外功能性机能加成。";
      if (traitName === '超频爆发') {
        traitDesc = "开启后每回合消耗 5 点储能，极大幅度提升移动速度、感官反应与物理筋力，可手动随时关闭。";
      } else if (traitName === '重击强化') {
        traitDesc = "在使用空手、拳套或直接肢体攻击时，有 15% 几率触发重力锤击，造成双倍物理伤害与短暂失衡。";
      } else if (traitName === '充能') {
        traitDesc = "奔跑或移动时，将位移动能自动转化为电力，为具有“储能”上限的机械器官恢复能量。";
      }

      const traitVal = traitSources.length;

      let traitIcon = 'ri-shield-flash-line';
      if (traitName === '超频爆发' || traitName === '超载爆发') traitIcon = 'ri-bolt-line';
      else if (traitName === '重击强化') traitIcon = 'ri-hammer-line';
      else if (traitName === '充能') traitIcon = 'ri-flashlight-line';

      const isCommonTrait = ['超频爆发', '超频', '充能', '重击强化'].includes(traitName);

      if (isCommonTrait) {
        cardsHtml += `
          <div class="organ-attr-compact-card trait-card ${edgeClass}" data-attr-key="${traitName}">
            <div class="compact-header-vertical">
              <i class="${traitIcon}"></i>
              <span class="organ-attr-value" style="font-size: 9.5px; font-weight: 700;">${traitVal}</span>
            </div>
            <div class="compact-detail">
              <div class="compact-attr-name">${traitName}</div>
              <div class="compact-brief effect-normal">额外效果</div>
              <div class="compact-desc">${traitDesc}</div>
              ${providersHtml}
            </div>
          </div>
        `;
      } else {
        const effectStyle = getEffectColor(traitName, traitDesc);
        cardsHtml += `
          <div class="organ-attr-compact-card trait-card ${edgeClass}" data-attr-key="${traitName}" style="border-color: ${effectStyle.border}; background: ${effectStyle.bg};">
            <div class="compact-header-vertical" style="color: ${effectStyle.color};">
              <i class="${traitIcon}"></i>
              <span class="organ-attr-value" style="font-size: 9.5px; font-weight: 700;">${traitVal}</span>
            </div>
            <div class="compact-detail">
              <div class="compact-attr-name" style="color: ${effectStyle.color}; font-weight: 700;">${traitName}</div>
              <div class="compact-brief effect-buff" style="color: ${effectStyle.color};">额外效果</div>
              <div class="compact-desc">${traitDesc}</div>
              ${providersHtml}
            </div>
          </div>
        `;
      }
      customCardIdx++;
    });

    // 渲染套装列表作为生理指数卡片
    Object.entries(setCounts).forEach(([setName, count]) => {
      const colIndex = customCardIdx % 7;
      let edgeClass = '';
      if (colIndex === 0 || colIndex === 1) {
        edgeClass = 'edge-left';
      } else if (colIndex === 5 || colIndex === 6) {
        edgeClass = 'edge-right';
      }

      const setProviders = [];
      expandedSlots.forEach(slot => {
        const organ = 器官列表[slot.key];
        const isEquipped = !!organ && !organ.空;
        if (isEquipped && organ.套装 === setName) {
          setProviders.push(organ.名称);
        }
      });
      const setProvidersHtml = `<div class="compact-providers" style="margin-top: 4px; border-top: 1px dashed rgba(90, 70, 50, 0.15); padding-top: 3px; font-size: 9.5px; color: #8c7e65; font-weight: 500; line-height: 1.2;">
        部件: ${setProviders.join(', ')}
      </div>`;

      let setDesc = `已装备 ${setName} 部件。成套后可激活特殊机能共鸣。`;
      if (setName.includes('机械')) {
        setDesc = `已装备 ${count} 件机械套装部件。激活效果：机械传动效率提升，储能最大上限额外获得提升。`;
      }

      const effectStyle = getEffectColor(setName, setDesc);

      cardsHtml += `
        <div class="organ-attr-compact-card set-card ${edgeClass}" data-attr-key="${setName}" style="border-color: ${effectStyle.border}; background: ${effectStyle.bg};">
          <div class="compact-header-vertical" style="color: ${effectStyle.color};">
            <i class="ri-vip-crown-line"></i>
            <span class="organ-attr-value" style="font-size: 9.5px; font-weight: 700;">${count}</span>
          </div>
          <div class="compact-detail">
            <div class="compact-attr-name" style="color: ${effectStyle.color}; font-weight: 700;">${setName}</div>
            <div class="compact-brief effect-buff" style="color: ${effectStyle.color};">套装组合</div>
            <div class="compact-desc">${setDesc}</div>
            ${setProvidersHtml}
          </div>
        </div>
      `;
      customCardIdx++;
    });

    if (cardsHtml === '') {
      cardsHtml = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 12px; color: #6b5b4a; font-size: 11px; background: #f5edd8; border: 1px dashed #d4c4a8; border-radius: 6px;">
          <i class="ri-shield-check-line" style="color:#2ea87a; margin-right:4px;"></i> 所有生理机能处于标准状态 (点击显示全部以查看数值)
        </div>
      `;
    }

    attrsGridHtml += cardsHtml;
    attrsGridHtml += '</div>';

    
$panel.find('.organ-attrs-header-bar').remove();
    $panel.find('.organ-attrs-grid').remove();
    // 独立面板使用 #organ-attrs-container，基础面板使用 $organSet.after
    const $attrsContainer = $panel.find('#organ-attrs-container');
    if ($attrsContainer.length) {
      $attrsContainer.html(attrsGridHtml);
    } else {
      $organSet.after(attrsGridHtml);
    }

    // ---
    // 槽位定义：支持复数器官（数量 count）

    // 获取所有槽位展开后的实例 key 列表，例如 ['眼球_1', '眼球_2', '肋骨_1', ...]
    const getExpandedSlotKeys = () => expandedSlots.map(s => s.key);

    const svgLines = `
      <svg class="vitruvian-background-svg" viewBox="0 0 100 100" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1;">
        <!-- 外接圆 -->
        <circle cx="50" cy="51" r="44" stroke="rgba(90, 70, 50, 0.22)" stroke-width="0.5" fill="none" />
        <!-- 外接正方形 -->
        <rect x="12" y="12" width="76" height="76" stroke="rgba(90, 70, 50, 0.22)" stroke-width="0.5" fill="none" />
        <!-- 对角线和水平垂直辅助线，增加达芬奇手稿风格 -->
        <line x1="50" y1="12" x2="50" y2="88" stroke="rgba(90, 70, 50, 0.12)" stroke-width="0.4" stroke-dasharray="1 1" />
        <line x1="12" y1="50" x2="88" y2="50" stroke="rgba(90, 70, 50, 0.12)" stroke-width="0.4" stroke-dasharray="1 1" />
        
        <!-- 达芬奇人体剪影（双姿态叠合，通过淡灰色填充与细致线条勾勒） -->
        
        <!-- 姿态1：直立十字人体 -->
        <!-- 头部 -->
        <circle cx="50" cy="17" r="3.2" fill="rgba(90, 70, 50, 0.25)" stroke="rgba(90, 70, 50, 0.35)" stroke-width="0.4" />
        <!-- 脖子 -->
        <rect x="49" y="20.2" width="2" height="1.8" fill="rgba(90, 70, 50, 0.25)" />
        <!-- 身体躯干 -->
        <path d="M 46.5 22 L 53.5 22 L 52.5 48 L 47.5 48 Z" fill="rgba(90, 70, 50, 0.25)" stroke="rgba(90, 70, 50, 0.35)" stroke-width="0.4" />
        <!-- 直立水平双臂 -->
        <path d="M 46.5 22 L 20 22 C 18.5 22 18.5 23.6 20 23.6 L 46.5 23.6 Z" fill="rgba(90, 70, 50, 0.25)" stroke="rgba(90, 70, 50, 0.3)" stroke-width="0.4" /> <!-- 左臂 -->
        <path d="M 53.5 22 L 80 22 C 81.5 22 81.5 23.6 80 23.6 L 53.5 23.6 Z" fill="rgba(90, 70, 50, 0.25)" stroke="rgba(90, 70, 50, 0.3)" stroke-width="0.4" /> <!-- 右臂 -->
        <!-- 直立垂直双腿 -->
        <path d="M 47.5 48 L 50 48 L 49.5 87 C 49.5 88.5 47.5 88.5 47.5 87 Z" fill="rgba(90, 70, 50, 0.22)" stroke="rgba(90, 70, 50, 0.3)" stroke-width="0.4" /> <!-- 左腿 -->
        <path d="M 50 48 L 52.5 48 L 52.5 87 C 52.5 88.5 50.5 88.5 50.5 87 Z" fill="rgba(90, 70, 50, 0.22)" stroke="rgba(90, 70, 50, 0.3)" stroke-width="0.4" /> <!-- 右腿 -->

        <!-- 姿态2：大字形展开人体 -->
        <!-- 展开斜向上双臂 -->
        <path d="M 46.5 22.5 L 24 13 C 22.5 12.3 22 13.8 23 14.8 L 46.5 24 Z" fill="rgba(90, 70, 50, 0.16)" stroke="rgba(90, 70, 50, 0.25)" stroke-width="0.4" /> <!-- 左斜臂 -->
        <path d="M 53.5 22.5 L 76 13 C 77.5 12.3 78 13.8 77 14.8 L 53.5 24 Z" fill="rgba(90, 70, 50, 0.16)" stroke="rgba(90, 70, 50, 0.25)" stroke-width="0.4" /> <!-- 右斜臂 -->
        <!-- 展开斜向下双腿 -->
        <path d="M 47.5 48 L 33 82 C 32 83.2 33.8 84.2 34.8 83 L 48.5 48 Z" fill="rgba(90, 70, 50, 0.14)" stroke="rgba(90, 70, 50, 0.22)" stroke-width="0.4" /> <!-- 左斜腿 -->
        <path d="M 52.5 48 L 67 82 C 68 83.2 66.2 84.2 65.2 83 L 51.5 48 Z" fill="rgba(90, 70, 50, 0.14)" stroke="rgba(90, 70, 50, 0.22)" stroke-width="0.4" /> <!-- 右斜腿 -->
      </svg>
    `;

    
    } catch (e) {
      console.error('[RPG] 构建/注入 attrsGridHtml 失败:', e);
    }
    }); // end $panels.forEach
  };

    const runOnceOrganSystemInitialization = async () => {
    const key = `${SCRIPT_ID}-restored-v10`;
    if (localStorage.getItem(key)) return;

    const data = fetchLatestMvuData();
    if (!data || !data.人物) return;

    console.log("[小苑调试] 正在自动初始化器官系统与重置/补发器官...");
    const patches = [];
    if (!data.人物.装备列表) {
      patches.push({
        op: 'add',
        path: '/人物/装备列表',
        value: {}
      });
    }
    if (!data.人物.器官系统) {
      patches.push({
        op: 'add',
        path: '/人物/器官系统',
        value: { 器官列表: {}, 器官背包: {}, 生理属性: {} }
      });
    } else if (!data.人物.器官系统.器官列表) {
      patches.push({
        op: 'add',
        path: '/人物/器官系统/器官列表',
        value: {}
      });
    }
    // 初始化生理属性基准值（来自标签-生理.md）
    if (!data.人物.器官System?.生理属性 || Object.keys(data.人物.器官系统.生理属性).length === 0) {
      const physBase = {};
      Object.entries(PHYSIOLOGY_ATTRIBUTES).forEach(([key, val]) => {
        physBase[key] = val.初始;
      });
      patches.push({
        op: 'add',
        path: '/人物/器官系统/生理属性',
        value: physBase
      });
    }
    const initOrgans = [
      { key: "眼球", name: "初始人类眼球", attr: { "视觉": 2 }, desc: "人体原装的视觉感光器官，提供基础视界。" },
      { key: "心脏", name: "初始人类心脏", attr: { "健康度": 1 }, desc: "人体原装的血液循环泵，泵送生命源泉。" },
      { key: "肺脏", name: "初始人类肺脏", attr: { "肺活量": 2, "耐力": 2 }, desc: "人体原装的气体交换器官，维持基础呼吸。" },
      { key: "胃", name: "初始人类胃", attr: { "消化效率": 1 }, desc: "人体原装的初步消化器官，分解日常膳食。" },
      { key: "肠子", name: "初始人类肠道", attr: { "营养获取效率": 4 }, desc: "人体原装的主要吸收器官，吸取营养元素。" },
      { key: "阑尾", name: "初始人类阑尾", attr: { "幸运": 1 }, desc: "人体原装的免疫辅助器官，提供少许幸运加成。" },
      { key: "脊柱", name: "初始人类脊柱", attr: { "坚韧": 4.5, "神经传递效率": 1 }, desc: "人体原装的躯干支柱与神经通道。" },
      { key: "肋骨", name: "初始人类肋骨", attr: { "坚韧": 4.5 }, desc: "人体原装的胸腔保护骨骼，遮蔽脏器。" },
      { key: "肾脏", name: "初始人类肾脏", attr: { "血液过滤效率": 2 }, desc: "人体原装的排泄器官，平衡体内环境。" },
      { key: "脾脏", name: "初始人类脾脏", attr: { "解毒效率": 1 }, desc: "人体原装的免疫与解毒器官，过滤血液毒素。" },
      { key: "肝脏", name: "初始人类肝脏", attr: { "新陈代谢效率": 1 }, desc: "人体原装的代谢核心器官，协调多种生化反应。" },
      { key: "肌肉", name: "初始人类肌肉", attr: { "速度": 8, "筋力": 8 }, desc: "人体原装的运动收缩肌纤维。" }
    ];

    initOrgans.forEach(o => {
      const targetKey = `器官_初始${o.key}`;
      if (!(data.人物.装备列表 || {})[targetKey]) {
        patches.push({
          op: 'add',
          path: `/人物/装备列表/${targetKey}`,
          value: {
            名称: o.name,
            品质: "普通",
            描述: o.desc,
            部位: o.key,
            装备箱: true,
            属性加成: o.attr,
            特性: [],
            标签: ["血肉", "人类"],
            种族: "",
            强化等级: 0,
            初始: true,
            已排异: true
          }
        });
      }
    });

    const rareOrgan1 = (data.人物.装备列表 || {})["器官_暴君肌肉"];
    if (!rareOrgan1) {
      patches.push({
        op: 'add',
        path: '/人物/装备列表/器官_暴君肌肉',
        value: {
          名称: "暴君活性肌肉",
          品质: "传说",
          描述: "富含高能活性纤维的暴君级肌肉组织，爆发力极强。",
          部位: "肌肉",
          装备箱: true,
          属性加成: { 筋力: 4, 速度: 2, "重击强化": 1 },
          特性: [],
          标签: ["血肉", "暴君"],
          种族: "",
          强化等级: 0,
          已排异: true
        }
      });
    }

    const rareOrgan2 = (data.人物.装备列表 || {})["器官_活性心脏"];
    if (!rareOrgan2) {
      patches.push({
        op: 'add',
        path: '/人物/装备列表/器官_活性心脏',
        value: {
          名称: "活性机械心脏",
          品质: "史诗",
          描述: "机械与血肉融合的心脏，泵血量极其惊人。",
          部位: "心脏",
          装备箱: true,
          属性加成: { 筋力: 2, 储能: 20, "超频爆发": 1, "健康度": 1 },
          特性: [],
          标签: ["机械", "血肉"],
          种族: "",
          强化等级: 0,
          已排异: true
        }
      });
    }

    const success = await applyMvuPatches(patches);
    if (success) {
      localStorage.setItem(key, 'true');
      console.log("[小苑调试] 器官系统自动初始化与补发完毕！");
    }
  };

    let autoInitInFlight = false;
  const autoInitializeMissingOrgans = async (data) => {
    if (autoInitInFlight) return;
    if (!data || !data.人物) return;

    const patches = [];
    let changed = false;

    if (!data.人物.器官系统) {
      patches.push({ op: 'add', path: '/人物/器官系统', value: { 器官列表: {}, 器官背包: {} } });
      changed = true;
    } else if (!data.人物.器官系统.器官列表) {
      patches.push({ op: 'add', path: '/人物/器官系统/器官列表', value: {} });
      changed = true;
    }

    if (changed) {
      // Apply initial container structure first
      autoInitInFlight = true;
      try {
        await applyMvuPatches(patches);
      } catch(e) {}
      autoInitInFlight = false;
      return;
    }

    const race = data.人物.种族 || '人类';
    const list = data.人物.器官系统.器官列表 || {};

    // 初始化缺失的槽位
    slotsDef.forEach(slot => {
      const baseSlot = slot.key;
      const count = slot.count || 1;
      for (let i = 1; i <= count; i++) {
        const subKey = count > 1 ? `${baseSlot}_${i}` : baseSlot;
        if (list[subKey] === undefined) {
          const defaultOrgan = getDefaultOrganForSlot(baseSlot, race);
          if (defaultOrgan && !defaultOrgan.空) {
            patches.push({
              op: 'add',
              path: `/人物/器官系统/器官列表/${subKey}`,
              value: JSON.parse(JSON.stringify(defaultOrgan))
            });
            changed = true;
          }
        }
      }
    });

    // 数据迁移：修复旧版本未除以count的多槽位器官
    slotsDef.forEach(slot => {
      const baseSlot = slot.key;
      const count = slot.count || 1;
      if (count <= 1) return; // 单槽位器官不需要迁移

      const defaultOrgan = defaultOrgans[baseSlot];
      if (!defaultOrgan || !defaultOrgan.属性加成) return;

      for (let i = 1; i <= count; i++) {
        const subKey = count > 1 ? `${baseSlot}_${i}` : baseSlot;
        const existing = list[subKey];
        if (!existing || existing.空 || !existing.属性加成) continue;

        // 检查是否是未除值的旧数据：如果某个属性值等于defaultOrgans中的未除值
        let needsMigration = false;
        const migrated = JSON.parse(JSON.stringify(existing));

        Object.entries(defaultOrgan.属性加成).forEach(([attr, undividedVal]) => {
          if (migrated.属性加成[attr] !== undefined) {
            const storedVal = Number(migrated.属性加成[attr]);
            // 如果存储值等于未除的默认值，说明是旧数据
            if (Math.abs(storedVal - Number(undividedVal)) < 0.001) {
              migrated.属性加成[attr] = Number(undividedVal) / count;
              needsMigration = true;
            }
          }
        });

        if (needsMigration) {
          patches.push({
            op: 'replace',
            path: `/人物/器官系统/器官列表/${subKey}`,
            value: migrated
          });
          changed = true;
          console.log(`[小苑调试] 迁移器官 ${subKey} 的未除值到除数值`);
        }
      }
    });

    if (changed && patches.length > 0) {
      autoInitInFlight = true;
      try {
        console.log("[小苑调试] 检测到未装备/缺失的默认器官，正在自动植入...", patches);
        const success = await applyMvuPatches(patches);
        if (success) {
          console.log("[小苑调试] 默认器官自动植入成功！");
          setTimeout(refreshStatusBar, 100);
        }
      } catch(err) {
        console.error("[小苑调试] 自动植入默认器官失败:", err);
      } finally {
        autoInitInFlight = false;
      }
    }
  };

  const refreshStatusBar = () => {
    console.log("[小苑调试] refreshStatusBar 正在执行...");
    const data = fetchLatestMvuData();
    if (Object.keys(data).length > 0) {
      runOnceOrganSystemInitialization();
      autoInitializeMissingOrgans(data);
      if (data?.人物?.技能树) {
        syncSkillSlots(data.人物.技能树, data.人物);
      }
      updateStatusBarUI(data);
      // 如果特质页面当前可见，同步更新

      if ($(`#${SCRIPT_ID}-panel #view-traits`).hasClass('active')) {
        updateTraitsPageUI();
      }
      if ($(`#${SCRIPT_ID}-panel #view-organ`).hasClass('active')) {
        updateOrganUI();
      }
    }
  };
  const injectStyles = () => {
    if (!$) return;
    if (document.getElementById('organ-system-styles')) return;
    const style = document.createElement('style');
    style.id = 'organ-system-styles';
    style.textContent = ` #view-organ{background-image:url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHdpZHRoPScxODAnIGhlaWdodD0nMTgwJz4KICA8ZmlsdGVyIGlkPSdwYXBlcl9ub2lzZSc+CiAgICA8ZmVUdXJidWxlbmNlIHR5cGU9J2ZyYWN0YWxOb2lzZScgYmFzZUZyZXF1ZW5jeT0nMC4yNScgbnVtT2N0YXZlcz0nMycgcmVzdWx0PSdub2lzZScvPgogICAgPGZlQ29sb3JNYXRyaXggdHlwZT0nbWF0cml4JyB2YWx1ZXM9JzEgMCAwIDAgMCAgMCAxIDAgMCAwICAwIDAgMSAwIDAgIDAgMCAwIDAuMTIgMCcvPgogIDwvZmlsdGVyPgogIDxyZWN0IHdpZHRoPScxODAnIGhlaWdodD0nMTgwJyBmaWx0ZXI9J3VybCgjcGFwZXJfbm9pc2UpJyBmaWxsPSdub25lJy8+Cjwvc3ZnPg=="),radial-gradient(circle,#f8f0dc 0%,#ede1be 100%) !important;background-repeat:repeat,no-repeat !important;border:1px solid #d4c4a8 !important;border-radius:8px;padding:12px;color:#4a3c31 !important;box-shadow:0 2px 8px rgba(90,70,50,0.08);
}
#view-organ .traits-page-title{color:#4a3c31 !important;font-weight:700;border-bottom:1px solid #dcd1b4;padding-bottom:6px;
}
.organ-status-header-row{display:flex;justify-content:space-between;margin-bottom:12px;font-size:13px;background:#e8d4a8;border:1px solid #c4a06a;padding:8px 12px;border-radius:6px;color:#4a3c31;
}
.organ-set-active-row{margin-bottom:12px;font-size:12px;padding:6px 12px;background:#e8d4a8;border:1px solid #c4a06a;border-radius:6px;color:#4a3c31;
}
.organ-set-active-row.empty{color:#6b5b4a;background:#f5edd8;
}
.organ-set-chip{background:#8b6b4a;color:white;padding:1px 6px;border-radius:4px;margin-left:6px;font-size:10px;font-weight:600;
}
.organ-attrs-header-bar{display:flex;justify-content:space-between;align-items:center;margin:15px 0 8px 0;font-size:12px;font-weight:bold;color:#4a3c31;border-bottom:1px solid #d4c4a8;padding-bottom:4px;
}
.organ-attrs-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:15px;
}
.organ-attrs-grid.layout-all-expanded{grid-template-columns:repeat(2,1fr);
}
.organ-attr-compact-card{background:var(--ot-bg,#e8d4a8);border:1px solid var(--ot-border,#c4a06a);border-radius:6px;padding:4px 2px;min-height:46px;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:all 0.15s ease;box-shadow:0 1px 2px rgba(0,0,0,0.02);position:relative;
}
.organ-attr-compact-card:hover{border-color:#b8956a;box-shadow:0 0 0 1px #b8956a;
}
.compact-header-vertical{display:flex;flex-direction:column;align-items:center;gap:3px;width:100%;
}
.compact-header-vertical i{font-size:15px;color:#6b5b4a;
}
.organ-attr-value{font-family:var(--font-tech);font-weight:700;font-size:11px;color:#4a3c31;line-height:1.1;text-align:center;white-space:nowrap;
}
.organ-attr-value.attr-up{color:#2d8a4e !important;
}
.organ-attr-value.attr-down{color:#ba3a2a !important;
}
.compact-detail{position:absolute;bottom:115%;left:50%;transform:translate(-50%,-6px);width:160px;background:var(--tt-bg-soft) !important;border:1px solid var(--tt-bg-soft-border) !important;border-radius:6px;padding:8px 10px !important;box-shadow:0 4px 12px rgba(90,70,50,0.18) !important;z-index:100;opacity:0;pointer-events:none;transition:opacity 0.15s ease,transform 0.15s ease;text-align:left;white-space:normal;display:block !important;
}
.organ-attr-compact-card:hover .compact-detail{opacity:1;transform:translate(-50%,0);
}

.organ-attr-compact-card.edge-left .compact-detail{left:0 !important;transform:translate(0,-6px) !important;
}

.organ-attr-compact-card:hover.edge-left .compact-detail{transform:translate(0,0) !important;
}

.organ-attr-compact-card.edge-right .compact-detail{left:auto !important;right:0 !important;transform:translate(0,-6px) !important;
}

.organ-attr-compact-card:hover.edge-right .compact-detail{transform:translate(0,0) !important;
}
.compact-attr-name{font-size:14px;font-weight:700;color:var(--tt-bg-soft-text);margin-bottom:3px;border-bottom:1px dashed rgba(90,70,50,0.15);padding-bottom:2px;
}
.compact-brief{font-size:12px;font-weight:600;margin-bottom:2px;
}
.compact-brief.effect-buff{color:#1a7f37 !important;
}
.compact-brief.effect-debuff{color:#cf222e !important;
}
.compact-brief.effect-normal{color:#57606a !important;
}
.compact-desc{font-size:11px;color:var(--tt-bg-soft-text-sub);line-height:1.25;word-break:break-all;
}
.organ-attr-compact-card.expanded{grid-column:span 3;align-items:flex-start;padding:8px 10px;
}
.organ-attrs-grid.layout-all-expanded .organ-attr-compact-card.expanded{grid-column:span 1;align-items:flex-start;padding:8px 10px;
}
.organ-attr-compact-card.expanded .compact-header-vertical{flex-direction:row;justify-content:space-between;align-items:center;border-bottom:1px solid #e8ddc8;padding-bottom:4px;
}
.organ-attr-compact-card.expanded .compact-header-vertical i{font-size:13px;
}
.organ-slots-header{font-size:13px;margin:15px 0 10px 0;font-weight:700;color:#4a3c31;border-bottom:1px solid #d4c4a8;padding-bottom:4px;
}
.visual-organ-container{position:relative;width:100%;aspect-ratio:1 / 1;background-color:#e5d7b5;background-size:100% 100%;background-position:center center;background-repeat:no-repeat;border-radius:8px;border:1px solid var(--ot-border,#d4c4a8);overflow:hidden;
}
.organ-lines-svg{position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2;
}
.organ-lines-svg path{fill:none;stroke:rgba(180,140,80,0.3);stroke-width:0.8px;stroke-dasharray:2 2;
}
.organ-gear-slot{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column; align-items:center;cursor:pointer;z-index:5;transition:transform 0.15s ease;
}
.organ-gear-slot:hover{transform:translate(-50%,-50%) scale(1.08);
}
.organ-gear-slot:active{transform:translate(-50%,-50%) scale(0.95);
}
.organ-gear-circle{width:54px;height:54px;border-radius:50%;background:rgba(253,251,245,0.4) !important;backdrop-filter:blur(6px) saturate(110%) !important;-webkit-backdrop-filter:blur(6px) saturate(110%) !important;border:1.5px solid rgba(200,180,150,0.6) !important;display:flex;align-items:center;justify-content:center;box-shadow:inset 0 1px 3px rgba(255,255,255,0.6),0 3px 8px rgba(90,70,50,0.12) !important;z-index:2;transition:border-color 0.2s ease,box-shadow 0.2s ease,transform 0.2s ease;
}

.organ-gear-slot.is-empty .organ-gear-circle{background:rgba(90,70,50,0.06) !important;border:1.5px dashed rgba(180,150,110,0.4) !important;box-shadow:inset 2px 2px 5px rgba(0,0,0,0.12),inset -2px -2px 4px rgba(255,255,255,0.5) !important;backdrop-filter:blur(1px) !important;
}

.organ-gear-slot.is-empty .organ-gear-circle i{color:rgba(90,70,50,0.2) !important;text-shadow:none !important;
}

.organ-backpack-item:hover{transform:translateY(-2px);box-shadow:0 2px 8px rgba(90,70,50,0.2),inset 0 1px 2px rgba(255,255,255,0.7),0 1px 2px rgba(0,0,0,0.1);border-color:rgba(180,140,80,0.5) !important;
}
#rpg_status_bar-panel .organ-backpack-item.is-unadapted,
#rpg_status_bar-panel .organ-backpack-item.is-unadapted:hover{border-color:transparent !important;box-shadow:inset 0 1px 2px rgba(255,255,255,0.7),0 1px 2px rgba(0,0,0,0.1) !important;
}
#rpg_status_bar-panel .organ-backpack-item{position:relative;box-sizing:border-box;width:100%;aspect-ratio:1;border-radius:var(--organ-card-radius) !important;padding:var(--organ-card-pad-y) var(--organ-card-pad-x) !important;background:linear-gradient(180deg,rgba(180,150,100,0.1) 0%,rgba(180,150,100,0.18) 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--organ-card-gap);cursor:pointer;transition:all 0.15s ease;border:1px solid transparent !important;box-shadow:inset 0 2px 4px rgba(0,0,0,0.08),inset 0 -1px 1px rgba(255,255,255,0.4);
}

#rpg_status_bar-panel .organ-backpack-item .card-icon{font-size:var(--organ-card-icon-size);line-height:1;
}

#rpg_status_bar-panel .organ-backpack-item .card-name{font-size:var(--organ-card-name-size);font-weight:700;text-align:center;max-width:var(--organ-card-name-w);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1;
}
#rpg_status_bar-panel .organ-backpack-item .organ-slot-card-inner{width:100%;height:100%;background:var(--ot-bg-soft,#dcc896);border-radius:calc(var(--organ-card-radius) - 1px);box-shadow:inset 0 1px 2px rgba(255,255,255,0.7),0 1px 2px rgba(0,0,0,0.1);padding:2px 4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;position:relative;z-index:1;
}

#rpg_status_bar-panel .organ-backpack-item.is-unadapted .organ-slot-card-inner{box-shadow:inset 0 1px 2px rgba(255,255,255,0.7),0 1px 2px rgba(0,0,0,0.1) !important;
}
#rpg_status_bar-panel .organ-backpack-item.is-unadapted::before{content:'';position:absolute;inset:0;border-radius:6px;box-shadow:0 0 8px 4px rgba(207,34,46,0.5),0 0 20px 10px rgba(207,34,46,0.25);z-index:-1;pointer-events:none;
}

.organ-gear-slot.is-empty{cursor:pointer !important;pointer-events:auto !important;
}

.organ-gear-slot.is-empty:hover{transform:translate(-50%,-50%) scale(1.08) !important;box-shadow:0 0 10px rgba(90,70,50,0.15);
}

.organ-gear-slot.organ-multi-slot{z-index:3;
}

.organ-gear-slot.organ-multi-slot .organ-gear-circle{width:44px !important;height:44px !important;transform:scale(0.75);
}

.organ-gear-slot.organ-multi-slot.is-empty .organ-gear-circle{transform:scale(0.75);
}

.organ-gear-slot.organ-multi-slot{cursor:pointer !important;pointer-events:auto !important;z-index:3;
}
.organ-gear-slot:hover .organ-gear-circle{transform:scale(1.08);
}
.organ-gear-circle i{font-size:22px;color:#5a4632;
}
.organ-gear-slot.has-organ .organ-gear-circle{border-color:rgba(180,140,80,0.5) !important;box-shadow:inset 0 1px 2px rgba(255,255,255,0.5),0 0 8px rgba(180,140,80,0.25) !important;
}

.organ-gear-slot.has-organ .organ-gear-circle i{color:#8b6b4a;
}
.organ-gear-slot.quality-rare .organ-gear-circle{}

.organ-gear-slot.quality-rare .organ-gear-circle i{color:#9b51e0;
}
.organ-gear-slot.quality-legendary .organ-gear-circle{}

.organ-gear-slot.quality-legendary .organ-gear-circle i{color:#f2994a;
}
.organ-gear-slot.quality-cursed .organ-gear-circle{}

.organ-gear-slot.quality-cursed .organ-gear-circle i{color:#eb5757;
}
.organ-gear-slot.quality-unadapted .organ-gear-circle{border-color:#cf222e !important;animation:organ-unadapted-pulse 1.5s ease-in-out infinite;
}

.organ-gear-slot.quality-unadapted .organ-gear-circle i{}

@keyframes organ-unadapted-pulse{0%,100%{box-shadow:0 0 4px rgba(207,34,46,0.4);}
50%{box-shadow:0 0 12px rgba(207,34,46,0.8);}

}
.organ-gear-label-box{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.9);background:var(--tt-bg-soft);border:1px solid var(--tt-bg-soft-border);border-radius:10px;padding:2px 8px;font-size:11px;display:flex;white-space:nowrap;align-items:center;box-shadow:0 2px 6px rgba(90,70,50,0.15);pointer-events:none;z-index:10;opacity:0;transition:opacity 0.15s ease,transform 0.15s ease;
}
.organ-gear-slot:hover .organ-gear-label-box{opacity:1;transform:translate(-50%,-50%) scale(1);
}
.organ-gear-val-name{color:#4a3c31;font-weight:600;max-width:100px;overflow:hidden;text-overflow:ellipsis;
}
:root,
#rpg_status_bar-panel,
#rpg_status_bar-popup{--tt-bg-soft:#f2e6ce;        --tt-bg-soft-text:#4a3c31;   --tt-bg-soft-text-sub:#6b5b4a; --tt-bg-soft-border:#c4ae80;
}
#rpg_status_bar-popup .organ-theme-card{--ot-bg:#e8d4a8;--ot-bg-soft:#dcc896;--ot-border:#c4a06a;--ot-text-main:#4a3c31;--ot-text-sub:#6b5b4a;--ot-text-weak:#9a8a75;--organ-card-h:52px;--organ-card-radius:6px;--organ-card-pad-y:4px;--organ-card-pad-x:2px;--organ-card-gap:2px;--organ-card-icon-size:14px;--organ-card-name-size:9px;--organ-card-name-w:70px;background:var(--ot-bg,#e8d4a8) !important;border:1px solid var(--ot-border,#c4a06a) !important;border-radius:12px !important;width:90% !important;max-width:340px !important;box-shadow:0 8px 30px rgba(0,0,0,0.15) !important;color:var(--ot-text-main,#4a3c31) !important;padding:16px !important;
}
#rpg_status_bar-popup .organ-theme-card .organ-card-base{position:relative;box-sizing:border-box;width:100%;height:var(--organ-card-h) !important;border-radius:var(--organ-card-radius) !important;padding:var(--organ-card-pad-y) var(--organ-card-pad-x) !important;background:var(--ot-bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--organ-card-gap);cursor:pointer;transition:all 0.15s ease;
}

#rpg_status_bar-popup .organ-theme-card .organ-card-base .card-icon{font-size:var(--organ-card-icon-size);line-height:1;
}

#rpg_status_bar-popup .organ-theme-card .organ-card-base .card-name{font-size:var(--organ-card-name-size);font-weight:700;text-align:center;max-width:var(--organ-card-name-w);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1;
}
#rpg_status_bar-popup .organ-theme-card .rejection-organ-card{}
#rpg_status_bar-popup .organ-theme-card .organ-slot-card-base{background:linear-gradient(180deg,rgba(90,70,50,0.04) 0%,rgba(90,70,50,0.08) 100%);box-shadow:inset 0 2px 4px rgba(0,0,0,0.08),inset 0 -1px 1px rgba(255,255,255,0.4);transition:all 0.15s ease;border:1px solid transparent !important;padding:3px !important;
}

#rpg_status_bar-popup .organ-theme-card .organ-slot-card-base.is-empty{border:1px solid rgba(90,70,50,0.14) !important;background:transparent;box-shadow:inset 1px 1px 4px rgba(90,70,50,0.2),inset -0.5px -0.5px 1px rgba(255,255,255,0.06);
}

#rpg_status_bar-popup .organ-theme-card .organ-slot-card-base.has-organ{border:1px solid rgba(180,140,80,0.25) !important;
}

#rpg_status_bar-popup .organ-theme-card .organ-slot-card-base.selected{border:2px solid #8b6b4a !important;box-shadow:inset 0 2px 4px rgba(0,0,0,0.08),0 0 6px rgba(139,107,74,0.45) !important;
}
#rpg_status_bar-popup .organ-theme-card .organ-slot-card-inner{width:100%;height:100%;background:var(--ot-bg);border-radius:calc(var(--organ-card-radius) - 1px);box-shadow:inset 0 1px 2px rgba(255,255,255,0.7),0 1px 2px rgba(0,0,0,0.1);padding:2px 4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;position:relative;z-index:1;
}
#rpg_status_bar-popup .organ-theme-card .organ-slot-card-base.has-organ .organ-slot-card-inner{box-shadow:inset 0 1px 2px rgba(255,255,255,0.7),0 0 6px rgba(139,107,74,0.25);
}
#rpg_status_bar-popup .organ-theme-card .organ-slot-card-base.is-empty .organ-slot-card-inner{background:transparent;border-radius:0;box-shadow:none;opacity:0.55;
}
#rpg_status_bar-popup .organ-theme-card .organ-slot-card-inner.is-unadapted{box-shadow:inset 0 1px 2px rgba(255,255,255,0.7),0 1px 2px rgba(0,0,0,0.1),0 0 8px 3px rgba(207,34,46,0.3),0 0 16px 6px rgba(207,34,46,0.1) !important;
}
#rpg_status_bar-popup .organ-theme-card .organ-slot-card-base:hover .organ-slot-card-inner{box-shadow:inset 0 1px 2px rgba(255,255,255,0.8),0 0 10px rgba(139,107,74,0.4);transform:scale(1.04);
}

#rpg_status_bar-popup .organ-theme-card .organ-slot-card-base.is-empty:hover .organ-slot-card-inner{transform:none;box-shadow:none;}

#rpg_status_bar-popup .organ-theme-card .organ-slot-card-base.has-organ:hover .organ-slot-card-inner{box-shadow:inset 0 1px 2px rgba(255,255,255,0.8),0 0 12px rgba(139,107,74,0.5);transform:scale(1.04);
}
html[data-darkreader-mode="dark"] #rpg_status_bar-popup .organ-theme-card,
html.darkreader--dark #rpg_status_bar-popup .organ-theme-card{background:var(--ot-bg) !important;border-color:var(--ot-border) !important;color:var(--ot-text-main) !important;--darkreader-bg:#fcf6ea !important;--darkreader-text:#4a3c31 !important;--darkreader-border:#d4c4a8 !important;
}

html[data-darkreader-mode="dark"] #rpg_status_bar-popup .organ-theme-card *,
html.darkreader--dark #rpg_status_bar-popup .organ-theme-card *{--darkreader-bg:transparent !important;--darkreader-text:#4a3c31 !important;
}
html[data-darkreader-mode="dark"] #rpg_status_bar-panel .compact-detail,
html.darkreader--dark #rpg_status_bar-panel .compact-detail,
html[data-darkreader-mode="dark"] #rpg_status_bar-panel .organ-gear-label-box,
html.darkreader--dark #rpg_status_bar-panel .organ-gear-label-box{background:var(--tt-bg-soft) !important;color:var(--tt-bg-soft-text) !important;border-color:var(--tt-bg-soft-border) !important;--darkreader-bg:#f8f0dc !important;--darkreader-text:#4a3c31 !important;--darkreader-border:#d4c4a8 !important;
}

html[data-darkreader-mode="dark"] #rpg_status_bar-panel .compact-detail *,
html.darkreader--dark #rpg_status_bar-panel .compact-detail *,
html[data-darkreader-mode="dark"] #rpg_status_bar-panel .organ-gear-label-box *,
html.darkreader--dark #rpg_status_bar-panel .organ-gear-label-box *{--darkreader-bg:transparent !important;--darkreader-text:#4a3c31 !important;
}
html[data-darkreader-mode="dark"] #rpg_status_bar-popup .slot-sub-menu,
html.darkreader--dark #rpg_status_bar-popup .slot-sub-menu,
html[data-darkreader-mode="dark"] #rejection-confirm-overlay > div,
html.darkreader--dark #rejection-confirm-overlay > div,
html[data-darkreader-mode="dark"] #rpg_status_bar-popup #organ-shared-tooltip,
html.darkreader--dark #rpg_status_bar-popup #organ-shared-tooltip{background:var(--tt-bg-soft) !important;color:var(--tt-bg-soft-text) !important;--darkreader-bg:#f8f0dc !important;--darkreader-text:#4a3c31 !important;
}

html[data-darkreader-mode="dark"] #rpg_status_bar-popup #organ-shared-tooltip *,
html.darkreader--dark #rpg_status_bar-popup #organ-shared-tooltip *{--darkreader-bg:transparent !important;--darkreader-text:#4a3c31 !important;
}
#rpg_status_bar-popup .organ-theme-card .popup-close{position:absolute;top:12px;right:12px;background:none;border:none;cursor:pointer;font-size:16px;color:#57606a;
}
#rpg_status_bar-popup .organ-theme-card .organ-bonus-chip{display:inline-block;font-size:9.5px;background:rgba(139,107,74,0.08);color:#8b6b4a;border:1px solid rgba(139,107,74,0.2);padding:1px 5px;border-radius:4px;font-weight:600;font-style:normal;
}
.organ-standalone-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:95vw;max-width:1280px;height:90vh;max-height:900px;background:url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxODAiIGhlaWdodD0iMTgwIj4KICA8ZmlsdGVyIGlkPSJwYXBlcl9ub2lzZSI+CiAgICA8ZmVUdXJidWxlbmNlIHR5cGU9ImZyYWN0YWxOb2lzZSIgYmFzZUZyZXF1ZW5jeT0iMC4yNSIgbnVtT2N0YXZlcz0iMyIgcmVzdWx0PSJub2lzZSIvPgogICAgPGZlQ29sb3JNYXRyaXggdHlwZT0ibWF0cml4IiB2YWx1ZXM9IjEgMCAwIDAgMCAgMCAxIDAgMCAwICAwIDAgMSAwIDAgIDAgMCAwIDAuMjAgMCIvPgogIDwvZmlsdGVyPgogIDxyZWN0IHdpZHRoPSIxODAiIGhlaWdodD0iMTgwIiBmaWx0ZXI9InVybCgjcGFwZXJfbm9pc2UpIiBmaWxsPSJub25lIi8+Cjwvc3ZnPg==") repeat, linear-gradient(145deg,#f2e6ce 0%,#e8d5b0 50%,#f0dcc0 100%);border:1px solid var(--tt-bg-soft-border,#c4a06a);border-radius:16px;box-shadow:0 20px 60px rgba(90,70,50,0.3);z-index:999998;display:flex;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;color:var(--ot-text-main,#4a3c31);
}

.organ-standalone-panel .organ-panel-header{display:flex;align-items:center;gap:16px;padding:14px 20px;background:linear-gradient(135deg,rgba(180,140,80,0.2) 0%,rgba(200,170,110,0.12) 100%);border-bottom:1px solid var(--tt-bg-soft-border,#d4c4a8);
}

.organ-standalone-panel .organ-panel-header h2{margin:0;font-size:17px;font-weight:700;color:var(--ot-text-main,#2d1b0e);display:flex;align-items:center;gap:8px;
}

.organ-standalone-panel .organ-panel-header h2 i{color:#8b6b4a;font-size:20px;
}

.organ-standalone-panel .organ-panel-close{background:none;border:none;cursor:pointer;color:#9a8a75;font-size:22px;line-height:1;padding:4px 8px;border-radius:6px;transition:background 0.15s,color 0.15s;
}

.organ-standalone-panel .organ-panel-close:hover{background:rgba(180,140,80,0.1);color:#8b3a2a;
}

.organ-standalone-panel .organ-panel-main{flex:1;display:grid;grid-template-columns:minmax(260px,0.7fr) minmax(380px,1.3fr);gap:16px;padding:16px;overflow:hidden;min-height:0;
}

.organ-standalone-panel .organ-panel-backpack{display:flex;flex-direction:column;background:url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxODAiIGhlaWdodD0iMTgwIj4KICA8ZmlsdGVyIGlkPSJwYXBlcl9ub2lzZSI+CiAgICA8ZmVUdXJidWxlbmNlIHR5cGU9ImZyYWN0YWxOb2lzZSIgYmFzZUZyZXF1ZW5jeT0iMC4yNSIgbnVtT2N0YXZlcz0iMyIgcmVzdWx0PSJub2lzZSIvPgogICAgPGZlQ29sb3JNYXRyaXggdHlwZT0ibWF0cml4IiB2YWx1ZXM9IjEgMCAwIDAgMCAgMCAxIDAgMCAwICAwIDAgMSAwIDAgIDAgMCAwIDAuMTUgMCIvPgogIDwvZmlsdGVyPgogIDxyZWN0IHdpZHRoPSIxODAiIGhlaWdodD0iMTgwIiBmaWx0ZXI9InVybCgjcGFwZXJfbm9pc2UpIiBmaWxsPSJub25lIi8+Cjwvc3ZnPg==") repeat, var(--ot-bg,#e8d4a8);border:1px solid var(--ot-border,#c4a06a);border-radius:10px;overflow:hidden;min-height:0;
}

.organ-standalone-panel .organ-panel-section-header{padding:10px 14px;border-bottom:1px solid var(--ot-border,#c4a06a);display:flex;align-items:center;justify-content:space-between;color:var(--ot-text-main,#4a3c31);
}

.organ-standalone-panel .organ-panel-section-title{font-size:13px;font-weight:700;color:#5a4632;display:flex;align-items:center;gap:6px;
}

.organ-standalone-panel .organ-panel-stats{display:flex;flex-direction:column;gap:12px;min-height:0;padding-right:4px;
}

.organ-standalone-panel .organ-panel-section-card{background:url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxODAiIGhlaWdodD0iMTgwIj4KICA8ZmlsdGVyIGlkPSJwYXBlcl9ub2lzZSI+CiAgICA8ZmVUdXJidWxlbmNlIHR5cGU9ImZyYWN0YWxOb2lzZSIgYmFzZUZyZXF1ZW5jeT0iMC4yNSIgbnVtT2N0YXZlcz0iMyIgcmVzdWx0PSJub2lzZSIvPgogICAgPGZlQ29sb3JNYXRyaXggdHlwZT0ibWF0cml4IiB2YWx1ZXM9IjEgMCAwIDAgMCAgMCAxIDAgMCAwICAwIDAgMSAwIDAgIDAgMCAwIDAuMTIgMCIvPgogIDwvZmlsdGVyPgogIDxyZWN0IHdpZHRoPSIxODAiIGhlaWdodD0iMTgwIiBmaWx0ZXI9InVybCgjcGFwZXJfbm9pc2UpIiBmaWxsPSJub25lIi8+Cjwvc3ZnPg==") repeat, var(--ot-bg,#e8d4a8);border:1px solid var(--ot-border,#c4a06a);border-radius:10px;flex:1;min-height:0;
}

/* 躯体 + 生理属性横向并排 */
.organ-standalone-panel .organ-body-attrs-row{display:flex;flex-direction:row;min-height:0;height:100%;
}
.organ-standalone-panel .organ-body-slots{flex:1;min-width:0;padding:12px;box-sizing:border-box;
}
.organ-standalone-panel .organ-attrs-column{width:28%;flex-shrink:0;padding:10px;box-sizing:border-box;border-left:1px solid var(--ot-border,#d4c4a8);
}
.organ-standalone-panel .organ-attrs-column .organ-attrs-grid{grid-template-columns:repeat(3,1fr);
}

.organ-standalone-panel .organ-panel-toolbar{display:flex;align-items:center;gap:8px;padding:10px 16px;background:rgba(180,140,80,0.06);border-top:1px solid var(--tt-bg-soft-border,#d4c4a8);
}

.organ-standalone-panel .organ-btn-tool{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.15s;border:1px solid transparent;
}

.organ-standalone-panel .organ-btn-tool.blue{background:rgba(180,140,80,0.1);border-color:rgba(180,140,80,0.3);color:#6b4f32;
}

.organ-standalone-panel .organ-btn-tool.blue:hover{background:rgba(180,140,80,0.18);
}

.organ-standalone-panel .organ-btn-tool.purple{background:rgba(180,140,80,0.08);border-color:rgba(180,140,80,0.25);color:#6b4f32;
}

.organ-standalone-panel .organ-btn-tool.purple:hover{background:rgba(180,140,80,0.18);
}

.organ-standalone-panel .organ-btn-tool.brown{background:rgba(180,140,80,0.12);border-color:rgba(180,140,80,0.3);color:#6b4f32;
}

.organ-standalone-panel .organ-btn-tool.brown:hover{background:rgba(180,140,80,0.2);
}

.organ-standalone-panel .organ-backpack-grid{flex:1;overflow-y:scroll;overflow-x:hidden;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));grid-auto-rows:auto;gap:5px;padding:6px;position:relative;min-height:0;scrollbar-width:none;-ms-overflow-style:none;align-content:start;
}
.organ-standalone-panel .organ-backpack-grid::-webkit-scrollbar{width:0;height:0;display:none;background:transparent;
}
.organ-standalone-panel .organ-backpack-grid::-webkit-scrollbar-track{background:transparent;
}
.organ-standalone-panel .organ-backpack-grid::-webkit-scrollbar-thumb{background:transparent;
}
.organ-standalone-panel .organ-backpack-grid .organ-backpack-item{position:relative;border-radius:6px;background:var(--ot-bg-soft,#dcc896);border:1.5px solid var(--ot-border,#c4a06a);transition:all 0.15s ease;cursor:pointer;display:flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:0;aspect-ratio:1/1;width:100%;
}
.organ-standalone-panel .organ-backpack-grid .organ-backpack-item:hover{border-color:var(--ot-text-sub,#6b5b4a);box-shadow:0 0 0 1px var(--ot-text-sub,#6b5b4a);transform:translateY(-1px);
}
.organ-standalone-panel .organ-backpack-grid .organ-backpack-item.is-unadapted{border-color:var(--ot-border,#c4a06a);
}
.organ-standalone-panel .organ-backpack-grid .organ-backpack-item.is-unadapted::before{content:'';position:absolute;inset:0;border-radius:6px;box-shadow:0 0 8px 4px rgba(207,34,46,0.5),0 0 20px 10px rgba(207,34,46,0.25);z-index:-1;pointer-events:none;
}
.organ-standalone-panel .organ-backpack-grid .organ-backpack-item .organ-slot-card-inner{width:100%;height:100%;border-radius:5px;background:transparent;box-shadow:none;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6%;gap:6%;box-sizing:border-box;
}
.organ-standalone-panel .organ-backpack-grid .organ-backpack-item .organ-slot-card-inner .card-icon{width:50%;height:50%;font-size:max(60%, 16px) !important;line-height:1;display:flex;align-items:center;justify-content:center;
}
.organ-standalone-panel .organ-backpack-grid .organ-backpack-item .organ-slot-card-inner .card-name{font-size:max(20%, 10px) !important;font-weight:600;text-align:center;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.1;
}

.organ-standalone-panel .organ-backpack-empty{grid-column:1 / -1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 10px;color:#afb8c1;font-size:12px;text-align:center;gap:6px;
}

.organ-standalone-panel .organ-backpack-empty i{font-size:28px;color:#c4b08a;
}

.organ-standalone-panel .organ-panel-esc-hint{font-size:10px;color:#9a8a75;
}

.organ-tooltip-container{display:none;position:absolute;width:220px;background:var(--tt-bg-soft);border:1px solid var(--tt-bg-soft-border);color:var(--tt-bg-soft-text);border-radius:8px;padding:10px;box-shadow:0 4px 16px rgba(90,70,50,0.18);z-index:9999;font-size:10px;pointer-events:none;line-height:1.4;word-break:break-all}
.organ-empty-state{grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px 10px;color:#afb8c1;font-size:11px;text-align:center;gap:4px}
.organ-medicine-btn{font-size:10px;color:#6b4f32;font-weight:600;background:rgba(180,140,80,0.08);padding:2px 8px;border-radius:4px;border:1px solid rgba(180,140,80,0.25);cursor:pointer;transition:all .15s ease;display:flex;align-items:center;gap:4px}
.organ-badge-count{font-size:10px;color:#9a8a75;font-weight:600;background:rgba(255,255,255,0.5);padding:2px 8px;border-radius:10px}
/* tooltip 智能避开容器边界 */
.organ-attr-compact-card.tooltip-below .compact-detail{bottom:auto !important;top:calc(100% + 8px) !important;transform:translate(-50%, 8px) !important;}
.organ-attr-compact-card.tooltip-below:hover .compact-detail{transform:translate(-50%,0) !important;}
/* tooltip 水平智能避开边界（动态检测，覆盖静态 edge-left/right） */
.organ-attr-compact-card.tt-right .compact-detail{left:auto !important;right:0 !important;transform:translate(0,-6px) !important;}
.organ-attr-compact-card.tt-right:hover .compact-detail{transform:translate(0,0) !important;}
.organ-attr-compact-card.tt-left .compact-detail{left:0 !important;transform:translate(0,-6px) !important;}
.organ-attr-compact-card.tt-left:hover .compact-detail{transform:translate(0,0) !important;}
.organ-attr-compact-card.tooltip-below.tt-right .compact-detail,.organ-attr-compact-card.tooltip-below.tt-left .compact-detail{transform:translate(0,8px) !important;}
.organ-attr-compact-card.tooltip-below.tt-right:hover .compact-detail,.organ-attr-compact-card.tooltip-below.tt-left:hover .compact-detail{transform:translate(0,0) !important;}
`;
    document.head.appendChild(style);
  };
  // 在酒馆助手中，脚本运行在 iframe 沙箱里，必须用 parent 操作主页面 DOM
  const openOrganPanel = () => {
    const panelId = `organ-system-panel`;
    const parentWin = (() => { try { return window.parent; } catch(e) { return window; } })();
    const parentDoc = parentWin.document || document;
    const parent$ = parentWin.jQuery || parentWin.$ || $;
    if (!parent$) {
      console.warn('[OrganModule] openOrganPanel: jQuery 未就绪（包括父窗口）');
      return false;
    }

    // === 注入样式到主页面（仅一次）===
    try {
      if (!parentDoc.getElementById('organ-system-styles')) {
        injectStyles();
        const localStyle = document.getElementById('organ-system-styles');
        if (localStyle) {
          const styleEl = parentDoc.createElement('style');
          styleEl.id = 'organ-system-styles';
          styleEl.textContent = localStyle.textContent;
          parentDoc.head.appendChild(styleEl);
        } else {
          console.warn('[OrganModule] injectStyles 后仍找不到样式元素');
        }
      }
    } catch (e) { console.warn('[OrganModule] 注入样式失败:', e); }

    // === 初始化器官数据 ===
    runOnceOrganSystemInitialization();
    const data = fetchLatestMvuData();
    if (data && Object.keys(data).length > 0) {
      autoInitializeMissingOrgans(data);
    }

    // === 复用已存在的器官面板或新建 ===
    let $panel = parent$(`#${panelId}`);
    if (!$panel.length) {
      console.log('[OrganModule] 创建独立器官系统界面');
      const standaloneHtml = buildStandaloneOrganPanel();
      const tempDiv = parentDoc.createElement('div');
      tempDiv.innerHTML = standaloneHtml;
      const newPanel = tempDiv.firstElementChild;
      parentDoc.body.appendChild(newPanel);
      $panel = parent$(`#${panelId}`);
      // 绑定关闭按钮
      $panel.find('.organ-panel-close').on('click', closeOrganPanel);
      // ESC 关闭
      parent$(parentDoc).on('keydown.organSystem', (e) => {
        if (e.key === 'Escape') closeOrganPanel();
      });
      // 点击面板外部关闭（mousedown 触发，比 click 早，避免和内部点击冲突）
      parent$(parentDoc).on('mousedown.organSystemOutside', (e) => {
        const $t = parent$(e.target);
        if (!$t.closest('#organ-system-panel').length) {
          closeOrganPanel();
        }
      });
    }

    // 显示面板（带淡入动画）
    $panel.css('display', 'flex').hide().fadeIn(220);

    // 渲染内容
    try { updateOrganUI(); } catch (e) { console.error('[OrganModule] updateOrganUI 失败:', e); }

    // 初始化 tooltip 智能定位（仅一次）
    const panelEl = $panel[0];
    if (panelEl && !panelEl._smartTooltipInited) {
      const attrsCol = panelEl.querySelector('.organ-attrs-column');
      if (attrsCol) {
        smartTooltipPosition(attrsCol, '.organ-attr-compact-card', '.compact-detail', 'tooltip-below', { container: '.organ-standalone-panel' });
        panelEl._smartTooltipInited = true;
      }
    }

    return true;
  };

  // 关闭器官面板
  const closeOrganPanel = () => {
    let targetDoc, target$;
    try { targetDoc = window.parent.document; target$ = window.parent.jQuery || window.parent.$; } catch(e) {}
    if (!targetDoc) { targetDoc = document; target$ = $; }
    const $panel = target$(`#organ-system-panel`);
    if ($panel.length) {
      $panel.fadeOut(180, function() { target$(this).remove(); });
    }
    try {
      target$(targetDoc).off('keydown.organSystem');
      target$(targetDoc).off('mousedown.organSystemOutside');
    } catch (e) {}
  };

  // ---
  // 布局：顶部 header / 中部 grid（左：器官背包，右：生理属性 + 已装备器官）/ 底部 toolbar
  const buildStandaloneOrganPanel = () => {
    return `
      <div id="organ-system-panel" class="organ-standalone-panel" data-theme="warm-white">
        <!-- 顶部 header：标题 + 状态徽章 + 关闭按钮 -->
        <div class="organ-panel-header">
          <h2>
            <i class="ri-heart-pulse-fill"></i>
            器官移植系统
          </h2>
          <div id="organ-status-info" style="display: flex; gap: 12px; flex: 1;"></div>
          <div id="organ-set-info" style="display: flex; gap: 6px;"></div>
          <button class="organ-panel-close" title="关闭（ESC）">
            <i class="ri-close-line"></i>
          </button>
        </div>

        <!-- 中部主区：左背包，右属性+装备 -->
        <div class="organ-panel-main">
          <!-- 左侧：器官背包 -->
          <div class="organ-panel-backpack">
            <div class="organ-panel-section-header section-red">
              <span class="organ-panel-section-title">
                <i class="ri-heart-pulse-line" style="color: #8b6b4a;"></i> 器官背包
              </span>
              <span style="display: flex; align-items: center; gap: 8px;">
                <span class="organ-backpack-count organ-badge-count">0 件</span>
                <span id="organ-medicine-btn" class="organ-medicine-btn" title="点击使用排异药剂">
                  <i class="ri-flask-fill" style="font-size: 11px;"></i>
                  排异药剂 <b class="organ-medicine-count" style="color: #6b4f32;">0</b>
                </span>
              </span>
            </div>
            <div class="organ-backpack-grid" id="organ-backpack-grid">
              <div id="organ-backpack-tooltip" class="organ-tooltip-container"></div>
              <div class="organ-backpack-empty">
                <i class="ri-briefcase-3-line"></i>
                <span>背包中暂无可用器官配件</span>
                <span class="hint">点击下方"生成测试器官"创建</span>
              </div>
            </div>
          </div>

          <!-- 右侧：躯体 + 生理属性（横向并排） -->
          <div class="organ-panel-stats">
            <div class="organ-panel-section-card">
              <div class="organ-panel-section-header section-blue">
                <i class="ri-body-scan-line" style="color: #5a7a8a;"></i> 躯体
              </div>
              <div class="organ-body-attrs-row">
                <div class="organ-body-slots" id="organ-page-list">
                  <div class="traits-empty" style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; color: #afb8c1; font-size: 12px; gap: 4px;">
                    <i class="ri-ghost-line" style="font-size: 24px; color: #c4b08a;"></i>
                    <span>暂无移植器官</span>
                  </div>
                </div>
                <div class="organ-attrs-column" id="organ-attrs-container"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部 toolbar：操作按钮 -->
        <div class="organ-panel-toolbar">
          <button id="organ-test-random" class="organ-btn-tool blue">
            <i class="ri-test-tube-line"></i> 生成测试器官
          </button>
          <label for="organ-bg-upload-input" class="organ-btn-tool purple" style="cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
            <i class="ri-image-add-line"></i> 更换背景
          </label>
          <input type="file" id="organ-bg-upload-input" accept="image/*" style="display: none;">
          <button id="organ-bg-reset" class="organ-btn-tool brown" style="display: none;">
            <i class="ri-restart-line"></i> 重置背景
          </button>
          <div style="flex: 1;"></div>
          <span class="organ-panel-esc-hint">
            <i class="ri-keyboard-line"></i> ESC 关闭
          </span>
        </div>
      </div>
    `;
  };

  // ---
  window.OrganModule = {
    injectStyles,
    refreshStatusBar,
    updateOrganUI,
    formatAttrVal,
    smartTooltipPosition,
    runOnceOrganSystemInitialization,
    autoInitializeMissingOrgans,
    openOrganPanel,
    closeOrganPanel,
    fetchLatestMvuData,
    applyMvuPatches,
    showToast,
  };

  // ---
  console.log('[OrganModule] 器官系统独立版 v3.0.0 已加载');
  if (!$) {
    console.warn('[OrganModule] jQuery 未就绪，尝试通过 getCore 获取');
    $ = getCore().$;
  }
  if (!$) {
    console.warn('[OrganModule] 仍然无法获取 jQuery，将在 DOM 就绪后重试');
    document.addEventListener('DOMContentLoaded', () => {
      $ = window.jQuery || (window.parent && window.parent.jQuery);
      if ($) {
        console.log('[OrganModule] DOM 就绪后获取到 jQuery');
      }
    });
  }
  setupMvuListener();

  // ---
  // 这些 API 只能在 iframe 沙箱内的酒馆助手脚本中使用
  try {
    if (typeof appendInexistentScriptButtons === 'function') {
      appendInexistentScriptButtons([{ name: '器官系统', visible: true }]);
      console.log('[OrganModule] 已注册"器官系统"按钮');
    } else {
      console.warn('[OrganModule] appendInexistentScriptButtons 不可用（可能未在酒馆助手中执行）');
    }
  } catch (e) {
    console.error('[OrganModule] 注册按钮失败:', e);
  }

  try {
    if (typeof getButtonEvent === 'function' && typeof eventOn === 'function') {
      const eventType = getButtonEvent('器官系统');
      eventOn(eventType, () => {
        console.log('[OrganModule] 器官系统按钮被点击');
        if (window.OrganModule && typeof window.OrganModule.openOrganPanel === 'function') {
          window.OrganModule.openOrganPanel();
        } else {
          console.error('[OrganModule] window.OrganModule.openOrganPanel 不可用');
        }
      });
      console.log('[OrganModule] 按钮事件已绑定:', eventType);
    } else {
      console.warn('[OrganModule] getButtonEvent/eventOn 不可用');
    }
  } catch (e) {
    console.error('[OrganModule] 绑定按钮事件失败:', e);
  }

  // --- 通用悬浮按钮（在任何网页上均可用）---
  const tryAddFloatingBtn = () => {
    try {
      if (document.getElementById('organ-float-btn')) return;
      if (!document.body) { setTimeout(tryAddFloatingBtn, 200); return; }
      const btn = document.createElement('div');
      btn.id = 'organ-float-btn';
      btn.textContent = '🧬';
      btn.title = '器官系统';
      Object.assign(btn.style, {
        position: 'fixed', bottom: '20px', right: '20px', zIndex: '999999',
        width: '44px', height: '44px', borderRadius: '50%',
        background: 'linear-gradient(135deg,#b85c5c,#8e44ad)',
        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', boxShadow: '0 4px 16px rgba(184,92,92,0.5)',
        border: '2px solid rgba(255,255,255,0.3)',
        transition: 'transform 0.15s,box-shadow 0.15s',
        fontSize: '20px', lineHeight: '1'
      });
      btn.onmouseenter = () => { btn.style.transform = 'scale(1.1)'; btn.style.boxShadow = '0 6px 24px rgba(184,92,92,0.7)'; };
      btn.onmouseleave = () => { btn.style.transform = ''; btn.style.boxShadow = ''; };
      btn.onclick = async (e) => {
        e.stopPropagation();
        try {
          const pw = (() => { try { return window.parent; } catch(e) { return window; } })();
          if (!pw.jQuery && !pw.$) {
            await new Promise((resolve, reject) => {
              const s = document.createElement('script');
              s.src = 'https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js';
              s.onload = resolve; s.onerror = reject;
              document.head.appendChild(s);
            });
            // 让模块内部的 $ 指向刚加载的 jQuery
            $ = window.jQuery || (window.parent && window.parent.jQuery) || $;
          }
        } catch(e) { console.warn('[OrganModule] 加载 jQuery 失败:', e); }
        if (window.OrganModule && typeof window.OrganModule.openOrganPanel === 'function') {
          window.OrganModule.openOrganPanel();
        } else {
          console.warn('[OrganModule] openOrganPanel 不可用');
        }
      };
      try {
        const targetDoc = (window.parent && window.parent.document) || document;
        if (targetDoc !== document && targetDoc.body) {
          targetDoc.body.appendChild(btn);
          console.log('[OrganModule] 悬浮按钮已添加到父页面');
          return;
        }
      } catch(e) { /* cross-origin iframe */ }
      document.body.appendChild(btn);
      console.log('[OrganModule] 悬浮按钮已添加');
    } catch(e) {
      console.error('[OrganModule] 添加悬浮按钮失败:', e);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryAddFloatingBtn);
  } else if (document.readyState === 'interactive' || document.readyState === 'complete') {
    tryAddFloatingBtn();
  } else {
    setTimeout(tryAddFloatingBtn, 500);
  }
})();
