// ==UserScript==
// @name         ZZ - RPG 状态栏 - 器官系统
// @namespace    http://tampermonkey.net/
// @version      3.0.0
// @description  器官系统模块（独立运行版，不依赖主脚本）
// @author       Niccole
// @match        */*
// @grant        none
// ==/UserScript==
!(function() {
  // ============================================================
  // 早期注入悬浮按钮（必须在 OrganAttr 检查之前，不依赖任何模块）
  // 使用多重触发器保证按钮一定会显示
  // ============================================================
  (function injectFloatBtnEarly() {
    var btnCreated = false;
    var intervalId = null;

    function createBtn() {
      if (btnCreated) return;
      // 检查所有可能的窗口，按钮可能已经在父窗口创建过
      var docs = [];
      try { if (window.parent && window.parent.document) docs.push(window.parent.document); } catch(e) {}
      try { if (window.top && window.top.document && window.top !== window.parent) docs.push(window.top.document); } catch(e) {}
      if (docs.indexOf(document) === -1) docs.push(document);

      for (var i = 0; i < docs.length; i++) {
        var d = docs[i];
        if (d.getElementById && d.getElementById('organ-float-btn')) {
          btnCreated = true;
          console.log('[OrganModule] 悬浮按钮已存在于现有窗口');
          return;
        }
      }

      // 选择目标文档：优先 parent（同源），其次 current
      var targetDoc = null;
      for (var j = 0; j < docs.length; j++) {
        if (docs[j].body) { targetDoc = docs[j]; break; }
      }
      if (!targetDoc) return;

      var btn = targetDoc.createElement('div');
      btn.id = 'organ-float-btn';
      btn.textContent = '🧬';
      btn.title = '器官系统';
      btn.style.cssText = 'position:fixed !important;bottom:20px !important;right:20px !important;z-index:2147483647 !important;width:44px !important;height:44px !important;border-radius:50% !important;background:linear-gradient(135deg,#b85c5c,#8e44ad) !important;color:#fff !important;display:flex !important;align-items:center !important;justify-content:center !important;cursor:pointer !important;box-shadow:0 4px 16px rgba(184,92,92,0.5) !important;border:2px solid rgba(255,255,255,0.3) !important;font-size:20px !important;line-height:1 !important;pointer-events:auto !important;visibility:visible !important;opacity:1 !important;';
      btn.onmouseenter = function() { btn.style.transform = 'scale(1.1)'; btn.style.boxShadow = '0 6px 24px rgba(184,92,92,0.7)'; };
      btn.onmouseleave = function() { btn.style.transform = ''; btn.style.boxShadow = ''; };
      btn.onclick = function(e) {
        e.stopPropagation();
        e.preventDefault();
        var tryOpen = function() {
          if (window.OrganModule && typeof window.OrganModule.openOrganPanel === 'function') {
            window.OrganModule.openOrganPanel();
          } else {
            console.warn('[OrganModule] openOrganPanel 暂不可用，500ms 后重试');
            setTimeout(tryOpen, 500);
          }
        };
        tryOpen();
      };
      targetDoc.body.appendChild(btn);
      btnCreated = true;
      console.log('[OrganModule] 悬浮按钮已注入 →', targetDoc === document ? '当前窗口' : '父/顶层窗口');
    }

    // 触发器 1: 立即尝试（document-start 时 body 还不存在）
    createBtn();

    // 触发器 2: DOMContentLoaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createBtn);
    } else {
      createBtn();
    }

    // 触发器 3: window.load
    if (document.readyState !== 'complete') {
      window.addEventListener('load', createBtn);
    } else {
      createBtn();
    }

    // 触发器 4: 定时轮询（兜底，10 秒后停止）
    intervalId = setInterval(function() {
      if (btnCreated) { clearInterval(intervalId); return; }
      createBtn();
    }, 200);
    setTimeout(function() { clearInterval(intervalId); }, 10000);

    // 触发器 5: MutationObserver 监听 body 创建
    try {
      var obs = new MutationObserver(function() {
        if (!btnCreated && document.body) {
          createBtn();
        }
        if (btnCreated) obs.disconnect();
      });
      if (document.documentElement) {
        obs.observe(document.documentElement, { childList: true, subtree: false });
      }
    } catch(e) {}
  })();

  // ============================================================
  // 引用 OrganAttributes 数据/效果模块（独立脚本，window.OrganAttr）
  // ============================================================
  if (!window.OrganAttr) {
    console.error('[Organ] OrganAttributes 模块未加载，请先安装 OrganAttributes.js');
    return;
  }
  // 全局错误监听，确保后续代码错误不影响早期注入
  window.addEventListener('error', function(e) {
    if (e.filename && e.filename.includes('Organ.js')) {
      console.error('[Organ] 脚本错误（已被早期注入保护）:', e.message, 'at line', e.lineno);
    }
  });
  const OA = window.OrganAttr;
  const {
    ORGAN_QUALITY_COLORS, QUALITY_RANK, ATTR_QUALITY_MAP, ATTR_DESC_TEXT, ATTR_EFFECT_RULES,
    PHYSIOLOGY_ATTRIBUTES, RESOURCE_ATTRS, isResourceAttr,
    formatAttrVal, getAttrQualityColor, getOrganAttrQualityColor,
    getAttrBonusEffectHtml, computeAttrEffects,
    ORGAN_SLOTS, ORGAN_SLOT_KEYS, ORGAN_STANDARD_SLOTS, SLOTS_LAYOUT, slotsDef,
    ORGAN_PHYSIOLOGY_MAP, REJECTION_SUCCESS_RATES, REJECTION_MEDICINE_COST, QUALITY_ATTR_COUNT_RULES,
    RACE_ORGAN_NAMES, defaultOrgans, safeNum, safeStr, safeArr, safeObj, safeBool,
    getOrganBonus, guessSlotFromOrganName, stripNativePrefix,
    getDefaultOrganForSlot, getNormalizedOrgan,
    findAvailableOrgansForSlot, findAllBackpackOrgans,
    recalculateOrganSystemStats, autoInitializeMissingOrgans,
    fetchLatestMvuData, applyMvuPatches, setupMvuListener, getCore,
  } = OA;
  "use strict";
  let $ = window.jQuery || (window.parent && window.parent.jQuery);
  const SCRIPT_ID = "rpg_status_bar";


  // UI hooks for MVU listener callbacks (registered in OrganAttributes)
  window._organUIHooks = {
    onDataUpdate: () => {
      if (parent$('#organ-system-panel').length) {
        try { updateOrganUI(); } catch (e) { console.error('[OrganModule] auto-refresh failed:', e); }
      }
    },
    onInit: () => {
      runOnceOrganSystemInitialization();
      if (parent$('#organ-system-panel').length) {
        try { updateOrganUI(); } catch (e) { console.error('[OrganModule] init refresh failed:', e); }
      }
    },
  };

  // MVU data layer (getCore, mvuState, fetchLatestMvuData, applyMvuPatches, setupMvuListener, etc.)
  // moved to OrganAttributes.js — accessed via OA namespace

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

  // Data tables (ORGAN_SLOTS, ORGAN_PHYSIOLOGY_MAP, REJECTION_SUCCESS_RATES,
  // QUALITY_ATTR_COUNT_RULES, defaultOrgans, SLOTS_LAYOUT, slotsDef, etc.)
  // moved to OrganAttributes.js — accessed via OA namespace

  // Dead data removed: PHYSIOLOGY_DEBUFFS, PHYSIOLOGY_BUFFS (replaced by ATTR_EFFECT_RULES),
  // REJECTION_MEDICINE_YIELD, QUALITY_BUDGET, TEST_GENERATION_POOLS (unused)

  // guessSlotFromOrganName, stripNativePrefix, getDefaultOrganForSlot, getNormalizedOrgan
  // moved to OrganAttributes.js — accessed via OA namespace


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
  // 上面已通过 window.OrganAttr 解构出所有品质/属性/效果相关常量与工具函数
  // (ORGAN_QUALITY_COLORS, QUALITY_RANK, ATTR_QUALITY_MAP, ATTR_DESC_TEXT,
  //  PHYSIOLOGY_ATTRIBUTES, formatAttrVal, getAttrQualityColor,
  //  getOrganAttrQualityColor, getAttrBonusEffectHtml, computeAttrEffects)
  const buildOrganTooltipHtml = (organ, { name, level = '', quality, qColor, slot, sourceLabel = null, compact = false } = {}) => {
    if (!organ) return '';
    const q = quality || safeStr(organ.品质, '普通');
    const c = qColor || ORGAN_QUALITY_COLORS[q] || '#57606a';
    const n = name || safeStr(organ.名称, '未知器官');
    const lv = level || (safeNum(organ.强化等级) > 0 ? ` +${safeNum(organ.强化等级)}` : '');

    let html = '';
    if (!compact) {
      html += `<div style="font-weight:700;font-size:14px;color:${c};margin-bottom:4px;">${n}${lv}</div>`;
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
        <span class="f-type">${icon ? `<i class="${icon}" style="margin-right:3px;"></i> ` : ''}${metaLabel}</span>
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
    // 先重置定位并显示出来才能测真实尺寸
    $tooltip.css({ display: 'block', visibility: 'hidden', left: '0px', top: '0px', transform: 'none' });
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
        <span class="card-name" style="color:${iconColor};">${name}</span>
        ${extra || ''}
      </div>
      ${extraAfter || ''}
    </div>
  `;
  // 资源库：凹陷插槽（矩形）— 当前插槽美术风格，带凹陷立体感
  const buildSlotCardHtml = ({ subKey, organName, iconClass, iconColor, stateClass, unadaptedClass, tooltipHtml, draggable }) => `
    <div class="organ-card-base organ-slot-card-base sub-slot-card${stateClass}${unadaptedClass}"
         data-sub-key="${subKey}"
         data-tooltip-html="${tooltipHtml}"${draggable ? ' draggable="true"' : ''}>
      <div class="organ-slot-card-inner">
        <div class="card-icon" style="color: ${iconColor};">
          <i class="${iconClass}"></i>
        </div>
        <div class="card-name" style="color: ${iconColor};">${organName}</div>
      </div>
    </div>
  `;
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
  // findAvailableOrgansForSlot moved to OrganAttributes.js — accessed via OA namespace

  const equipOrganToSlot = async (slotName, organItem) => {
    const data = fetchLatestMvuData();
    const patches = [];
    const baseSlot = String(slotName || '').split('_')[0];

    // 标准化 organItem：兼容不同调用方传入的数据结构
    // findAvailableOrgansForSlot / findAllBackpackOrgans 返回 { data: rawOrgan, ... }
    // 某些场景可能直接传入 rawOrgan
    const organSrc = organItem && organItem.data ? organItem.data : organItem;
    const normItem = {
      name: safeStr(organItem.name || organSrc.名称),
      quality: safeStr(organItem.quality || organSrc.品质, '普通'),
      desc: safeStr(organItem.desc || organSrc.描述),
      level: safeNum(organItem.level != null ? organItem.level : organSrc.强化等级),
      source: organItem.source || 'organpack',
      key: organItem.key || '',
      data: organSrc,
    };

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
        名称: safeStr(normItem.name),
        品质: safeStr(normItem.quality),
        描述: safeStr(normItem.desc),
        强化等级: safeNum(normItem.level),
        属性加成: safeObj(normItem.data.属性加成),
        特性: safeArr(normItem.data.特性),
        标签: safeArr(normItem.data.标签),
        种族: safeStr(normItem.data.种族),
        已排异: safeBool(normItem.data.已排异)
      }
    });

    if (normItem.source === 'equip') {
      patches.push({
        op: 'replace',
        path: `/人物/装备列表/${normItem.key}/装备箱`,
        value: false
      });
    } else if (normItem.source === 'item') {
      const currentQty = safeNum(normItem.data.数量, 1);
      if (currentQty <= 1) {
        patches.push({
          op: 'remove',
          path: `/人物/背包/道具/${normItem.key}`
        });
      } else {
        patches.push({
          op: 'replace',
          path: `/人物/背包/道具/${normItem.key}/数量`,
          value: currentQty - 1
        });
      }
    } else if (normItem.source === 'organpack') {
      const currentQty = safeNum(normItem.data.数量, 1);
      const packPath = data?.人物?.器官系统?.器官背包 ? `/人物/器官系统/器官背包/${normItem.key}` : `/人物/背包/器官/${normItem.key}`;
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
      showToast('success', `移植成功：已将 [${normItem.name}] 替换 [${slotName}] 槽位`);
      await updateOrganUI();
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
      await updateOrganUI();
    }
  };

  const showOrganSelectPopup = (slotName) => {
    const data = fetchLatestMvuData();
    const parts = String(slotName || '').split('_');
    const baseSlot = parts[0] || slotName;

    const s = slotsDef.find(x => x.key === baseSlot);
    const count = s ? (s.count || 1) : 1;
    const organSystem = data?.人物?.器官系统 || {};
    const 器官列表 = organSystem.器官列表 || {};

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

      const stateClass = (isEmpty || isNative) ? ' is-empty' : ' has-organ';
      const unadaptedClass = (organ && safeBool(organ.已排异) !== true) ? ' is-unadapted' : '';

      let displayTitle = count > 1 ? `${baseSlot} #${i}` : `${baseSlot}`;
      let displayOrganName = (!organ) ? baseSlot : stripNativePrefix(isNative ? baseSlot : (safeStr(organ.名称) || baseSlot));
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
      const iconClass = (organ && !isEmpty) ? getOrganIconClass(organ.部位 || baseSlot, organ.名称) : getOrganIconClass(baseSlot, baseSlot);

      cardsHtml += buildSlotCardHtml({
        subKey,
        organName: displayOrganName,
        iconClass,
        iconColor: qColor,
        stateClass,
        unadaptedClass,
        tooltipHtml: escapedTooltip,
        draggable: isEquipped,
      });
    }
    cardsHtml += '</div>';

    let html = `
      <div id="${SCRIPT_ID}-popup" class="fusion-popup-overlay" style="display:flex;align-items:center;justify-content:center;position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;">
        <div class="fusion-card organ-theme-card" style="width:480px !important;max-width:480px !important;--quality-color:#8b6b4a;position:relative;">
          <button class="popup-close"><i class="ri-close-line"></i></button>

          ${renderOrganSharedTooltip()}

          ${buildOrganHeader({ metaLabel: '躯体器官管理', title: `${baseSlot} 部位` })}
          <div class="f-body" style="display: flex; flex-direction: column; gap: 12px;">

            <div class="current-organ-display">
              <div class="section-title" style="font-size: 11px; font-weight: 600; color: var(--ot-text-sub); margin-bottom: 6px;">槽位选择与状态 <span style="font-size: 9px; color: var(--ot-text-weak); font-weight: normal;">(鼠标悬停卡片查看详情)</span></div>
              ${cardsHtml}
            </div>

            <div style="border-top: 1px solid rgba(0,0,0,0.08); margin: 8px 0 0;"></div>
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
          stateClass: ' has-organ organ-candidate-card-grid' + candidateStateClass,
          dataAttrs: 'data-idx="' + idx + '" data-tooltip-html="' + escapedCandidateTooltip + '" draggable="true"',
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

    const popCard = $popup.find('.fusion-card')[0];
    const tooltip = popCard.querySelector('#organ-shared-tooltip');
    const placeTooltip = (card, content) => {
      tooltip.innerHTML = content;
      placeOrganTooltip($(tooltip), card, popCard, 8);
    };
    const hideTooltip = () => { tooltip.style.display = 'none'; };
    // 图标专属悬停 tooltip（匹配器官背包详情的图标悬停风格）
    let tooltipHideTimer = null;
    popCard.addEventListener('mouseover', e => {
      const icon = e.target.closest('.sub-slot-card .card-icon, .organ-candidate-card-grid .card-icon');
      if (!icon) return;
      if (tooltipHideTimer) { clearTimeout(tooltipHideTimer); tooltipHideTimer = null; }
      const card = icon.closest('.sub-slot-card, .organ-candidate-card-grid');
      if (!card || !card.dataset.tooltipHtml) return;
      placeTooltip(card, card.dataset.tooltipHtml);
    });
    popCard.addEventListener('mouseout', e => {
      const icon = e.target.closest('.sub-slot-card .card-icon, .organ-candidate-card-grid .card-icon');
      if (!icon) return;
      const to = e.relatedTarget;
      // 如果移到 tooltip 内，延迟隐藏
      if (to && (to.closest('#organ-shared-tooltip') || to.closest('.organ-shared-tooltip'))) {
        tooltipHideTimer = setTimeout(hideTooltip, 300);
        return;
      }
      // 如果移到同卡片的另一个元素内，不隐藏
      if (to && (icon.contains(to) || icon === to)) return;
      hideTooltip();
    });
    // 移到 tooltip 上时取消隐藏
    const tooltipEl = tooltip;
    if (tooltipEl) {
      tooltipEl.addEventListener('mouseenter', () => {
        if (tooltipHideTimer) { clearTimeout(tooltipHideTimer); tooltipHideTimer = null; }
      });
      tooltipEl.addEventListener('mouseleave', hideTooltip);
    }

    // 资源库：立体卡片 — 克隆源卡片并复制计算后样式，保证拖拽图像与原卡完全一致
    const createDragCardImage = (cardEl) => {
      const rect = cardEl.getBoundingClientRect();
      const clone = cardEl.cloneNode(true);
      const srcAll = [cardEl, ...cardEl.querySelectorAll('*')];
      const dstAll = [clone, ...clone.querySelectorAll('*')];
      const VISUAL = ['background','backgroundColor','borderRadius','color','display',
        'flexDirection','fontSize','fontWeight','gap','justifyContent','alignItems','lineHeight',
        'maxWidth','padding','textAlign','textOverflow','textShadow','whiteSpace','width','height',
        'margin','border','opacity','overflow'];
      for (let i = 0; i < Math.min(srcAll.length, dstAll.length); i++) {
        const cs = getComputedStyle(srcAll[i]);
        for (const p of VISUAL) dstAll[i].style[p] = cs[p];
        dstAll[i].style.overflow = 'visible';
      }
      // 定位到屏幕外，叠加 3D 立体阴影与旋转
      clone.style.position = 'absolute';
      clone.style.top = '-2000px';
      clone.style.left = '0px';
      clone.style.width = rect.width + 'px';
      clone.style.height = rect.height + 'px';
      clone.style.overflow = 'visible';
      clone.style.boxShadow = '0 7px 0 rgba(196,160,106,0.4), 0 4px 12px rgba(0,0,0,0.25)';
      clone.style.transform = 'rotate(2deg) scale(1.04)';
      clone.style.pointerEvents = 'none';
      clone.style.zIndex = '99999';
      clone.style.margin = '0';
      clone.style.border = 'none';
      document.body.appendChild(clone);
      return { el: clone, cx: rect.width / 2, cy: rect.height / 2 };
    };

    let dragUnequipBtn = null; // 3D 卸下按钮

    // 创建 3D 卸下按钮
    const showDragUnequipBtn = () => {
      if (dragUnequipBtn) return;
      dragUnequipBtn = document.createElement('div');
      dragUnequipBtn.className = 'drag-unequip-btn';
      dragUnequipBtn.innerHTML = '<i class="ri-close-line"></i>';
      dragUnequipBtn.style.cssText = `
        position:absolute;left:50%;bottom:-52px;transform:translateX(-50%);
        width:44px;height:44px;border-radius:50%;background:#d4c4a8;
        display:flex;align-items:center;justify-content:center;
        color:#a03333;font-size:22px;cursor:pointer;z-index:9999;pointer-events:auto;
        transition:transform 0.15s;
      `;
      dragUnequipBtn.dataset.role = 'unequip';
      $popup.find('.fusion-card')[0].appendChild(dragUnequipBtn);
    };
    const hideDragUnequipBtn = () => {
      if (dragUnequipBtn) { dragUnequipBtn.remove(); dragUnequipBtn = null; }
    };

    // Drag-and-drop: candidate→slot (equip) + slot→candidate/replace (replace/unequip)
    document.addEventListener('dragstart', function(e) {
      const cand = e.target.closest('.organ-candidate-card-grid');
      const slot = e.target.closest('.sub-slot-card.has-organ');
      if (!cand && !slot) return;
      if (cand) {
        e.dataTransfer.setData('text/plain', cand.dataset.idx);
        cand.classList.add('dragging');
      }
      if (slot) {
        e.dataTransfer.setData('text/plain', 'slot:' + slot.dataset.subKey);
        slot.classList.add('dragging');
        showDragUnequipBtn();
      }
      e.dataTransfer.effectAllowed = 'move';
      const source = cand || slot;
      const img = createDragCardImage(source);
      e.dataTransfer.setDragImage(img.el, img.cx, img.cy);
      setTimeout(() => document.body.removeChild(img.el), 0);
    });
    document.addEventListener('dragend', function(e) {
      const card = e.target.closest('.organ-candidate-card-grid, .sub-slot-card');
      if (!card) return;
      card.classList.remove('dragging');
      hideDragUnequipBtn();
      $popup.find('.sub-slot-card, .organ-candidate-card-grid').css('box-shadow', '');
    });
    $popup[0].addEventListener('dragover', function(e) {
      const slot = e.target.closest('.sub-slot-card');
      const cand = e.target.closest('.organ-candidate-card-grid');
      const btn = e.target.closest('.drag-unequip-btn');
      if (slot) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        slot.style.boxShadow = '0 0 0 2px #8b6b4a, 0 0 8px rgba(139,107,74,0.5)';
      } else if (cand) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        cand.style.boxShadow = '0 0 0 2px #8b6b4a, 0 0 8px rgba(139,107,74,0.5)';
      } else if (btn) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        btn.style.transform = 'translateX(-50%) translateY(-3px) scale(1.1)';
      }
    });
    $popup[0].addEventListener('dragleave', function(e) {
      const el = e.target.closest('.sub-slot-card, .organ-candidate-card-grid, .drag-unequip-btn');
      if (!el) return;
      el.style.boxShadow = '';
      if (el.classList.contains('drag-unequip-btn') || el.dataset.role === 'unequip') {
        el.style.transform = 'translateX(-50%)';
      }
    });
    $popup[0].addEventListener('drop', async function(e) {
      const slot = e.target.closest('.sub-slot-card');
      const cand = e.target.closest('.organ-candidate-card-grid');
      const btn = e.target.closest('.drag-unequip-btn');
      if (!slot && !cand && !btn) return;
      e.preventDefault();
      if (slot) slot.style.boxShadow = '';
      if (cand) cand.style.boxShadow = '';
      const data = e.dataTransfer.getData('text/plain');
      if (!data) return;
      if (btn && data.startsWith('slot:')) {
        // Dropped on unequip button
        const subKey = data.slice(5);
        hideDragUnequipBtn();
        await unequipOrganFromSlot(subKey);
      } else if (data.startsWith('slot:') && cand) {
        // Slot card → candidate card: replace
        const subKey = data.slice(5);
        const idx = parseInt(cand.dataset.idx);
        const targetOrgan = available[idx];
        if (targetOrgan) await equipOrganToSlot(subKey, targetOrgan);
      } else if (!data.startsWith('slot:') && slot) {
        // Candidate → slot: equip
        const idx = parseInt(data);
        const targetOrgan = available[idx];
        const subKey = slot.dataset.subKey;
        if (targetOrgan && subKey) await equipOrganToSlot(subKey, targetOrgan);
      } else { return; }
      hideDragUnequipBtn();
      showOrganSelectPopup(baseSlot);
    });
  };


  // findAllBackpackOrgans moved to OrganAttributes.js — accessed via OA namespace

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
        innerStyle: 'border:1px solid rgba(207,34,46,0.35) !important;min-height:56px;height:auto !important;',
      });
    });

    const html = `
      <div id="${SCRIPT_ID}-popup" class="fusion-popup-overlay" style="display:flex;align-items:center;justify-content:center;position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;overflow:hidden;">
        <div class="fusion-card organ-theme-card" style="width: 360px; --quality-color: #8e44ad; position: relative; max-height: 85vh;">
          <button class="popup-close"><i class="ri-close-line"></i></button>
          ${renderOrganSharedTooltip()}
          ${buildOrganHeader({
            icon: 'ri-flask-fill',
            metaLabel: '排异药剂',
            title: '选择需要排异的器官',
            badges: `<span style="font-size: 10px; padding: 1px 6px; border-radius: 3px; background: rgba(142,68,173,0.1); color: #8e44ad; font-weight: 600;">×${药数量}</span>`,
            borderColor: 'rgba(142,68,173,0.25)'
          })}
          <div class="f-body" style="display: flex; flex-direction: column; gap: 8px; overflow-y: auto; max-height: calc(85vh - 100px);">
           
            <div style="display:flex;gap:6px;align-items:center;">
              <button id="rejection-toggle-all" style="flex:1;padding:5px 0;border:1px solid rgba(142,68,173,0.3);border-radius:6px;background:rgba(142,68,173,0.06);color:#8e44ad;font-size:11px;font-weight:600;cursor:pointer;">全选</button>
              <button id="rejection-confirm-batch" style="flex:1.2;padding:5px 0;border:1.5px solid #8e44ad;border-radius:6px;background:rgba(142,68,173,0.1);color:#8e44ad;font-size:11px;font-weight:700;cursor:pointer;">批量排异 (<span id="rejection-selected-count">0</span>)</button>
            </div>
            <div class="rejection-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:4px;max-height:380px;overflow-y:auto !important;padding:2px 2px 16px;scrollbar-width:none;">
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

    // Selection state for multi-select
    const rejectionSelected = new Set();
    let rejectionModeActive = false;
    let $floatConfirmBtn = null;

    // Update selected count display
    const updateRejectionCount = () => {
      $popup.find('#rejection-selected-count').text(rejectionSelected.size);
      const $btn = $popup.find('#rejection-confirm-batch');
      if (rejectionModeActive) {
        $btn.text('退出选择');
      } else {
        $btn.html('批量排异 (<span id="rejection-selected-count">' + rejectionSelected.size + '</span>)');
      }
      if (rejectionSelected.size > 0) {
        $btn.css({ opacity: '1', cursor: 'pointer' });
      } else {
        $btn.css({ opacity: '0.5', cursor: 'default' });
      }
      // 更新确认按钮计数
      if ($floatConfirmBtn && $floatConfirmBtn.length) {
        $floatConfirmBtn.text('确认排异 (' + rejectionSelected.size + ')');
      }
    };

    // 单击卡片：未在多选模式时直接弹单卡排异确认；多选模式下加入/移除选择
    $popup.on('click', '.rejection-organ-card', function(e) {
      e.stopPropagation();
      const slotKey = $(this).data('slot');
      const source = $(this).data('source') || 'slot';
      if (!slotKey) return;
      const compositeKey = slotKey + '_' + source;

      if (!rejectionModeActive) {
        // 单卡模式：直接弹确认框
        const item = organMap.get(compositeKey);
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
              <div class="os-stroke" style="font-size:14px;font-weight:700;color:${qColor};-webkit-text-fill-color:${qColor};margin-bottom:4px;">${organName}</div>
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

        const bindClose = (sel) => {
          $overlay.find(sel).on('mouseenter', function() {
            if (sel === '#rejection-confirm-no') {
              $(this).css({ background: 'var(--ot-bg-soft)', borderColor: 'var(--ot-text-weak)' });
            } else {
              $(this).css({ background: '#8e44ad', color: '#fff' });
            }
          }).on('mouseleave', function() {
            if (sel === '#rejection-confirm-no') {
              $(this).css({ background: 'var(--ot-bg)', borderColor: 'var(--ot-border)' });
            } else {
              $(this).css({ background: 'rgba(142,68,173,0.08)', color: '#8e44ad' });
            }
          }).on('click', async function(e) {
            e.stopPropagation();
            if (sel === '#rejection-confirm-no') {
              $overlay.remove();
              return;
            }
            // 是
            $overlay.remove();
            let organPath;
            if (source === 'slot') organPath = `/人物/器官系统/器官列表/${slotKey}/已排异`;
            else if (source === 'organpack') organPath = `/人物/器官系统/器官背包/${slotKey}/已排异`;
            else if (source === 'item') organPath = `/人物/背包/道具/${slotKey}/已排异`;
            else if (source === 'equip') organPath = `/人物/装备列表/${slotKey}/已排异`;
            else { showToast('error', '未知器官来源'); return; }
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
        };
        bindClose('#rejection-confirm-no');
        bindClose('#rejection-confirm-yes');
        return;
      }

      // 多选模式：加入/移除选择
      if (rejectionSelected.has(compositeKey)) {
        rejectionSelected.delete(compositeKey);
        $(this).removeClass('is-selected');
      } else {
        rejectionSelected.add(compositeKey);
        $(this).addClass('is-selected');
      }
      updateRejectionCount();
    });

    // Toggle all (select/deselect)
    $popup.find('#rejection-toggle-all').on('click', function() {
      const $cards = $popup.find('.rejection-organ-card');
      const allSelected = $cards.length === $cards.filter('.is-selected').length;
      if (allSelected) {
        // Deselect all
        rejectionSelected.clear();
        $cards.removeClass('is-selected');
        $(this).text('全选');
      } else {
        // Select all
        $cards.each(function() {
          const slotKey = $(this).data('slot');
          const source = $(this).data('source') || 'slot';
          if (!slotKey) return;
          rejectionSelected.add(slotKey + '_' + source);
          $(this).addClass('is-selected');
        });
        $(this).text('取消全选');
      }
      updateRejectionCount();
    });

    // Batch reject button: click to enter select mode, click again to execute
    const $rejectionBtn = $popup.find('#rejection-confirm-batch');
    const $modeHint = $popup.find('#rejection-mode-hint');
    const enterRejectionMode = () => {
      rejectionModeActive = true;
      $rejectionBtn.text('退出选择');
      $rejectionBtn.css({ background: 'rgba(142,68,173,0.06)', borderColor: 'rgba(142,68,173,0.3)', color: '#8e44ad' });
      $modeHint.html('<span style="color:#8e44ad;">选择模式 — 点击卡片选择，点击"确认排异"执行，或点"退出选择"取消</span>');
      // 创建确认排异按钮（替换原按钮位置）
      $floatConfirmBtn = $(`<button id="rejection-float-confirm" style="flex:1.2;padding:5px 0;border:1.5px solid #8e44ad;border-radius:6px;background:#8e44ad;color:#fff;font-size:11px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(142,68,173,0.4);">确认排异 (${rejectionSelected.size})</button>`);
      $rejectionBtn.after($floatConfirmBtn);
      $rejectionBtn.css('flex', '1');
      $floatConfirmBtn.on('click', async function() {
        await executeRejection();
      });
    };
    const exitRejectionMode = () => {
      rejectionModeActive = false;
      if ($floatConfirmBtn) { $floatConfirmBtn.remove(); $floatConfirmBtn = null; }
      // 清除所有卡片的选中高亮
      $popup.find('.rejection-organ-card.is-selected').removeClass('is-selected');
      $rejectionBtn.html('批量排异 (<span id="rejection-selected-count">' + rejectionSelected.size + '</span>)');
      $rejectionBtn.css({ background: 'rgba(142,68,173,0.1)', borderColor: '#8e44ad', color: '#8e44ad' });
      $modeHint.html('<span>点击卡片单卡排异，或点击批量排异进入多选</span>');
    };
    // 原按钮：无选择模式时点击进入多选模式，选择模式时点击退出
    $rejectionBtn.on('click', function() {
      if (rejectionModeActive) {
        exitRejectionMode();
      } else {
        // 直接进入多选模式，不要求预先选择
        enterRejectionMode();
      }
    });
    const executeRejection = async () => {
      if (rejectionSelected.size === 0) {
        showToast('info', '请先点击卡片选择需要排异的器官');
        return;
      }
      const items = [];
      let totalCost = 0;
      for (const compositeKey of rejectionSelected) {
        const item = organMap.get(compositeKey);
        if (!item) continue;
        const cost = (typeof REJECTION_MEDICINE_COST !== 'undefined' && REJECTION_MEDICINE_COST[safeStr(item.organ.品质, '普通')]) || 1;
        items.push({ item, compositeKey, cost });
        totalCost += cost;
      }
      if (totalCost > 药数量) {
        showToast('warn', `排异药剂不足，需要 ${totalCost} 瓶，当前 ${药数量} 瓶`);
        return;
      }
      // Build confirm overlay
      const confirmHtml = `
        <div id="rejection-confirm-overlay" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;z-index:10000;filter:none !important;">
          <div style="background:var(--tt-bg-soft);border-radius:12px;padding:20px 24px;box-shadow:0 8px 32px rgba(0,0,0,0.2);max-width:300px;width:90%;text-align:center;color:var(--tt-bg-soft-text);filter:none !important;">
            <i class="ri-flask-fill" style="font-size:28px;color:#8e44ad;display:block;margin-bottom:8px;"></i>
            <div style="font-size:14px;font-weight:700;color:#8e44ad;margin-bottom:4px;">批量排异确认</div>
            <div style="font-size:11px;color:var(--ot-text-sub);margin-bottom:4px;">已选择 ${items.length} 个器官</div>
            <div style="font-size:11px;color:var(--ot-text-weak);margin-bottom:16px;">是否消耗 ${totalCost} 瓶排异药剂进行批量排异？</div>
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
        const patches = [];
        for (const { item, compositeKey, cost: _cost } of items) {
          const source = item.source;
          const slotKey = item.key;
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
            continue;
          }
          patches.push({ op: 'replace', path: organPath, value: true });
        }
        patches.push({ op: 'replace', path: `/人物/器官系统/排异药剂数量`, value: 药数量 - totalCost });
        const success = await applyMvuPatches(patches);
        if (success) {
          showToast('success', `已对 ${items.length} 个器官完成排异`);
          exitRejectionMode();
          $popup.remove();
          await updateOrganUI();
        } else {
          showToast('error', '保存数据失败');
        }
      });
  };
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
      // 属性品质色：优先用标签文件定义的品质色，未知属性按正负回退
      const qColor = getAttrQualityColor(k) || (displayVal > 0 ? '#2ea87a' : (displayVal < 0 ? '#cf222e' : '#333'));
      // 数值颜色不受属性品质影响，未排异时用红色表示不完整
      const numColor = isUnadaptedDetail ? '#cf222e' : '#333';
      return `<span class="organ-attr-chip" data-attr-key="${k}" data-attr-raw="${v}" style="display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:500;color:${qColor};background:rgba(139,107,74,0.06);cursor:help;border:1px solid ${qColor}40;">${k} <span style="color:${numColor};font-weight:600;">${displayVal>0?'+':''}${formatAttrVal(displayVal)}</span></span>`;
    }).join('');
  const statsHtml = tagsHtml
    ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;" class="organ-attr-stats-row">${tagsHtml}</div>`
    : '<div style="font-size:10px;color:var(--tt-bg-soft-text-sub);font-style:italic;margin-top:6px;">无属性加成</div>';
  const itemQColor = getOrganAttrQualityColor(organData) || ORGAN_QUALITY_COLORS[safeStr(organItem.quality, '普通')] || '#57606a';
  const slotCard = ({ key, count, icon }) => {
    let best = { key: subKey(key, count, 1), name: '空', lv: -1 };
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
      const subQColor = hasOrg ? (ORGAN_QUALITY_COLORS[safeStr(o.品质, '普通')] || '#57606a') : 'var(--ot-text-weak)';
      const subBorder = isUnad ? '1px solid rgba(207,34,46,0.35)' : '1px solid rgba(139,107,74,0.2)';
      return `<div class="sub-menu-item" data-target-slot="${k}" style="display:flex;align-items:center;gap:8px;padding:5px 8px;font-size:11.5px;cursor:pointer;border-radius:5px;transition:background 0.12s;color:${subQColor};border:${subBorder};"><i class="${icon}" style="font-size:13px;color:${subQColor};flex-shrink:0;"></i><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${organName(k)}</span></div>`;
    }).join('');
    const iconColor = isEmpty ? 'var(--ot-text-weak)' : bestQColor;
    const subName = isEmpty ? key : best.name;
    return `<div class="organ-card-base organ-slot-card-base target-slot-btn${stateClass}${innerUnadaptedClass}" data-target-slot="${best.key}" data-slot-key="${key}" data-slot-count="${count}" style="z-index:1;min-height:56px;overflow:visible;"><div class="organ-slot-card-inner${innerUnadaptedClass}"><i class="${icon} card-icon" style="color:${iconColor};"></i><span style="font-size:10px;color:${bestQColor};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:74px;line-height:1.2;margin-top:2px;">${subName}</span></div><div class="slot-sub-menu" data-slot-key="${key}" style="display:none;position:absolute;min-width:120px;background:var(--tt-bg-soft,#f2e6ce);border:1px solid rgba(139,107,74,0.25);border-radius:8px;padding:4px;box-shadow:0 6px 20px rgba(0,0,0,0.18);z-index:99999;pointer-events:auto;">${subItemsHtml}</div></div>`;
  };

  // ---
  const html = `<div id="${SCRIPT_ID}-popup" class="fusion-popup-overlay" style="display:flex;align-items:center;justify-content:center;position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999;"><div class="fusion-card organ-theme-card" style="width:480px !important;max-width:480px !important;position:relative;"><button class="popup-close"><i class="ri-close-line"></i></button><div class="f-body" style="display:flex;flex-direction:column;gap:8px;"><div class="organ-info" style="background:var(--ot-bg-soft);border:1px solid var(--ot-border);border-radius:8px;padding:8px 10px;"><div style="font-size:10px;color:var(--ot-text-sub);margin-bottom:4px;">器官背包详情</div><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="font-size:15px;font-weight:700;color:${itemQColor};">${safeStr(organItem.name)}</span><span style="font-size:10px;padding:2px 7px;border-radius:3px;background:${itemQColor}22;color:${itemQColor};font-weight:600;">${safeStr(organItem.quality)}</span></div><div style="font-size:10.5px;color:var(--ot-text-sub);line-height:1.5;">${safeStr(organItem.desc) || '无描述'}</div>${statsHtml}</div><div style="font-size:11px;font-weight:600;color:#4a3c31;margin-top:2px;display:flex;align-items:center;gap:4px;"><i class="ri-grid-line"></i> 选择装配部位</div><div class="target-slots-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;">${slotsDef.map(slotCard).join('')}</div><div style="font-size:9.5px;color:var(--ot-text-weak);margin-top:4px;text-align:center;">点击直接装配 · 悬停查看多槽位</div></div></div><div id="${SCRIPT_ID}-attr-tooltip" class="organ-tooltip-container" style="display:none;width:240px;max-width:280px;pointer-events:auto;word-break:normal;"></div></div>`;

  const $panel = ($targetPanel && $targetPanel.length) ? $targetPanel : $('#' + SCRIPT_ID + '-panel');
  // Remove any existing popup in the target panel
  $panel.find('#' + SCRIPT_ID + '-popup').remove();
  $panel.append(html);
  const $popup = $panel.find('#' + SCRIPT_ID + '-popup');
  const popCard = $popup[0];
  if (!popCard) return;

  // ---
  // 基础样式（与排异弹窗共享）由 ensureOrganPopupBaseStyle() 注入；
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
      try { showOrganItemDetailPopup(organItem); } catch(e) { console.error('[Organ] sub-menu reload popup failed:', e); }
    } else {
      // 直接点 target-slot-btn（单槽位）：装备后退出弹窗
      await equipOrganToSlot(slot, organItem);
      $popup.remove();
    }
  });

  // ---
  // 属性悬停 tooltip（使用与 [属性] 界面一致的效果描述）
  const attrTooltip = popCard.querySelector('#' + SCRIPT_ID + '-attr-tooltip');
  let attrTooltipHideTimer = null;
  const $attrTooltip = $(attrTooltip);
  const placeAttrTooltip = (chipEl, content) => {
    if (!attrTooltip) return;
    // 抽取 .compact-detail 内部的内容直接放在 tooltip 容器中，
    // 避免 .compact-detail 的全局 CSS（opacity:0;visibility:hidden;背景/边框/内边距）干扰
    const wrapper = document.createElement('div');
    wrapper.innerHTML = content;
    const inner = wrapper.querySelector('.compact-detail');
    if (inner) {
      attrTooltip.innerHTML = inner.innerHTML;
    } else {
      attrTooltip.innerHTML = content;
    }
    placeOrganTooltip($attrTooltip, chipEl, popCard, 6);
  };
  const hideAttrTooltip = () => { if (attrTooltip) attrTooltip.style.display = 'none'; };
  popCard.addEventListener('mouseover', e => {
    const chip = e.target.closest('.organ-attr-chip');
    if (!chip || !attrTooltip) return;
    if (attrTooltipHideTimer) { clearTimeout(attrTooltipHideTimer); attrTooltipHideTimer = null; }
    const attrKey = chip.dataset.attrKey;
    const rawVal = parseFloat(chip.dataset.attrRaw);
    if (!attrKey || isNaN(rawVal)) return;
      // 从器官名称推测部位，用于器官特定效果描述（如超频爆发）
      var organSlot = (typeof guessSlotFromOrganName === 'function') ? guessSlotFromOrganName(organData.名称 || '') : '';
      // 种族独有器官：部位不在标准槽位列表中
      var standardSlots = ['眼球','心脏','肺脏','胃','肠子','阑尾','肌肉','肝脏','脾脏','肾脏','肋骨','脊柱','脑','胆','膀胱','胰腺','生殖'];
      var isRaceExclusive = organSlot && standardSlots.indexOf(organSlot) === -1;
      let tooltipContent = getAttrBonusEffectHtml(attrKey, rawVal, undefined, { organSlot: organSlot, isRaceExclusive: isRaceExclusive });
    if (isUnadaptedDetail) {
      tooltipContent += '<div style="font-size:9px;color:#f2994a;margin-top:3px;border-top:1px solid rgba(242,153,74,0.25);padding-top:2px;">⚠ 该器官尚未排异，属性加成暂时减半</div>';
    }
    placeAttrTooltip(chip, tooltipContent);
  });
  popCard.addEventListener('mouseout', e => {
    const chip = e.target.closest('.organ-attr-chip');
    if (!chip || !attrTooltip) return;
    const to = e.relatedTarget;
    if (to && (to.closest('#' + SCRIPT_ID + '-attr-tooltip'))) {
      attrTooltipHideTimer = setTimeout(hideAttrTooltip, 250);
      return;
    }
    if (to && (chip.contains(to) || chip === to)) return;
    hideAttrTooltip();
  });
  if (attrTooltip) {
    attrTooltip.addEventListener('mouseenter', () => {
      if (attrTooltipHideTimer) { clearTimeout(attrTooltipHideTimer); attrTooltipHideTimer = null; }
    });
    attrTooltip.addEventListener('mouseleave', hideAttrTooltip);
  }

  // ---
  bindOrganPopupClose($popup);
};
  // 12 个标准槽位（位置坐标 + 数量）— 视觉布局元数据
  // SLOTS_LAYOUT, slotsDef moved to OrganAttributes.js — accessed via OA namespace

  const updateOrganUI = async () => {
    if (!$) {
      console.warn('[RPG StatusBar] jQuery not available in updateOrganUI');
      return;
    }
    // 回填空槽位的默认器官（旧存档中init只写了装备列表未写slot）
    // 同步等待：确保 fetchLatestMvuData 返回最新数据
    try { await autoInitializeMissingOrgans(fetchLatestMvuData()); } catch (e) {}
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
        if (!organ || organ.空) return; // 无器官或已卸下 → 贡献0

        // 已装备的器官
        const activeOrgan = getNormalizedOrgan(normalizeStoredOrgan(organ, slot.baseKey), race);
        if (activeOrgan && !activeOrgan.空 && activeOrgan.属性加成 && activeOrgan.属性加成[key] !== undefined) {
          let val = Number(activeOrgan.属性加成[key]);
          // 未排异的器官属性减半
          if (activeOrgan.已排异 !== true) {
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

          // 绑定悬停 tooltip（带延迟隐藏，避免鼠标移到槽位时立即关闭）
          let backpackTipHideTimer = null;
          const $bpTooltip = $panel.find('#organ-backpack-tooltip');
          const cancelBpTipHide = () => { if (backpackTipHideTimer) { clearTimeout(backpackTipHideTimer); backpackTipHideTimer = null; } };
          $backpackGrid.off('mouseenter', '.organ-backpack-item .card-icon').on('mouseenter', '.organ-backpack-item .card-icon', function() {
            cancelBpTipHide();
            const $item = $(this).closest('.organ-backpack-item');
            const idx = $item.data('bp-idx');
            const tipContent = tooltipMap[`bp_${idx}`];
            if (!tipContent) return;
            if (!$bpTooltip.length) return;
            // 将 tooltip 锚定到图标本身（card-icon），这样鼠标在图标上时 tooltip 不会被立即关闭
            const $icon = $(this);
            $bpTooltip.html(tipContent);
            placeOrganTooltip($bpTooltip, $icon[0] || $item[0], $backpackGrid[0], 8);
          }).off('mouseleave', '.organ-backpack-item .card-icon').on('mouseleave', '.organ-backpack-item .card-icon', function() {
            // 延迟关闭，给玩家移到槽位/其他区域的时间
            cancelBpTipHide();
            backpackTipHideTimer = setTimeout(() => { $bpTooltip.hide(); }, 200);
          });
          // 鼠标移到 tooltip 上时取消隐藏
          $bpTooltip.off('mouseenter').on('mouseenter', cancelBpTipHide);
          $bpTooltip.off('mouseleave').on('mouseleave', () => {
            cancelBpTipHide();
            backpackTipHideTimer = setTimeout(() => { $bpTooltip.hide(); }, 200);
          });

          // 绑定点击（支持多选模式）
          $backpackGrid.find('.organ-backpack-item').on('click', function() {
            const idx = $(this).data('bp-idx');
            const item = allBackpackOrgans[idx];
            if (!item) return;
            if ($panel[0]._backpackSelectMode) {
              $(this).toggleClass('is-selected');
              const count = $backpackGrid.find('.organ-backpack-item.is-selected').length;
              const $dc = $panel.find('#organ-backpack-delete-count');
              if ($dc.length) $dc.text(count);
            } else {
              showOrganItemDetailPopup(item, $panel);
            }
          });

          // 多选模式按钮状态
          const $selectBtn = $panel.find('#organ-backpack-select-mode');
          if (allBackpackOrgans.length > 0) {
            $selectBtn.show();
          } else {
            $selectBtn.hide();
          }
          $selectBtn.off('click').on('click', function() {
            $panel[0]._backpackSelectMode = !$panel[0]._backpackSelectMode;
            const active = $panel[0]._backpackSelectMode;
            $(this).toggleClass('is-active', active);
            if (!active) {
              // 退出多选：清除所有选中状态和删除按钮
              $backpackGrid.find('.organ-backpack-item').removeClass('is-selected');
              $panel.find('#organ-backpack-delete-bar').remove();
            } else {
              // 进入多选：添加底部操作栏
              if (!$panel.find('#organ-backpack-delete-bar').length) {
                const $header = $panel.find('.organ-panel-section-header.section-red');
                $header.after(`
                  <div id="organ-backpack-delete-bar" style="display:flex;gap:6px;padding:4px 6px;align-items:center;">
                    <button id="organ-backpack-select-all" style="flex:1;padding:4px 0;border:1px solid var(--ot-border);border-radius:5px;background:var(--ot-bg);color:var(--ot-text-sub);font-size:10px;font-weight:600;cursor:pointer;">全选</button>
                    <button id="organ-backpack-deselect-all" style="flex:1;padding:4px 0;border:1px solid var(--ot-border);border-radius:5px;background:var(--ot-bg);color:var(--ot-text-sub);font-size:10px;font-weight:600;cursor:pointer;">取消</button>
                    <button id="organ-backpack-delete-selected" style="flex:1.5;padding:4px 0;border:1.5px solid #cf222e;border-radius:5px;background:rgba(207,34,46,0.08);color:#cf222e;font-size:10px;font-weight:700;cursor:pointer;">删除选中 (<span id="organ-backpack-delete-count">0</span>)</button>
                  </div>
                `);
                // 全选
                $panel.find('#organ-backpack-select-all').on('click', function() {
                  $backpackGrid.find('.organ-backpack-item').addClass('is-selected');
                  const count = $backpackGrid.find('.organ-backpack-item.is-selected').length;
                  $panel.find('#organ-backpack-delete-count').text(count);
                });
                // 取消
                $panel.find('#organ-backpack-deselect-all').on('click', function() {
                  $backpackGrid.find('.organ-backpack-item').removeClass('is-selected');
                  $panel.find('#organ-backpack-delete-count').text('0');
                });
                // 删除选中
                $panel.find('#organ-backpack-delete-selected').on('click', async function() {
                  const $selected = $backpackGrid.find('.organ-backpack-item.is-selected');
                  if (!$selected.length) { showToast('warn', '未选中任何器官'); return; }
                  const toDelete = [];
                  $selected.each(function() {
                    const idx = $(this).data('bp-idx');
                    const item = allBackpackOrgans[idx];
                    if (item) toDelete.push(item);
                  });
                  if (!toDelete.length) return;
                  // 确认
                  if (!confirm(`确定要删除 ${toDelete.length} 个器官吗？此操作不可撤销。`)) return;
                  const patches = [];
                  for (const item of toDelete) {
                    const key = item.key;
                    const source = item.source;
                    if (source === 'organpack') {
                      patches.push({ op: 'remove', path: `/人物/器官系统/器官背包/${key}` });
                    } else if (source === 'item') {
                      patches.push({ op: 'remove', path: `/人物/背包/道具/${key}` });
                    } else if (source === 'equip') {
                      patches.push({ op: 'remove', path: `/人物/装备列表/${key}` });
                    }
                  }
                  const success = await applyMvuPatches(patches);
                  if (success) {
                    showToast('success', `已删除 ${toDelete.length} 个器官`);
                    $panel[0]._backpackSelectMode = false;
                    $selectBtn.removeClass('is-active');
                    await updateOrganUI();
                  } else {
                    showToast('error', '保存数据失败');
                  }
                });
              }
            }
          });
          // 更新选中计数（通过单一点击 handler 已处理）
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
          const races = ['人类', '天降者', '亡灵', '机械', '精灵', '兽人', '龙族'];
          const slots = ORGAN_STANDARD_SLOTS;
          // 从 ATTR_EFFECT_RULES 获取所有合法属性名作为特性池
          const validAttrKeys = Object.keys(ATTR_EFFECT_RULES);
          // 生理属性（这些通过 ORGAN_PHYSIOLOGY_MAP 生成）
          const physKeys = ['健康度','视觉','坚韧','神经传递效率','血液过滤效率','解毒效率',
            '新陈代谢效率','肺活量','耐力','消化效率','营养获取效率','速度','筋力','幸运'];
          const nonPhysKeys = validAttrKeys.filter(k => physKeys.indexOf(k) === -1);

          const randomRace = races[Math.floor(Math.random() * races.length)];
          const randomSlot = slots[Math.floor(Math.random() * slots.length)];

          const organName = (RACE_ORGAN_NAMES[randomRace] && RACE_ORGAN_NAMES[randomRace][randomSlot])
            ? RACE_ORGAN_NAMES[randomRace][randomSlot]
            : randomRace + randomSlot;

          // === 属性生成：严格遵循标签文件规则 ===
          // 根据器官种类生成符合逻辑的生理属性（来自 ORGAN_PHYSIOLOGY_MAP）
          const physAttrPool = ORGAN_PHYSIOLOGY_MAP[randomSlot] || ['健康度'];
          // 决定属性词条数量：[标签-生理.md] 80%概率1~3条，18%概率4条，2%概率5条（5条时总值8）
          const attrCountRoll = Math.random();
          const attrCount = attrCountRoll < 0.8 ? (1 + Math.floor(Math.random() * 3))
            : attrCountRoll < 0.98 ? 4 : 5;

          // 随机抽取属性条目（仅从 ORGAN_PHYSIOLOGY_MAP 中已存在的生理属性选取）
          const selectedAttrs = [];
          const poolCopy = physAttrPool.slice();
          for (let i = 0; i < Math.min(attrCount, poolCopy.length); i++) {
            const idx = Math.floor(Math.random() * poolCopy.length);
            selectedAttrs.push(poolCopy.splice(idx, 1)[0]);
          }

          // 80%概率附加1条非生理属性（从 ATTR_EFFECT_RULES 中存在的非生理属性选取）
          if (nonPhysKeys.length > 0 && Math.random() > 0.2) {
            const extraAttr = nonPhysKeys[Math.floor(Math.random() * nonPhysKeys.length)];
            if (selectedAttrs.indexOf(extraAttr) === -1) selectedAttrs.push(extraAttr);
          }

          // === 属性值分配 ===
          // 根据标签文件，示例的+1、+0.5、-1、+5等是能拿到的最低数
          // 实际数值在最低数基础上+1/-1波动（正数器官），负数器官在-1基础上-1/0
          // 这里硬编码各属性的最低值（来自标签文件示例）
          const attrMinValues = {
            '健康度': 1, '视觉': 1, '坚韧': 0.5, '神经传递效率': 1,
            '血液过滤效率': 1, '解毒效率': 1, '新陈代谢效率': 1,
            '肺活量': 1, '耐力': 1, '消化效率': 1, '营养获取效率': 1,
            '速度': 1, '筋力': 1, '幸运': 1,
            '过载保护': 1, '超频爆发': 1,
            '储能': 0
          };
          // 赌徒类属性的最低值（从标签文件示例推断，多数为+1）
          nonPhysKeys.forEach(k => {
            if (!(k in attrMinValues)) attrMinValues[k] = 1;
          });

          const subAttrs = {};
          selectedAttrs.forEach(attr => {
            const minVal = attrMinValues[attr] || 1;
            // 50%概率正向波动（+1），50%保持最低值
            // 负数器官时最低为-1，波动-1/0
            let val;
            if (minVal === 0) {
              val = 0; // 储能等资源类从0开始
            } else if (Math.random() < 0.5) {
              val = minVal + 1;
            } else {
              val = minVal;
            }
            subAttrs[attr] = val;
          });

          // 资源类属性从 RESOURCE_ATTRS 范围随机抽值
          Object.keys(subAttrs).forEach(k => {
            if (isResourceAttr(k)) {
              const r = RESOURCE_ATTRS[k];
              subAttrs[k] = r.initialMin + Math.floor(Math.random() * (r.initialMax - r.initialMin + 1));
            }
          });

          // 根据属性加成中的最高品质决定器官品质
          let bestQuality = '普通';
          let bestRank = -1;
          Object.keys(subAttrs).forEach(k => {
            const q = ATTR_QUALITY_MAP[k];
            if (q) {
              const r = QUALITY_RANK.indexOf(q);
              if (r > bestRank) { bestRank = r; bestQuality = q; }
            }
          });
          const organQuality = bestQuality;

          const win = typeof getCore === 'function' ? getCore().window : window;
          const mvuData = win.Mvu.getMvuData({ type: 'message', message_id: 'latest' });
          if (!mvuData || !mvuData.stat_data) {
            alert('获取存档数据失败');
            return;
          }
          
          const sys = mvuData.stat_data.人物 = mvuData.stat_data.人物 || {};
          sys.器官系统 = sys.器官系统 || {};
          sys.器官系统.器官背包 = sys.器官系统.器官背包 || {};
          
          let uniqueName = organName;
          let counter = 1;
          while (sys.器官系统.器官背包[uniqueName]) {
            uniqueName = organName + ' +' + counter;
            counter++;
          }

          sys.器官系统.器官背包[uniqueName] = {
            名称: uniqueName,
            品质: organQuality,
            描述: '来自随机种族 ' + randomRace + ' 的 ' + randomSlot + ' 测试器官。',
            部位: randomSlot,
            类型: '器官',
            空: false,
            强化等级: 0,
            属性加成: subAttrs,
            // 排异成功率由品质决定（来自 REJECTION_SUCCESS_RATES）
            已排异: Math.random() < (REJECTION_SUCCESS_RATES[organQuality] || 0.5)
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
          await updateOrganUI();

          // Show prompt（显示属性名+数值，避免误解）
          var attrDetails = Object.keys(subAttrs).map(function(k) {
            return k + (subAttrs[k] > 0 ? '+' : '') + subAttrs[k];
          }).join(', ');
          alert('成功获得：[' + organQuality + '] ' + uniqueName + '\n属性加成: ' + attrDetails + '\n排异药剂 +10（用于测试）');
        } catch (err) {
          console.error(err);
          alert('随机生成器官失败：' + err.message);
        }
      });// 动态文件上传背景监听（兼容 input id: organ-bg-upload / organ-bg-upload-input）
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
	// ===== COLLECT phase: gather all cards into tag groups =====
	const baseAttrKeys = new Set(attrsDef.map(a => a.key));

	// Tag display config
	const TAG_CONFIG = {
	  '生理':    { icon: 'ri-heart-pulse-line', color: '#4a7a5a', label: '生理' },
	  '赌徒':    { icon: 'ri-copper-diamond-line', color: '#b8860b', label: '赌徒' },
	  '机械':    { icon: 'ri-settings-3-line', color: '#5a7a8a', label: '机械' },
	  '资源':    { icon: 'ri-box-3-line', color: '#8a7a5a', label: '资源' },
	  '_traits': { icon: 'ri-shield-flash-line', color: '#6b5b4a', label: '特性' },
	  '_sets':   { icon: 'ri-vip-crown-line', color: '#8a6a4a', label: '套装' },
	};

	// Helper: get quality color for an attribute
	const getCardQualityColor = (attrKey) => {
	  const q = ATTR_QUALITY_MAP ? ATTR_QUALITY_MAP[attrKey] : null;
	  return (q && ORGAN_QUALITY_COLORS && ORGAN_QUALITY_COLORS[q]) ? ORGAN_QUALITY_COLORS[q] : null;
	};

	// Helper: get tag for an attribute
	const getAttrTag = (attrKey) => {
	  const rule = ATTR_EFFECT_RULES ? ATTR_EFFECT_RULES[attrKey] : null;
	  return (rule && rule.tag) ? rule.tag : '生理';
	};

	// Build attribute card HTML (shared)
	const buildAttrCardHtml = (opts) => {
	  const { attrKey, icon, val, valClass, name, effectText, effectClass, detailedReport, providersHtml, isCustom } = opts;
	  const qColor = getCardQualityColor(attrKey);
	  const borderStyle = qColor ? `border-color:${qColor};box-shadow:0 0 0 1px ${qColor}40;` : '';
	  const iconColor = qColor ? qColor : (isCustom ? '#2ea87a' : '');
	  const iconStyle = iconColor ? `color:${iconColor};` : '';
	  const customCls = isCustom ? ' custom-attr-card' : '';
	  return `
	    <div class="organ-attr-compact-card${customCls}" data-attr-key="${attrKey}" style="${borderStyle}">
	      <div class="compact-header-vertical" style="${iconStyle}">
	        <i class="${icon}"></i>
	        <span class="organ-attr-value ${valClass}">${formatAttrVal(val)}</span>
	      </div>
	      <div class="compact-detail">
	        <div class="compact-attr-name">${name}</div>
	        <div class="compact-brief ${effectClass}">${effectText}</div>
	        <div class="compact-desc">${detailedReport}</div>
	        ${providersHtml}
	      </div>
	    </div>
	  `;
	};

	// Collect all cards into tag groups
	const tagGroups = {};
	const addToGroup = (tag, cardHtml, summaryText) => {
	  if (!tagGroups[tag]) tagGroups[tag] = { cards: [], summaries: [] };
	  tagGroups[tag].cards.push(cardHtml);
	  if (summaryText) tagGroups[tag].summaries.push(summaryText);
	};

	// --- Physiology cards ---
	attrsDef.forEach((attr) => {
	  const val = getAttrVal(attr.key, attr.default);

	  let providers = [];
	  const groupedProviders = {};

	  expandedSlots.forEach(slot => {
	    const organ = 器官列表[slot.key];
	    if (!organ || organ.空) return;

	    const activeOrgan = getNormalizedOrgan(normalizeStoredOrgan(organ, slot.baseKey), race);
	    if (activeOrgan && activeOrgan.属性加成 && activeOrgan.属性加成[attr.key] !== undefined) {
	      let v = Number(activeOrgan.属性加成[attr.key]);
	      if (activeOrgan.已排异 !== true) { v = v / 2; }
	      if (v !== 0) {
	        const groupName = activeOrgan.名称;
	        if (!groupedProviders[groupName]) { groupedProviders[groupName] = 0; }
	        groupedProviders[groupName] += v;
	      }
	    }
	  });

	  Object.entries(groupedProviders).forEach(([name, sumVal]) => {
	    providers.push({ name, val: sumVal });
	  });

	  let providersHtml = '';
	  if (providers.length > 0) {
	    providersHtml = `<div class="compact-providers" style="margin-top:4px;border-top:1px dashed rgba(90,70,50,0.15);padding-top:3px;font-size:9.5px;color:#8c7e65;font-weight:500;line-height:1.2;">来源：${providers.map(p => `${p.name}${p.val > 0 ? '+' : ''}${formatAttrVal(p.val)}`).join(', ')}</div>`;
	  }

	  const totalVal = val;
	  const eff = computeAttrEffects(attr.key, totalVal);
	  let valClass = "";
	  if (eff.state === "buff") valClass = "attr-up";
	  else if (eff.state === "debuff" || eff.state === "lethal" || eff.state === "crippled") valClass = "attr-down";
	  const effectText = eff.effectText;
	  const effectClass = eff.state === "buff" ? "effect-buff" : (eff.state === "normal" ? "effect-normal" : "effect-debuff");
	  const detailedReport = eff.detailedReport;

	  const tag = getAttrTag(attr.key);
	  const summary = `${attr.name}${val > 0 ? '+' : ''}${formatAttrVal(val)}`;
	  const cardHtml = buildAttrCardHtml({
	    attrKey: attr.key, icon: attr.icon, val, valClass,
	    name: attr.name, effectText, effectClass, detailedReport, providersHtml, isCustom: false,
	  });
	  addToGroup(tag, cardHtml, summary);
	});

	// --- Collect custom attrs, traits, sets ---
	const customAttrs = new Set();
	const activeTraits = {};
	const setCounts = {};

	expandedSlots.forEach(slot => {
	  const organ = 器官列表[slot.key];
	  if (!organ || organ.空) return;

	  const activeOrgan = getNormalizedOrgan(normalizeStoredOrgan(organ, slot.baseKey), race);
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
	          activeTraits[t].push({ organName: activeOrgan.名称, slotKey: slot.key });
	        }
	      });
	    }
	    if (activeOrgan.套装) {
	      const setName = activeOrgan.套装;
	      setCounts[setName] = (setCounts[setName] || 0) + 1;
	    }
	  }
	});

	// --- Custom attribute cards ---
	customAttrs.forEach(k => {
	  let val = 0;
	  let providers = [];
	  expandedSlots.forEach(slot => {
	    const organ = 器官列表[slot.key];
	    if (!organ || organ.空) return;
	    const activeOrgan = getNormalizedOrgan(normalizeStoredOrgan(organ, slot.baseKey), race);
	    if (activeOrgan && !activeOrgan.空 && activeOrgan.属性加成 && activeOrgan.属性加成[k] !== undefined) {
	      const v = Number(activeOrgan.属性加成[k]);
	      if (v !== 0) { val += v; providers.push({ name: activeOrgan.名称, val: v }); }
	    }
	  });

	  const activeResources = ['燃点', '储能', '能量', '怒气', '法力', '主动能量'];
	  if (activeResources.includes(k) && val < 0) { val = 0; }

	  let providersHtml = '';
	  if (providers.length > 0) {
	    providersHtml = `<div class="compact-providers" style="margin-top:4px;border-top:1px dashed rgba(90,70,50,0.15);padding-top:3px;font-size:9.5px;color:#8c7e65;font-weight:500;line-height:1.2;">来源：${providers.map(p => `${p.name}${p.val > 0 ? '+' : ''}${formatAttrVal(p.val)}`).join(', ')}</div>`;
	  }

	  let valClass = val > 0 ? 'attr-up' : (val < 0 ? 'attr-down' : '');
	  const totalValCustom = val;
	  const isSlotSpecific = ['超频爆发', '超载爆发'].indexOf(k) !== -1;
	  let effectText, effectClass, detailedReport;
	  if (isSlotSpecific && providers.length > 0) {
	    const slotEffects = providers.map(p => {
	      const pOrganSlot = (typeof guessSlotFromOrganName === 'function') ? guessSlotFromOrganName(p.name) : '';
	      const pStandardSlots = ['眼球','心脏','肺脏','胃','肠子','阑尾','肌肉','肝脏','脾脏','肾脏','肋骨','脊柱','脑','胆','膀胱','胰腺','生殖'];
	      const pIsRaceEx = pOrganSlot && pStandardSlots.indexOf(pOrganSlot) === -1;
	      const ctx = { organSlot: pOrganSlot, isRaceExclusive: pIsRaceEx };
	      const pPhys = PHYSIOLOGY_ATTRIBUTES[k];
	      const pTotal = pPhys ? (pPhys.初始 + p.val) : p.val;
	      return { name: p.name, organSlot: pOrganSlot, eff: computeAttrEffects(k, pTotal, ctx) };
	    });
	    effectText = slotEffects.length === 1 ? slotEffects[0].eff.effectText : slotEffects.map(s => s.eff.effectText.split(' Lv')[0]).join(' / ');
	    effectClass = val > 0 ? 'effect-buff' : 'effect-normal';
	    detailedReport = slotEffects.map(s => `<div style="margin-bottom:3px;"><b style="color:#6b4f32;">[${s.organSlot || '未知部位'}]</b> ${s.eff.effectText}: ${s.eff.detailedReport}</div>`).join('');
	  } else {
	    const effCustom = computeAttrEffects(k, totalValCustom);
	    effectText = effCustom.effectText;
	    effectClass = effCustom.state === 'buff' ? 'effect-buff' : (effCustom.state === 'normal' ? 'effect-normal' : 'effect-debuff');
	    detailedReport = effCustom.detailedReport;
	  }
	  if (k === '重击强化' && val < 0) val = 0;

	  let customIcon = (PHYSIOLOGY_ATTRIBUTES[k] && PHYSIOLOGY_ATTRIBUTES[k].icon) || 'ri-pulse-line';
	  if (k === '储能') customIcon = 'ri-battery-charge-line';
	  else if (k === '充能') customIcon = 'ri-water-flash-line';
	  else if (k === '超频爆发' || k === '超载爆发') customIcon = 'ri-flashlight-line';
	  else if (k === '重击强化') customIcon = 'ri-hammer-line';

	  const tag = getAttrTag(k);
	  const summary = `${k}${val > 0 ? '+' : ''}${formatAttrVal(val)}`;
	  const cardHtml = buildAttrCardHtml({
	    attrKey: k, icon: customIcon, val, valClass,
	    name: k, effectText, effectClass, detailedReport, providersHtml, isCustom: true,
	  });
	  addToGroup(tag, cardHtml, summary);
	});	// --- Trait cards ---
	Object.entries(activeTraits).forEach(([traitName, traitSources]) => {
	  const providersHtml = `<div class="compact-providers" style="margin-top:4px;border-top:1px dashed rgba(90,70,50,0.15);padding-top:3px;font-size:9.5px;color:#8c7e65;font-weight:500;line-height:1.2;">来源：${traitSources.map(ts => ts.organName).join(', ')}</div>`;

	  let traitDesc = (typeof ATTR_DESC_TEXT !== 'undefined' && ATTR_DESC_TEXT[traitName])
	    ? ATTR_DESC_TEXT[traitName]
	    : "由器官附带的额外功能性机能加成。";

	  const traitVal = traitSources.length;
	  let traitIcon = 'ri-shield-flash-line';
	  if (traitName === '超频爆发' || traitName === '超载爆发') traitIcon = 'ri-bolt-line';
	  else if (traitName === '重击强化') traitIcon = 'ri-hammer-line';
	  else if (traitName === '充能') traitIcon = 'ri-flashlight-line';

	  const isCommonTrait = ['超频爆发', '超频', '充能', '重击强化'].includes(traitName);
	  let cardHtml;
	  if (isCommonTrait) {
	    cardHtml = `
	      <div class="organ-attr-compact-card trait-card" data-attr-key="${traitName}">
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
	    cardHtml = `
	      <div class="organ-attr-compact-card trait-card" data-attr-key="${traitName}" style="border-color: ${effectStyle.border}; background: ${effectStyle.bg};">
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
	  addToGroup('_traits', cardHtml, '');
	});

	// --- Set cards ---
	Object.entries(setCounts).forEach(([setName, count]) => {
	  const setProviders = [];
	  expandedSlots.forEach(slot => {
	    const organ = 器官列表[slot.key];
	    const isEquipped = !!organ && !organ.空;
	    if (isEquipped && organ.套装 === setName) {
	      setProviders.push(organ.名称);
	    }
	  });
	  const setProvidersHtml = `<div class="compact-providers" style="margin-top:4px;border-top:1px dashed rgba(90,70,50,0.15);padding-top:3px;font-size:9.5px;color:#8c7e65;font-weight:500;line-height:1.2;">部件: ${setProviders.join(', ')}</div>`;

	  let setDesc = `已装备 ${setName} 部件。成套后可激活特殊机能共鸣。`;
	  if (setName.includes('机械')) {
	    setDesc = `已装备 ${count} 件机械套装部件。激活效果：机械传动效率提升，储能最大上限额外获得提升。`;
	  }

	  const effectStyle = getEffectColor(setName, setDesc);
	  const cardHtml = `
	    <div class="organ-attr-compact-card set-card" data-attr-key="${setName}" style="border-color: ${effectStyle.border}; background: ${effectStyle.bg};">
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
	  addToGroup('_sets', cardHtml, '');
	});

	// ===== RENDER phase: build tag-grouped HTML =====
	let attrsGridHtml = '<div class="organ-attrs-header-bar">';
	attrsGridHtml += `<span><i class="ri-pulse-line"></i> 属性</span>`;
	attrsGridHtml += `<button class="attr-collapse-all-btn" id="attr-collapse-all-btn">全部折叠</button>`;
	attrsGridHtml += '</div>';

	attrsGridHtml += '<div class="attr-panel-scroll">';
	const tagOrder = ['生理', '赌徒', '机械', '资源', '_traits', '_sets'];
	tagOrder.forEach(tag => {
	  const group = tagGroups[tag];
	  if (!group || !group.cards.length) return;

	  const cfg = TAG_CONFIG[tag] || { icon: 'ri-pulse-line', color: '#6b5b4a', label: tag };
	  const groupId = 'attr-group-' + tag;

	  attrsGridHtml += `
	    <div class="attr-group">
	      <div class="attr-group-header" data-group-id="${groupId}">
	        <div class="attr-group-header-left">
	          <i class="${cfg.icon} attr-group-icon" style="color:${cfg.color};" data-tt-tag="${tag}"></i>
	          <span>${cfg.label}</span>
	          <span class="attr-group-count">(${group.cards.length})</span>
	          <i class="ri-arrow-down-s-line collapse-icon"></i>
	        </div>
	      </div>
	      <div class="attr-group-body" id="${groupId}">
	        <div class="organ-attrs-grid">
	          ${group.cards.join('')}
	        </div>
	      </div>
	    </div>
	  `;
	});

	// Fallback if no cards at all
	if (Object.values(tagGroups).every(g => !g.cards.length)) {
	  attrsGridHtml += `
	    <div style="text-align:center;padding:12px;color:#6b5b4a;font-size:11px;background:#f5edd8;border:1px dashed #d4c4a8;border-radius:6px;">
	      <i class="ri-shield-check-line" style="color:#2ea87a;margin-right:4px;"></i> 所有生理机能处于标准状态
	    </div>
	  `;
	}

	attrsGridHtml += '</div>';
	$panel.find('.organ-attrs-header-bar').remove();
	$panel.find('.attr-group').remove();
	$panel.find('.organ-attrs-grid').remove();
	const $attrsContainer = $panel.find('#organ-attrs-container');
	if ($attrsContainer.length) {
	  $attrsContainer.html(attrsGridHtml);
	} else {
	  $organSet.after(attrsGridHtml);
	}

	// Wire collapse-all button
	let allCollapsed = false;
	$panel.find('#attr-collapse-all-btn').on('click', function() {
	  allCollapsed = !allCollapsed;
	  $panel.find('.attr-group-body').toggleClass('collapsed', allCollapsed);
	  $panel.find('.collapse-icon').toggleClass('collapsed', allCollapsed);
	  $(this).text(allCollapsed ? '全部展开' : '全部折叠');
	});

	// Wire collapse toggles
	$panel.find('.attr-group-header').on('click', function() {
	  const groupId = $(this).data('group-id');
	  const $body = $panel.find('#' + groupId);
	  const $icon = $(this).find('.collapse-icon');
	  $body.toggleClass('collapsed');
	  $icon.toggleClass('collapsed');
	});

	// 卡片 tooltip 由 CSS :hover 控制显示/隐藏，保持原结构
	// Wire header icon hover tooltips (body-level to escape overflow:hidden)
	// 检测 $panel 是否在父窗口（跨文档）
	const isParentDoc = $panel.length && $panel[0].ownerDocument !== document;
	const tipDoc = isParentDoc ? $panel[0].ownerDocument : document;
	const tip$ = isParentDoc ? (window.parent.jQuery || window.parent.$) : $;
	let $attrGroupTip = tip$('#organ-attr-group-tooltip');
	if (!$attrGroupTip.length) {
	  $attrGroupTip = tip$('<div id="organ-attr-group-tooltip" style="display:none;position:fixed;width:max-content;max-width:280px;background:var(--tt-bg-soft);border:1px solid var(--tt-bg-soft-border);color:var(--tt-bg-soft-text);border-radius:8px;padding:8px 10px;box-shadow:0 4px 16px rgba(90,70,50,0.25);z-index:2147483647;font-size:11px;line-height:1.4;pointer-events:none;isolation:isolate;"></div>');
	  tip$('body', tipDoc).append($attrGroupTip);
	}

	const showAttrGroupTip = (iconEl, tag) => {
	  const group = tagGroups[tag];
	  if (!group) return;
	  let html = `<div style="font-weight:700;margin-bottom:4px;color:#4a3c31;border-bottom:1px dashed rgba(90,70,50,0.2);padding-bottom:3px;">${TAG_CONFIG[tag]?.label || tag} 属性总览</div>`;
	  group.summaries.forEach((s) => {
	    if (s) html += `<div style="color:#6b5b4a;">${s}</div>`;
	  });
	  $attrGroupTip.html(html);
	  const r = iconEl.getBoundingClientRect();
	  $attrGroupTip.css({ display: 'block', visibility: 'hidden', left: '0px', top: '0px' });
	  const tr = $attrGroupTip[0].getBoundingClientRect();
	  const tipWin = isParentDoc ? window.parent : window;
	  let top = r.bottom + 6;
	  let left = r.left + r.width / 2 - tr.width / 2;
	  if (left < 6) left = 6;
	  if (left + tr.width > tipWin.innerWidth - 6) left = tipWin.innerWidth - tr.width - 6;
	  if (top + tr.height > tipWin.innerHeight - 6) top = r.top - tr.height - 6;
	  if (top < 6) top = 6;
	  $attrGroupTip.css({ visibility: 'visible', left: left + 'px', top: top + 'px' });
	};
	const hideAttrGroupTip = () => $attrGroupTip.hide();

	$panel.find('.attr-group-icon').off('mouseenter mouseleave').on('mouseenter', function() {
	  showAttrGroupTip(this, $(this).data('tt-tag'));
	}).on('mouseleave', hideAttrGroupTip);
	// 鼠标移到 tooltip 上时取消隐藏（保持可读）
	$attrGroupTip.off('mouseenter mouseleave').on('mouseenter', function(e) {
	  e.stopPropagation();
	  $attrGroupTip.stop().show();
	}).on('mouseleave', function() {
	  $attrGroupTip.hide();
	});

		// 卡片 hover tooltip：hover 时把 .compact-detail 提升到 body 并用 position:fixed 定位
		const cardTipDoc = $panel[0].ownerDocument;
		const cardTip$ = (cardTipDoc !== document) ? (window.parent.jQuery || window.parent.$) : $;
		const $cardTipHost = cardTip$('body', cardTipDoc);
		const tipWin = $cardTipHost[0] ? ($cardTipHost[0].ownerDocument.defaultView || window) : window;
		const placeCardTip = (iconEl) => {
		  const cardEl = iconEl.closest('.organ-attr-compact-card');
		  if (!cardEl) return;
		  const detail = cardEl.querySelector('.compact-detail');
		  if (!detail || !detail.innerHTML.trim()) return;
		  if (!detail._origParent) detail._origParent = detail.parentElement;
		  if (!detail._origStyle) {
			detail._origStyle = {
			  position: detail.style.position,
			  left: detail.style.left,
			  top: detail.style.top,
			  bottom: detail.style.bottom,
			  transform: detail.style.transform,
			  visibility: detail.style.visibility,
			  opacity: detail.style.opacity,
			  zIndex: detail.style.zIndex,
			};
		  }
		  // 提升到 body 避免被任何父级裁剪
		  if (detail.parentElement !== $cardTipHost[0]) {
			$cardTipHost[0].appendChild(detail);
		  }
		  const r = iconEl.getBoundingClientRect();
		  detail.style.position = 'fixed';
		  detail.style.left = '0px';
		  detail.style.top = '0px';
		  detail.style.bottom = 'auto';
		  detail.style.transform = 'none';
		  detail.style.visibility = 'hidden';
		  detail.style.opacity = '1';
		  detail.style.zIndex = '2147483647';
		  const tr = detail.getBoundingClientRect();
		  let top = r.top - tr.height - 6;
		  let left = r.left + r.width / 2 - tr.width / 2;
		  if (left < 6) left = 6;
		  if (left + tr.width > tipWin.innerWidth - 6) left = tipWin.innerWidth - tr.width - 6;
		  if (top < 6) top = r.bottom + 6;
		  if (top + tr.height > tipWin.innerHeight - 6) top = tipWin.innerHeight - tr.height - 6;
		  detail.style.left = left + 'px';
		  detail.style.top = top + 'px';
		  detail.style.visibility = 'visible';
		};
		const restoreCardTip = (iconEl) => {
		  // detail 可能已被移到 body，需要直接找到
		  const cardEl = iconEl.closest('.organ-attr-compact-card');
		  if (!cardEl) return;
		  // 从 $cardTipHost 中找所有 _origStyle 非空且 _origParent 是 cardEl 的子元素的 detail
		  const allDetails = $cardTipHost[0].querySelectorAll('.compact-detail');
		  for (const d of allDetails) {
			if (d._origParent === cardEl && d._origStyle) {
			  d._origParent.appendChild(d);
			  Object.assign(d.style, d._origStyle);
			  d._origStyle = null;
			  d._origParent = null;
			}
		  }
		};

		$panel.on('mouseenter', '.organ-attr-compact-card i', function() {
		  placeCardTip(this);
		}).on('mouseleave', '.organ-attr-compact-card i', function() {
		  restoreCardTip(this);
		});

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

    // 将初始器官写入器官系统/器官列表（槽位），使 getAttrVal 能正确读取
    // 不再依赖 getDefaultOrganForSlot 回退（用户卸下所有器官后属性归零）
    initOrgans.forEach(o => {
      const count = (SLOTS_LAYOUT[o.key] && SLOTS_LAYOUT[o.key].count) || 1;
      // 多槽位器官（如眼球×2、肌肉×8）将属性平分到每个槽位
      const dividedAttr = {};
      Object.entries(o.attr).forEach(([attrKey, attrVal]) => {
        dividedAttr[attrKey] = count > 1 ? Number(attrVal) / count : Number(attrVal);
      });
      for (let i = 1; i <= count; i++) {
        const slotKey = count > 1 ? `${o.key}_${i}` : o.key;
        // 只在槽位为空时写入（不覆盖已有装备）
        if (!(data.人物.器官系统?.器官列表 || {})[slotKey]) {
          patches.push({
            op: 'add',
            path: `/人物/器官系统/器官列表/${slotKey}`,
            value: {
              名称: o.name,
              品质: "普通",
              描述: o.desc,
              部位: o.key,
              属性加成: dividedAttr,
              特性: [],
              标签: ["血肉", "人类"],
              种族: "",
              强化等级: 0,
              初始: true,
              已排异: true
            }
          });
        }
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

  // autoInitializeMissingOrgans moved to OrganAttributes.js — accessed via OA namespace

  const refreshStatusBar = async () => {
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
        await updateOrganUI();
      }
    }
  };
  const injectStyles = () => {
    if (!$) return;
    if (document.getElementById('organ-system-styles')) return;
    const style = document.createElement('style');
    style.id = 'organ-system-styles';
    style.textContent = ` /* ===== 弹出容器溢出/滚动条统一规则 ===== */
#${SCRIPT_ID}-popup .organ-theme-card,
#${SCRIPT_ID}-popup .organ-theme-card * { overflow: visible !important; }
#${SCRIPT_ID}-popup .organ-theme-card .sub-slots-container,
#${SCRIPT_ID}-popup .organ-theme-card .organ-candidates-grid,
#${SCRIPT_ID}-popup .organ-theme-card .rejection-grid { overflow-y: auto !important; scrollbar-width: none; -ms-overflow-style: none; }
#${SCRIPT_ID}-popup .organ-theme-card .sub-slots-container::-webkit-scrollbar,
#${SCRIPT_ID}-popup .organ-theme-card .organ-candidates-grid::-webkit-scrollbar,
#${SCRIPT_ID}-popup .organ-theme-card .rejection-grid::-webkit-scrollbar { display: none; width: 0; height: 0; }
#${SCRIPT_ID}-popup .organ-theme-card .sub-slots-container::-webkit-scrollbar-track,
#${SCRIPT_ID}-popup .organ-theme-card .organ-candidates-grid::-webkit-scrollbar-track,
#${SCRIPT_ID}-popup .organ-theme-card .rejection-grid::-webkit-scrollbar-track { background: transparent; }
#${SCRIPT_ID}-popup .organ-theme-card .sub-slots-container::-webkit-scrollbar-thumb,
#${SCRIPT_ID}-popup .organ-theme-card .organ-candidates-grid::-webkit-scrollbar-thumb,
#${SCRIPT_ID}-popup .organ-theme-card .rejection-grid::-webkit-scrollbar-thumb { background: transparent; }
/* ===== sub-slot-tooltip-css (原内联注入) ===== */
.sub-slots-container{display:grid !important;grid-template-columns:repeat(4,1fr) !important;gap:6px !important;margin:4px 0 8px;padding:2px;}
.sub-slot-card,.organ-candidate-card-grid,.sub-slot-pick-item{border-radius:6px;border:1px solid rgba(180,140,80,0.25);background:var(--ot-bg);padding:4px 2px;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:all 0.12s ease;gap:2px;}
.sub-slot-card:hover,.organ-candidate-card-grid:hover,.sub-slot-pick-item:hover{border-color:#8b6b4a !important;}
.organ-candidates-grid{display:grid !important;grid-template-columns:repeat(4,1fr) !important;gap:6px !important;max-height:188px !important;overflow-y:auto !important;padding:4px 4px 12px !important;width:100% !important;}
.equip-target-slot-card{border-radius:6px;border:2px dashed rgba(180,140,80,0.4);background:rgba(200,180,150,0.08);padding:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:52px;}
.equip-target-slot-card:hover{border-color:#8b6b4a !important;}
.organ-candidate-card-grid.dragging,.sub-slot-card.dragging{opacity:0.35 !important;}
/* ===== 以下为原 injectStyles() 内容 ===== */
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
.attr-panel-scroll{max-height:100%;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;}
.attr-panel-scroll::-webkit-scrollbar{display:none;width:0;}
.attr-collapse-all-btn{font-size:10px;padding:2px 10px;border:1px solid var(--ot-border,#c4a06a);border-radius:4px;background:rgba(180,140,80,0.08);color:#6b4f32;cursor:pointer;transition:all 0.15s;font-family:inherit;}
.attr-collapse-all-btn:hover{background:rgba(180,140,80,0.18);border-color:#b89860;}
.organ-standalone-panel .attr-panel-scroll{max-height:100%;}
.attr-group{margin-bottom:10px;border-radius:8px;border:1px solid var(--ot-border,#d4c4a8);background:rgba(200,180,150,0.08);
}
.attr-group-header{display:flex;justify-content:space-between;align-items:center;padding:6px 10px;cursor:pointer;transition:background 0.12s;user-select:none;position:relative;border-radius:7px 7px 0 0;
}
.attr-group-header:hover{background:rgba(180,140,80,0.1);
}
.attr-group-header-left{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#4a3c31;
}
.attr-group-header-left i{font-size:14px;
}
.attr-group-count{font-size:10px;font-weight:500;color:#8c7e65;margin-left:2px;
}
.attr-group-header .collapse-icon{font-size:14px;color:#8c7e65;transition:transform 0.2s;margin-left:4px;
}
.attr-group-header .collapse-icon.collapsed{transform:rotate(-90deg);
}
.attr-group-icon{cursor:help;transition:transform 0.12s;
}
.attr-group-icon:hover{transform:scale(1.15);
}
.attr-group-body{padding:6px;border-top:1px solid var(--ot-border,#d4c4a8);border-radius:0 0 7px 7px;
}
.attr-group-body.collapsed{display:none;}
#organ-attr-group-tooltip{z-index:2147483647 !important;position:fixed !important;pointer-events:none;}
.organ-attrs-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:15px;
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
.compact-detail{position:absolute;bottom:115%;left:50%;transform:translate(-50%,-6px);width:160px;background:var(--tt-bg-soft) !important;border:1px solid var(--tt-bg-soft-border) !important;border-radius:6px;padding:8px 10px !important;box-shadow:0 4px 12px rgba(90,70,50,0.18) !important;z-index:1000;opacity:0;pointer-events:none;transition:opacity 0.15s ease,transform 0.15s ease;text-align:left;white-space:normal;visibility:hidden;}
.organ-attr-compact-card.jscss-hover .compact-detail{opacity:1 !important;transform:none !important;visibility:visible !important;}




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
#${SCRIPT_ID}-panel .organ-backpack-item.is-unadapted,
#${SCRIPT_ID}-panel .organ-backpack-item.is-unadapted:hover{border-color:transparent !important;box-shadow:inset 0 1px 2px rgba(255,255,255,0.7),0 1px 2px rgba(0,0,0,0.1) !important;
}
#${SCRIPT_ID}-panel .organ-backpack-item{position:relative;box-sizing:border-box;width:100%;aspect-ratio:1;border-radius:var(--organ-card-radius) !important;padding:var(--organ-card-pad-y) var(--organ-card-pad-x) !important;background:linear-gradient(180deg,rgba(180,150,100,0.1) 0%,rgba(180,150,100,0.18) 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--organ-card-gap);cursor:pointer;transition:all 0.15s ease;border:1px solid transparent !important;box-shadow:inset 0 2px 4px rgba(0,0,0,0.08),inset 0 -1px 1px rgba(255,255,255,0.4);
}

#${SCRIPT_ID}-panel .organ-backpack-item .card-icon{font-size:var(--organ-card-icon-size);line-height:1;
}

#${SCRIPT_ID}-panel .organ-backpack-item .card-name{font-size:var(--organ-card-name-size);font-weight:700;text-align:center;max-width:var(--organ-card-name-w);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1;
}
#${SCRIPT_ID}-panel .organ-backpack-item .organ-slot-card-inner{width:100%;height:100%;background:var(--ot-bg-soft,#dcc896);border-radius:calc(var(--organ-card-radius) - 1px);box-shadow:inset 0 1px 2px rgba(255,255,255,0.7),0 1px 2px rgba(0,0,0,0.1);padding:2px 4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;position:relative;z-index:1;
}

#${SCRIPT_ID}-panel .organ-backpack-item.is-unadapted .organ-slot-card-inner{box-shadow:inset 0 1px 2px rgba(255,255,255,0.7),0 1px 2px rgba(0,0,0,0.1) !important;
}
#${SCRIPT_ID}-panel .organ-backpack-item.is-unadapted::before{content:'';position:absolute;inset:0;border-radius:6px;box-shadow:0 0 8px 4px rgba(207,34,46,0.5),0 0 20px 10px rgba(207,34,46,0.25);z-index:-1;pointer-events:none;
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

@keyframes organ-unadapted-pulse{0%,100%{box-shadow:inset 0 0 3px rgba(207,34,46,0.5),inset 0 0 8px rgba(207,34,46,0.3);}
50%{box-shadow:inset 0 0 5px rgba(207,34,46,0.8),inset 0 0 14px rgba(207,34,46,0.6);}

}
.organ-gear-label-box{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) scale(0.9);background:var(--tt-bg-soft);border:1px solid var(--tt-bg-soft-border);border-radius:10px;padding:2px 8px;font-size:11px;display:flex;white-space:nowrap;align-items:center;box-shadow:0 2px 6px rgba(90,70,50,0.15);pointer-events:none;z-index:10;opacity:0;transition:opacity 0.15s ease,transform 0.15s ease;
}
.organ-gear-slot:hover .organ-gear-label-box{opacity:1;transform:translate(-50%,-50%) scale(1);
}
.organ-gear-val-name{color:#4a3c31;font-weight:600;max-width:100px;overflow:hidden;text-overflow:ellipsis;
}
:root,
#${SCRIPT_ID}-panel,
#${SCRIPT_ID}-popup{--tt-bg-soft:#f2e6ce;        --tt-bg-soft-text:#4a3c31;   --tt-bg-soft-text-sub:#6b5b4a; --tt-bg-soft-border:#c4ae80;
}
#${SCRIPT_ID}-popup .organ-theme-card{--ot-bg:#e8d4a8;--ot-bg-soft:#dcc896;--ot-border:#c4a06a;--ot-text-main:#4a3c31;--ot-text-sub:#6b5b4a;--ot-text-weak:#9a8a75;--organ-card-h:52px;--organ-card-radius:6px;--organ-card-pad-y:4px;--organ-card-pad-x:2px;--organ-card-gap:2px;--organ-card-icon-size:14px;--organ-card-name-size:9px;--organ-card-name-w:70px;background:var(--ot-bg,#e8d4a8) !important;border:1px solid var(--ot-border,#c4a06a) !important;border-radius:12px !important;width:90% !important;max-width:340px !important;box-shadow:0 8px 30px rgba(0,0,0,0.15) !important;color:var(--ot-text-main,#4a3c31) !important;padding:16px !important;
}
#${SCRIPT_ID}-popup .organ-theme-card .organ-card-base{position:relative;box-sizing:border-box;width:100%;height:var(--organ-card-h) !important;border-radius:var(--organ-card-radius) !important;padding:var(--organ-card-pad-y) var(--organ-card-pad-x) !important;background:var(--ot-bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--organ-card-gap);cursor:pointer;transition:all 0.15s ease;
}

