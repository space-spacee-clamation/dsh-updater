/**
 * Locale dictionaries owned by the dsh-updater General-settings row.
 * Product copy is Chinese; `en` is a best-effort mirror.
 */

export const zh = {
  title: 'DeepSeek Harness 更新',
  desc: '自动检查 deepseek-harness 远端仓库；有新提交时点击更新即可克隆/拉取新内容，随后请重启 DSH。',
  details: '查看详情',
  repo: '远端仓库',
  branch: '跟踪分支',
  target: '本地目录',
  local: '本地提交',
  remote: '远端提交',
  lastChecked: '上次检查',
  updatedAt: '更新时间',
  statusUnknown: '尚未检查',
  statusChecking: '检查中…',
  statusUpdating: '更新中…',
  statusUpToDate: '已是最新',
  statusUpdateAvailable: '发现新版本',
  statusUpdated: '更新完成，等待重启',
  statusError: '检查/更新失败',
  check: '立即检查',
  update: '一键更新',
  checkingAction: '正在检查…',
  updatingAction: '正在更新…',
  updateConfirm: '将更新本地 deepseek-harness 工作区到远端最新提交。当前运行中的 DSH 不会被热替换，请确认更新后重启。继续？',
  restartBanner: '新的 harness 内容已写入本地目录。请重启 DSH 以加载新版本。',
  noError: '无',
  fetchFailed: '无法读取更新状态：',
} as const

export type LocaleKey = keyof typeof zh

export const en: Record<LocaleKey, string> = {
  title: 'DeepSeek Harness update',
  desc: 'The upstream deepseek-harness repository is checked automatically while the plugin is active. When a new commit exists, click update to clone/fetch the new content and then restart DSH.',
  details: 'Details',
  repo: 'Remote repository',
  branch: 'Tracking branch',
  target: 'Local directory',
  local: 'Local commit',
  remote: 'Remote commit',
  lastChecked: 'Last checked',
  updatedAt: 'Updated at',
  statusUnknown: 'Not checked yet',
  statusChecking: 'Checking…',
  statusUpdating: 'Updating…',
  statusUpToDate: 'Up to date',
  statusUpdateAvailable: 'Update available',
  statusUpdated: 'Updated; restart pending',
  statusError: 'Check/update failed',
  check: 'Check now',
  update: 'Update now',
  checkingAction: 'Checking…',
  updatingAction: 'Updating…',
  updateConfirm: 'The local deepseek-harness checkout will be moved to the latest remote commit. The running DSH is not hot-swapped; restart after the update. Continue?',
  restartBanner: 'New harness content has been written to the local checkout. Restart DSH to load it.',
  noError: 'None',
  fetchFailed: 'Cannot read update status: ',
}
