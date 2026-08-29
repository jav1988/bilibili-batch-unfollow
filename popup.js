'use strict';

var state = {
  items: [],
  selected: {},
  owner: '',
  running: false,
  confirmResolve: null
};

var STORAGE_KEY = 'followingManagerState';

var elements = {
  statusBadge: document.getElementById('statusBadge'),
  searchInput: document.getElementById('searchInput'),
  loadButton: document.getElementById('loadButton'),
  totalCount: document.getElementById('totalCount'),
  visibleCount: document.getElementById('visibleCount'),
  selectedCount: document.getElementById('selectedCount'),
  selectVisible: document.getElementById('selectVisible'),
  followingBody: document.getElementById('followingBody'),
  progressPanel: document.getElementById('progressPanel'),
  progressBar: document.getElementById('progressBar'),
  progressText: document.getElementById('progressText'),
  delaySelect: document.getElementById('delaySelect'),
  unfollowButton: document.getElementById('unfollowButton'),
  versionText: document.getElementById('versionText'),
  riskBadge: document.getElementById('riskBadge'),
  riskHint: document.getElementById('riskHint'),
  modalBackdrop: document.getElementById('modalBackdrop'),
  confirmDialog: document.getElementById('confirmDialog'),
  confirmCount: document.getElementById('confirmCount'),
  confirmDelay: document.getElementById('confirmDelay'),
  confirmRisk: document.getElementById('confirmRisk'),
  confirmPreview: document.getElementById('confirmPreview'),
  confirmCheckbox: document.getElementById('confirmCheckbox'),
  cancelConfirmButton: document.getElementById('cancelConfirmButton'),
  acceptConfirmButton: document.getElementById('acceptConfirmButton'),
  resultDialog: document.getElementById('resultDialog'),
  resultIcon: document.getElementById('resultIcon'),
  resultTitle: document.getElementById('resultTitle'),
  resultMessage: document.getElementById('resultMessage'),
  resultDetails: document.getElementById('resultDetails'),
  closeResultButton: document.getElementById('closeResultButton')
};

/**
 * 中文：转义即将写入 HTML 的文本，避免用户昵称或签名被当作页面代码执行。
 *
 * English: Escape text before writing HTML so user names or signatures cannot execute as page code.
 */
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * 中文：从扩展清单读取版本并展示，避免界面中的版本文字与实际安装版本不一致。
 *
 * English: Read and display the manifest version so interface text cannot drift from the installed extension version.
 */
function renderPluginMeta() {
  var manifest = chrome.runtime.getManifest();
  elements.versionText.textContent = '版本：v' + manifest.version;
}

/**
 * 中文：等待指定时间，用可控间隔降低连续关系操作触发风控的概率。
 *
 * English: Wait for a controlled interval to reduce the chance of rate limits during relation changes.
 */
function sleep(milliseconds) {
  return new Promise(function (resolve) {
    window.setTimeout(resolve, milliseconds);
  });
}

/**
 * 中文：把列表、搜索词和选择写入扩展本地存储，使弹窗被浏览器销毁后仍能恢复工作现场。
 *
 * English: Store the list, search term, and selections locally so the workspace survives browser popup destruction.
 */
function saveState() {
  return chrome.storage.local.set((function () {
    var record = {};
    record[STORAGE_KEY] = {
      items: state.items,
      selected: state.selected,
      owner: state.owner,
      search: elements.searchInput.value,
      delayRange: elements.delaySelect.value,
      savedAt: Date.now()
    };
    return record;
  }())).catch(function () {
    elements.statusBadge.textContent = '本地保存失败';
  });
}

/**
 * 中文：从扩展本地存储恢复上次界面状态，避免用户重新打开弹窗后看到空白内容。
 *
 * English: Restore the previous interface state from local extension storage so reopening the popup does not show an empty view.
 */
function restoreState() {
  return chrome.storage.local.get(STORAGE_KEY).then(function (result) {
    var saved = result ? result[STORAGE_KEY] : null;
    if (!saved || !Array.isArray(saved.items) || !saved.items.length) {
      updateSummary();
      return;
    }
    state.items = saved.items;
    state.selected = saved.selected && typeof saved.selected === 'object' ? saved.selected : {};
    state.owner = saved.owner || '';
    elements.searchInput.value = saved.search || '';
    if (saved.delayRange) {
      elements.delaySelect.value = saved.delayRange;
      updateDelayRisk();
    }
    elements.searchInput.disabled = false;
    elements.statusBadge.textContent = state.owner ? '已恢复：' + state.owner : '已恢复列表';
    renderList();
  }).catch(function () {
    elements.statusBadge.textContent = '恢复失败';
    updateSummary();
  });
}