#${SCRIPT_ID}-popup .organ-theme-card .organ-card-base .card-icon{font-size:var(--organ-card-icon-size);line-height:1;
}

#${SCRIPT_ID}-popup .organ-theme-card .organ-card-base .card-name{font-size:var(--organ-card-name-size);font-weight:700;text-align:center;max-width:var(--organ-card-name-w);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1;
}
#organ-system-panel .organ-theme-card .rejection-organ-card{border:1px solid rgba(207,34,46,0.35) !important;min-height:56px;height:auto !important;padding:6px 4px !important;}
#${SCRIPT_ID}-popup .organ-theme-card .organ-slot-card-base{box-shadow:0 7px 0 -1px rgba(196,160,106,0.5),0 7px 6px -4px rgba(0,0,0,0.1),0 1px 2px rgba(0,0,0,0.06);transition:all 0.15s ease;border:1px solid transparent !important;padding:3px !important;
}
#${SCRIPT_ID}-popup .organ-theme-card .organ-slot-card-base.is-empty{border:1px solid rgba(90,70,50,0.14) !important;background:transparent;box-shadow:inset 0 0 4px rgba(0,0,0,0.08);
}

#${SCRIPT_ID}-popup .organ-theme-card .organ-slot-card-base.has-organ{border:1px solid rgba(180,140,80,0.25) !important;
}

#${SCRIPT_ID}-popup .organ-theme-card .organ-slot-card-base.selected{border:2px solid #8b6b4a !important;box-shadow:0 7px 0 -1px rgba(196,160,106,0.5),0 7px 6px -4px rgba(0,0,0,0.1),0 1px 2px rgba(0,0,0,0.06),0 0 8px rgba(139,107,74,0.35) !important;
}
#${SCRIPT_ID}-popup .organ-theme-card .organ-slot-card-inner{width:100%;height:100%;background:var(--ot-bg);border-radius:calc(var(--organ-card-radius) - 1px);box-shadow:none;padding:2px 4px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;position:relative;z-index:1;
}
#${SCRIPT_ID}-popup .organ-theme-card .organ-slot-card-base.has-organ .organ-slot-card-inner{box-shadow:none;
}
#${SCRIPT_ID}-popup .organ-theme-card .organ-slot-card-base.is-empty .organ-slot-card-inner{background:transparent;border-radius:0;box-shadow:none;opacity:0.55;
}
#${SCRIPT_ID}-popup .organ-theme-card .organ-slot-card-base.is-selected{box-shadow:0 0 0 2px #8e44ad,0 0 12px 4px rgba(142,68,173,0.4) !important;transform:translateY(-2px);background:rgba(142,68,173,0.08) !important;}
#organ-system-panel .organ-theme-card .organ-slot-card-base.is-selected{box-shadow:0 0 0 2px #8e44ad,0 0 12px 4px rgba(142,68,173,0.4) !important;transform:translateY(-2px);background:rgba(142,68,173,0.08) !important;}
#${SCRIPT_ID}-popup .organ-theme-card .organ-slot-card-inner.is-unadapted{box-shadow:none !important;
}