/**
 * 中文：根据当前随机区间更新风险标签和说明，让用户在执行前持续感知速度代价。
 *
 * English: Update the risk label and guidance for the selected interval so users continuously see the cost of speed before execution.
 */
function updateDelayRisk() {
  var option = elements.delaySelect.options[elements.delaySelect.selectedIndex];
  var risk = option ? option.getAttribute('data-risk') : 'safe';
  var labels = { danger: '高风险', warning: '较高风险', normal: '常规', safe: '推荐' };
  var hints = {
    danger: '请求非常密集，明显更容易触发平台限制，仅建议极少量操作。',
    warning: '请求较密集，建议缩小单次选择数量并观察接口反馈。',
    normal: '速度与间隔较均衡，仍建议分批处理。',
    safe: '较平衡的默认选择，仍不能保证不会触发平台限制。'
  };
  elements.riskBadge.className = 'risk-badge ' + risk;
  elements.riskBadge.textContent = labels[risk] || labels.safe;
  elements.riskHint.textContent = hints[risk] || hints.safe;
}

/**
 * 中文：打开插件内确认弹窗并返回用户决定，以更清晰地呈现不可恢复性和风险等级。
 *
 * English: Open the in-extension confirmation dialog and return the user's decision with clearer irreversible-action and risk context.
 */
function openConfirmationDialog(selectedItems) {
  var option = elements.delaySelect.options[elements.delaySelect.selectedIndex];
  var risk = option ? option.getAttribute('data-risk') : 'safe';
  var riskLabels = { danger: '高风险', warning: '较高风险', normal: '常规', safe: '推荐' };
  elements.confirmCount.textContent = String(selectedItems.length) + ' 人';
  elements.confirmDelay.textContent = option ? option.textContent.split('·')[0].trim() : '-';
  elements.confirmRisk.textContent = riskLabels[risk] || '推荐';
  elements.confirmRisk.className = risk;
  elements.confirmPreview.innerHTML = selectedItems.slice(0, 20).map(function (item) {
    return '<span class="preview-user">' + escapeHtml(item.uname || String(item.mid)) + '</span>';
  }).join('') + (selectedItems.length > 20 ? '<span class="preview-user">另有 ' + (selectedItems.length - 20) + ' 人</span>' : '');
  elements.confirmCheckbox.checked = false;
  elements.acceptConfirmButton.disabled = true;
  elements.modalBackdrop.classList.remove('hidden');
  elements.confirmDialog.classList.remove('hidden');
  elements.resultDialog.classList.add('hidden');
  return new Promise(function (resolve) {
    state.confirmResolve = resolve;
  });
}

/**
 * 中文：关闭确认弹窗并结算用户选择，防止同一次确认被重复触发。
 *
 * English: Close the confirmation dialog and settle the user's choice so one confirmation cannot be triggered twice.
 */
function closeConfirmationDialog(accepted) {
  elements.confirmDialog.classList.add('hidden');
  elements.modalBackdrop.classList.add('hidden');
  if (state.confirmResolve) {
    var resolve = state.confirmResolve;
    state.confirmResolve = null;
    resolve(Boolean(accepted));
  }
}

/**
 * 中文：用插件内结果弹窗展示成功、失败与熔断信息，替代样式不可控的浏览器原生警告框。
 *
 * English: Show successes, failures, and circuit-break information in a styled in-extension result dialog instead of an unstyled browser alert.
 */