#${SCRIPT_ID}-popup .organ-theme-card .organ-slot-card-base.is-unadapted{box-shadow:0 7px 0 -1px rgba(207,34,46,0.5),0 7px 8px -4px rgba(0,0,0,0.12),0 1px 2px rgba(0,0,0,0.06) !important;
}
/* YJ1 排异弹窗：立体卡片风格，4列，固定行数溢出滚动，隐藏滚动条 */
#${SCRIPT_ID}-popup .organ-theme-card .rejection-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:8px 4px 16px;max-height:360px;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none;}#${SCRIPT_ID}-popup .organ-theme-card .rejection-grid::-webkit-scrollbar{display:none;}
#${SCRIPT_ID}-popup .organ-theme-card .organ-slot-card-base.is-unadapted .organ-slot-card-inner{box-shadow:none !important;
}

#${SCRIPT_ID}-popup .organ-theme-card .organ-slot-card-base.is-empty:hover{transform:none;box-shadow:inset 0 0 4px rgba(0,0,0,0.08);}
#${SCRIPT_ID}-popup .organ-theme-card .organ-slot-card-base:hover{box-shadow:0 1px 0 -1px rgba(196,160,106,0.5),0 1px 3px -1px rgba(0,0,0,0.08);transform:translateY(5px);
}
#${SCRIPT_ID}-popup .organ-theme-card .organ-slot-card-base.is-unadapted:hover{box-shadow:0 1px 0 -1px rgba(207,34,46,0.5),0 1px 3px -1px rgba(0,0,0,0.08) !important;transform:translateY(5px);
}
#${SCRIPT_ID}-popup .organ-theme-card .organ-slot-card-base.has-organ:hover .organ-slot-card-inner{box-shadow:none;
}
#${SCRIPT_ID}-popup .organ-theme-card .organ-slot-card-base.is-unadapted:hover .organ-slot-card-inner{box-shadow:none !important;
}
html[data-darkreader-mode="dark"] #${SCRIPT_ID}-popup .organ-theme-card,
html.darkreader--dark #${SCRIPT_ID}-popup .organ-theme-card{background:var(--ot-bg) !important;border-color:var(--ot-border) !important;color:var(--ot-text-main) !important;--darkreader-bg:#fcf6ea !important;--darkreader-text:#4a3c31 !important;--darkreader-border:#d4c4a8 !important;
}

html[data-darkreader-mode="dark"] #${SCRIPT_ID}-popup .organ-theme-card *,
html.darkreader--dark #${SCRIPT_ID}-popup .organ-theme-card *{--darkreader-bg:transparent !important;--darkreader-text:#4a3c31 !important;
}
html[data-darkreader-mode="dark"] #${SCRIPT_ID}-panel .compact-detail,
html.darkreader--dark #${SCRIPT_ID}-panel .compact-detail,
html[data-darkreader-mode="dark"] #${SCRIPT_ID}-panel .organ-gear-label-box,
html.darkreader--dark #${SCRIPT_ID}-panel .organ-gear-label-box{background:var(--tt-bg-soft) !important;color:var(--tt-bg-soft-text) !important;border-color:var(--tt-bg-soft-border) !important;--darkreader-bg:#f8f0dc !important;--darkreader-text:#4a3c31 !important;--darkreader-border:#d4c4a8 !important;
}

html[data-darkreader-mode="dark"] #${SCRIPT_ID}-panel .compact-detail *,
html.darkreader--dark #${SCRIPT_ID}-panel .compact-detail *,
html[data-darkreader-mode="dark"] #${SCRIPT_ID}-panel .organ-gear-label-box *,
html.darkreader--dark #${SCRIPT_ID}-panel .organ-gear-label-box *{--darkreader-bg:transparent !important;--darkreader-text:#4a3c31 !important;
}
html[data-darkreader-mode="dark"] #${SCRIPT_ID}-popup .slot-sub-menu,
html.darkreader--dark #${SCRIPT_ID}-popup .slot-sub-menu,
html[data-darkreader-mode="dark"] #rejection-confirm-overlay > div,
html.darkreader--dark #rejection-confirm-overlay > div,
html[data-darkreader-mode="dark"] #${SCRIPT_ID}-popup #organ-shared-tooltip,
html.darkreader--dark #${SCRIPT_ID}-popup #organ-shared-tooltip{background:var(--tt-bg-soft) !important;color:var(--tt-bg-soft-text) !important;--darkreader-bg:#f8f0dc !important;--darkreader-text:#4a3c31 !important;
}