function showResultDialog(succeededCount, failed, stoppedEarly) {
  var hasFailure = failed.length > 0;
  elements.resultIcon.className = 'modal-icon result-icon' + (hasFailure ? ' error' : '');
  elements.resultIcon.textContent = hasFailure ? '!' : '✓';
  elements.resultTitle.textContent = stoppedEarly ? '任务已熔断停止' : (hasFailure ? '任务部分完成' : '任务完成');
  elements.resultMessage.textContent = '成功取消 ' + succeededCount + ' 人，失败 ' + failed.length + ' 人。' + (stoppedEarly ? ' 连续失败达到 3 次，插件已停止后续请求。' : '');
  if (hasFailure) {
    elements.resultDetails.textContent = failed.slice(0, 20).join('\n');
    elements.resultDetails.classList.remove('hidden');
  } else {
    elements.resultDetails.textContent = '';
    elements.resultDetails.classList.add('hidden');
  }
  elements.modalBackdrop.classList.remove('hidden');
  elements.resultDialog.classList.remove('hidden');
  elements.confirmDialog.classList.add('hidden');
}

/**
 * 中文：关闭任务结果弹窗，使用户返回已更新的关注列表继续核查。
 *
 * English: Close the task result dialog so the user can return to the updated following list for review.
 */
function closeResultDialog() {
  elements.resultDialog.classList.add('hidden');
  elements.modalBackdrop.classList.add('hidden');
}

/**
 * 中文：在给定区间内生成随机等待时间，让连续操作避免形成固定且密集的请求节奏。
 *
 * English: Generate a random wait within the given range so consecutive actions avoid a fixed, dense request rhythm.
 */
function getRandomDelay(rangeValue) {
  var parts = String(rangeValue || '2500,5500').split(',');
  var minimum = Number(parts[0]) || 2500;
  var maximum = Number(parts[1]) || 5500;
  return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
}

/**
 * 中文：取得当前活动标签页，确保所有账号操作只发生在用户正在查看的页面。
 *
 * English: Get the active tab so account actions only occur on the page the user is currently viewing.
 */
function getActiveTab() {
  return chrome.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
    if (!tabs.length || !tabs[0].id) {
      throw new Error('未找到当前标签页。');
    }
    if (!/^https:\/\/([^.]+\.)?bilibili\.com\//i.test(tabs[0].url || '')) {
      throw new Error('请先打开并登录 bilibili.com 页面。');
    }
    return tabs[0];
  });
}

/**
 * 中文：在 B 站页面主环境执行官方接口请求，以复用当前登录态且不读取或保存 Cookie。
 *
 * English: Run official API requests in the Bilibili page context to reuse login state without reading or storing cookies.
 */
function callPageApi(operation, payload) {
  return getActiveTab().then(function (tab) {
    return chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: pageApiBridge,
      args: [operation, payload || {}]
    });
  }).then(function (results) {
    var response = results && results[0] ? results[0].result : null;
    if (!response || !response.ok) {
      throw new Error(response && response.error ? response.error : '页面接口调用失败。');
    }
    return response.data;
  });
}

/**
 * 中文：封装在 B 站页面中运行的数据与关系操作，让浏览器自然携带该站点登录凭据。
 *
 * English: Encapsulate data and relation operations inside the Bilibili page so the browser naturally sends site credentials.
 */
async function pageApiBridge(operation, payload) {
  function readCookie(name) {
    var parts = document.cookie.split(';');
    var index;
    var pair;
    for (index = 0; index < parts.length; index += 1) {
      pair = parts[index].trim().split('=');
      if (pair.shift() === name) {
        return decodeURIComponent(pair.join('='));
      }
    }
    return '';
  }

  async function requestJson(url, options) {
    var response = await fetch(url, Object.assign({ credentials: 'include' }, options || {}));
    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }
    var json = await response.json();
    if (json.code !== 0) {
      throw new Error((json.message || '接口错误') + '（代码 ' + json.code + '）');
    }
    return json.data;
  }

  try {
    if (operation === 'load') {
      var nav = await requestJson('https://api.bilibili.com/x/web-interface/nav');
      if (!nav || !nav.isLogin) {
        throw new Error('当前 B 站账号尚未登录。');
      }
      var all = [];
      var page = 1;
      var pageSize = 50;
      var total = 0;
      do {
        var query = '?vmid=' + encodeURIComponent(nav.mid) + '&pn=' + page + '&ps=' + pageSize + '&order=desc';
        var result = await requestJson('https://api.bilibili.com/x/relation/followings' + query);
        var list = result && result.list ? result.list : [];
        total = result && result.total ? result.total : list.length;
        all = all.concat(list);
        page += 1;
        if (!list.length || page > 100) {
          break;
        }
      } while (all.length < total);
      return { ok: true, data: { owner: nav.uname, items: all, reportedTotal: total } };
    }

    if (operation === 'unfollow') {
      var csrf = readCookie('bili_jct');
      if (!csrf) {
        throw new Error('未找到 CSRF 凭据，请重新登录 B 站。');
      }
      var body = 'fid=' + encodeURIComponent(payload.mid) +
        '&act=2&re_src=11&csrf=' + encodeURIComponent(csrf);
      await requestJson('https://api.bilibili.com/x/relation/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body
      });
      return { ok: true, data: { mid: payload.mid } };
    }

    throw new Error('未知操作。');
  } catch (error) {
    return { ok: false, error: error && error.message ? error.message : String(error) };
  }
}