html[data-darkreader-mode="dark"] #${SCRIPT_ID}-popup #organ-shared-tooltip *,
html.darkreader--dark #${SCRIPT_ID}-popup #organ-shared-tooltip *{--darkreader-bg:transparent !important;--darkreader-text:#4a3c31 !important;
}
#${SCRIPT_ID}-popup .organ-theme-card .popup-close{position:absolute;top:12px;right:12px;background:none;border:none;cursor:pointer;font-size:16px;color:#57606a;
}
#${SCRIPT_ID}-popup .organ-theme-card .organ-bonus-chip{display:inline-block;font-size:9.5px;background:rgba(139,107,74,0.08);color:#8b6b4a;border:1px solid rgba(139,107,74,0.2);padding:1px 5px;border-radius:4px;font-weight:600;font-style:normal;
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

.organ-standalone-panel .organ-panel-section-card{background:url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxODAiIGhlaWdodD0iMTgwIj4KICA8ZmlsdGVyIGlkPSJwYXBlcl9ub2lzZSI+CiAgICA8ZmVUdXJidWxlbmNlIHR5cGU9ImZyYWN0YWxOb2lzZSIgYmFzZUZyZXF1ZW5jeT0iMC4yNSIgbnVtT2N0YXZlcz0iMyIgcmVzdWx0PSJub2lzZSIvPgogICAgPGZlQ29sb3JNYXRyaXggdHlwZT0ibWF0cml4IiB2YWx1ZXM9IjEgMCAwIDAgMCAgMCAxIDAgMCAwICAwIDAgMSAwIDAgIDAgMCAwIDAuMTIgMCIvPgogIDwvZmlsdGVyPgogIDxyZWN0IHdpZHRoPSIxODAiIGhlaWdodD0iMTgwIiBmaWx0ZXI9InVybCgjcGFwZXJfbm9pc2UpIiBmaWxsPSJub25lIi8+Cjwvc3ZnPg==") repeat, var(--ot-bg,#e8d4a8);border:1px solid var(--ot-border,#c4a06a);border-radius:10px;flex:1;min-height:0;overflow:hidden;
}

/* 躯体 + 生理属性横向并排 */
.organ-standalone-panel .organ-body-attrs-row{display:flex;flex-direction:row;min-height:0;height:100%;overflow:hidden;
}
.organ-standalone-panel .organ-body-slots{flex:1;min-width:0;padding:12px 12px 18px;box-sizing:border-box;
}
.organ-standalone-panel .organ-attrs-column{width:28%;flex-shrink:0;padding:10px;box-sizing:border-box;border-left:1px solid var(--ot-border,#d4c4a8);display:flex;flex-direction:column;min-height:0;overflow:hidden;
}
.organ-standalone-panel .organ-attrs-column .organ-attrs-grid{grid-template-columns:repeat(4,1fr);
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

.organ-standalone-panel .organ-backpack-grid{flex:1;overflow-y:scroll;overflow-x:hidden;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:auto;gap:5px;padding:6px 6px 14px;position:relative;min-height:0;scrollbar-width:none;-ms-overflow-style:none;align-content:start;
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
.organ-standalone-panel .organ-backpack-grid .organ-backpack-item.is-selected{border-color:#8e44ad !important;box-shadow:0 0 0 2px #8e44ad,0 0 12px 4px rgba(142,68,173,0.35) !important;transform:translateY(-2px);}
.organ-standalone-panel .organ-backpack-grid .organ-backpack-item.is-unadapted{border-color:var(--ot-border,#c4a06a);
}
.organ-standalone-panel .organ-backpack-grid .organ-backpack-item.is-unadapted::before{content:'';position:absolute;inset:0;border-radius:6px;box-shadow:0 0 8px 4px rgba(207,34,46,0.5),0 0 20px 10px rgba(207,34,46,0.25);z-index:-1;pointer-events:none;
}
.organ-standalone-panel .organ-backpack-grid .organ-backpack-item .organ-slot-card-inner{width:100%;height:100%;border-radius:5px;background:transparent;box-shadow:none;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6%;gap:6%;box-sizing:border-box;
}
.organ-standalone-panel .organ-backpack-grid .organ-backpack-item .organ-slot-card-inner .card-icon{width:55%;height:55%;font-size:max(75%, 20px) !important;line-height:1;display:flex;align-items:center;justify-content:center;
}
.organ-standalone-panel .organ-backpack-grid .organ-backpack-item .organ-slot-card-inner .card-name{font-size:max(25%, 12px) !important;font-weight:600;text-align:center;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.1;
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
.organ-medicine-btn.is-active{background:rgba(142,68,173,0.12);border-color:#8e44ad;color:#8e44ad;box-shadow:0 0 8px rgba(142,68,173,0.25);}
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
                <span id="organ-backpack-select-mode" class="organ-medicine-btn" title="多选模式" style="display:none;">
                  <i class="ri-checkbox-multiple-line"></i>
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
    openOrganPanel,
    closeOrganPanel,
    showToast,
    // Data layer accessed via window.OrganAttr
    fetchLatestMvuData: OA.fetchLatestMvuData,
    applyMvuPatches: OA.applyMvuPatches,
    autoInitializeMissingOrgans: OA.autoInitializeMissingOrgans,
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
  OA.setupMvuListener();

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

  // --- 通用悬浮按钮由脚本顶部早期注入处理（见第 14-87 行）---
})();