/**
 * 中文：按当前关键词生成可见列表，集中处理昵称、UID 与签名的模糊匹配。
 *
 * English: Build the visible list from the current keyword and centralize fuzzy matching across name, UID, and signature.
 */
function getVisibleItems() {
  var keyword = elements.searchInput.value.trim().toLowerCase();
  if (!keyword) {
    return state.items.slice();
  }
  return state.items.filter(function (item) {
    return [item.uname, item.mid, item.sign].some(function (value) {
      return String(value == null ? '' : value).toLowerCase().indexOf(keyword) !== -1;
    });
  });
}

/**
 * 中文：刷新计数与按钮状态，让界面始终反映当前选择和运行状态。
 *
 * English: Refresh counts and controls so the interface always reflects selection and execution state.
 */
function updateSummary() {
  var visible = getVisibleItems();
  var selectedIds = Object.keys(state.selected).filter(function (mid) { return state.selected[mid]; });
  var selectedVisible = visible.filter(function (item) { return Boolean(state.selected[String(item.mid)]); });
  elements.totalCount.textContent = String(state.items.length);
  elements.visibleCount.textContent = String(visible.length);
  elements.selectedCount.textContent = String(selectedIds.length);
  elements.selectVisible.checked = visible.length > 0 && selectedVisible.length === visible.length;
  elements.selectVisible.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visible.length;
  elements.unfollowButton.disabled = state.running || selectedIds.length === 0;
  elements.loadButton.disabled = state.running;
  elements.searchInput.disabled = state.running || state.items.length === 0;
}

/**
 * 中文：绘制当前关注列表，并用稳定 UID 保存跨搜索条件的勾选状态。
 *
 * English: Render the current following list and preserve selections across searches using stable UIDs.
 */
function renderList() {
  var visible = getVisibleItems();
  if (!visible.length) {
    elements.followingBody.innerHTML = '<tr><td colspan="4" class="empty">没有匹配的关注用户。</td></tr>';
    updateSummary();
    return;
  }
  elements.followingBody.innerHTML = visible.map(function (item) {
    var mid = String(item.mid);
    var relation = Number(item.attribute) === 6 ? '<span class="mutual">互相关注</span>' : '<span class="following">已关注</span>';
    return '<tr>' +
      '<td class="check-col"><input class="row-check" type="checkbox" data-mid="' + escapeHtml(mid) + '" ' + (state.selected[mid] ? 'checked' : '') + '></td>' +
      '<td title="' + escapeHtml(item.sign || '') + '"><span class="user"><img class="avatar" src="' + escapeHtml(item.face || '') + '" alt=""><span>' + escapeHtml(item.uname || '未命名用户') + '</span></span></td>' +
      '<td>' + escapeHtml(mid) + '</td>' +
      '<td>' + relation + '</td>' +
      '</tr>';
  }).join('');
  updateSummary();
}

/**
 * 中文：读取全部关注数据并初始化界面，为用户提供操作前的完整可核查清单。
 *
 * English: Load all following data and initialize the interface so users can review a complete list before acting.
 */
function loadFollowings() {
  elements.loadButton.disabled = true;
  elements.loadButton.textContent = '正在读取…';
  elements.statusBadge.textContent = '连接中';
  callPageApi('load').then(function (data) {
    state.items = data.items || [];
    state.selected = {};
    state.owner = data.owner || '';
    elements.searchInput.disabled = false;
    elements.statusBadge.textContent = state.owner ? '已登录：' + state.owner : '已连接';
    renderList();
    saveState();
  }).catch(function (error) {
    elements.statusBadge.textContent = '连接失败';
    elements.followingBody.innerHTML = '<tr><td colspan="4" class="empty">' + escapeHtml(error.message) + '</td></tr>';
  }).finally(function () {
    elements.loadButton.disabled = false;
    elements.loadButton.textContent = '重新读取';
    updateSummary();
  });
}

/**
 * 中文：按顺序执行取消关注并实时记录成功与失败，避免并发请求造成误操作或风控。
 *
 * English: Unfollow sequentially while reporting successes and failures to avoid concurrent mistakes or rate limits.
 */
async function unfollowSelected() {
  var selectedItems = state.items.filter(function (item) { return state.selected[String(item.mid)]; });
  if (!selectedItems.length) {
    return;
  }
  var confirmed = await openConfirmationDialog(selectedItems);
  if (!confirmed) {
    return;
  }

  state.running = true;
  elements.progressPanel.classList.remove('hidden');
  updateSummary();
  var succeeded = [];
  var failed = [];
  var consecutiveFailures = 0;
  var stoppedEarly = false;
  var index;

  for (index = 0; index < selectedItems.length; index += 1) {
    var item = selectedItems[index];
    elements.progressText.textContent = '正在处理 ' + (index + 1) + ' / ' + selectedItems.length + '：' + item.uname;
    elements.progressBar.style.width = Math.round(index / selectedItems.length * 100) + '%';
    try {
      await callPageApi('unfollow', { mid: item.mid });
      succeeded.push(String(item.mid));
      delete state.selected[String(item.mid)];
      consecutiveFailures = 0;
    } catch (error) {
      failed.push(item.uname + '：' + error.message);
      consecutiveFailures += 1;
      if (consecutiveFailures >= 3) {
        stoppedEarly = true;
        break;
      }
    }
    if (index < selectedItems.length - 1) {
      var delay = getRandomDelay(elements.delaySelect.value);
      elements.progressText.textContent = '已处理 ' + (index + 1) + ' / ' + selectedItems.length + '，随机等待 ' + (delay / 1000).toFixed(1) + ' 秒';
      await sleep(delay);
    }
  }

  state.items = state.items.filter(function (item) { return succeeded.indexOf(String(item.mid)) === -1; });
  state.running = false;
  elements.progressBar.style.width = stoppedEarly ? Math.round((index + 1) / selectedItems.length * 100) + '%' : '100%';
  elements.progressText.textContent = (stoppedEarly ? '已熔断停止' : '完成') + '：成功 ' + succeeded.length + '，失败 ' + failed.length;
  renderList();
  saveState();
  showResultDialog(succeeded.length, failed, stoppedEarly);
}

elements.loadButton.addEventListener('click', loadFollowings);
elements.searchInput.addEventListener('input', function () {
  renderList();
  saveState();
});
elements.selectVisible.addEventListener('change', function () {
  var checked = elements.selectVisible.checked;
  getVisibleItems().forEach(function (item) {
    state.selected[String(item.mid)] = checked;
  });
  renderList();
  saveState();
});
elements.followingBody.addEventListener('change', function (event) {
  if (event.target && event.target.classList.contains('row-check')) {
    state.selected[event.target.getAttribute('data-mid')] = event.target.checked;
    updateSummary();
    saveState();
  }
});
elements.delaySelect.addEventListener('change', function () {
  updateDelayRisk();
  saveState();
});
elements.unfollowButton.addEventListener('click', unfollowSelected);
elements.confirmCheckbox.addEventListener('change', function () {
  elements.acceptConfirmButton.disabled = !elements.confirmCheckbox.checked;
});
elements.cancelConfirmButton.addEventListener('click', function () {
  closeConfirmationDialog(false);
});
elements.acceptConfirmButton.addEventListener('click', function () {
  closeConfirmationDialog(true);
});
elements.closeResultButton.addEventListener('click', closeResultDialog);
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && !elements.confirmDialog.classList.contains('hidden')) {
    closeConfirmationDialog(false);
  } else if (event.key === 'Escape' && !elements.resultDialog.classList.contains('hidden')) {
    closeResultDialog();
  }
});
renderPluginMeta();
updateDelayRisk();
restoreState();
