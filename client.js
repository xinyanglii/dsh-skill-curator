// Browser half of the Skill Curator: a first-class main panel opened from the
// left sidebar. The page answers three questions in reading order —
// what happened last, what skills exist, what each review changed — and hides
// protocol details behind one "Technical details" disclosure. Data comes from
// the Host routes registered by this same bundle's host half.
window.__ModuleLoader__.load({
  id: 'dsh-skill-curator',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    const API = '/skill-curator/api'
    const POLL_MS = 5000

    const EN = {
      panelLabel: 'Skill Curator',
      title: 'Skill Curator',
      statusOn: 'Auto-review on',
      statusOff: 'Paused',
      reviewing: 'reviewing now',
      curatorRunning: 'tidying now',
      refresh: 'Refresh',
      loading: 'Loading…',
      error: 'Could not read the curator state.',
      retry: 'Retry',
      heroKickerLast: 'Last review',
      heroKickerNone: 'Learning status',
      heroNoneTitle: 'No reviews yet',
      heroNoneDetail: '—',
      heroCompleted: 'completed',
      heroFailed: 'failed',
      heroUpdated: 'Updated {names}',
      heroNoChanges: 'No skill changes',
      heroFailedDetail: 'Last attempt failed',
      heroPending: 'In progress',
      heroPendingDetail: '{iters}/{threshold}',
      kpiSkills: 'Skills',
      kpiReviews: 'Reviews',
      kpiChanges: 'Skill writes',
      kpiCurator: 'Next clean-up',
      kpiSkillsSub: '{active} active · {stale} idle · {archived} archived',
      kpiReviewsSub: 'last {time}',
      kpiChangesSub: 'last: {name}',
      kpiCuratorSub: 'every {n} days',
      kpiFailedSub: '{n} failed',
      never: '—',
      notRun: 'Not run yet',
      dueNow: 'Due now',
      sectionSkills: 'Skills',
      sectionLearning: 'Recent learning',
      sectionActivity: 'Last 14 days',
      sectionConfig: 'Configuration',
      cfgPlugin: 'Plugin',
      cfgReview: 'Review',
      cfgCurator: 'Curator',
      cfgConsolidation: 'Consolidation',
      cfgPaths: 'Paths',
      cfgAutoReview: 'Auto-review',
      cfgThreshold: 'Threshold',
      cfgReviewPreset: 'Reviewer preset',
      cfgReviewTimeout: 'Review timeout',
      cfgTranscriptLimit: 'Transcript limit',
      cfgFailed: 'Failed reviews',
      cfgCuratorInterval: 'Curator interval',
      cfgStaleArchive: 'Stale / archive',
      cfgConsolidate: 'Consolidation',
      cfgConsolidatePreset: 'Consolidation preset',
      cfgConsolidateTimeout: 'Consolidation timeout',
      cfgBackupKeep: 'Backups kept',
      cfgLastConsolidation: 'Last consolidation',
      cfgLibrary: 'Library',
      cfgStateLog: 'State and log',
      cfgSkillctl: 'skillctl',
      cfgChars: '{n} chars',
      cfgIterations: '{n} iterations',
      cfgTimeoutMinutes: '{n}m',
      cfgOn: 'On',
      cfgOff: 'Off',
      cfgNever: 'Never',
      sectionAdvanced: 'Technical details',
      filterAll: 'All',
      filterActive: 'Active',
      filterIdle: 'Idle',
      filterArchived: 'Archived',
      stateActive: 'active',
      stateStale: 'idle',
      stateArchived: 'archived',
      lastUsedPrefix: 'used {time} ago',
      neverUsed: 'never used',
      learnCompleted: 'Completed',
      learnFailed: 'Failed',
      learnUpdated: 'Updated {names}',
      learnNoChanges: 'No skill changes',
      detailsLabel: 'Note',
      emptySkills: 'No skills yet.',
      emptyFilter: 'No matches.',
      emptyLearning: 'No reviews yet.',
      skillPath: 'Path',
      skillSha: 'SHA-256',
      skillFiles: 'Support files',
      skillClose: 'Close',
      skillError: 'Could not read this skill.',
      skillFilesNone: 'none',
      advLedger: 'Recent writes',
      opCreate: 'new',
      opPatch: 'edit',
      opWriteFile: 'file',
      opArchive: 'archive',
      opOther: 'change',
      ledgerEmpty: 'No writes yet.',
    }

    const ZH = {
      panelLabel: '技能策展',
      title: '技能策展',
      statusOn: '自动复盘',
      statusOff: '已暂停',
      reviewing: '正在复盘',
      curatorRunning: '正在整理',
      refresh: '刷新',
      loading: '加载中…',
      error: '读取策展状态失败。',
      retry: '重试',
      heroKickerLast: '最近一次复盘',
      heroKickerNone: '学习状态',
      heroNoneTitle: '还没有复盘',
      heroNoneDetail: '—',
      heroCompleted: '已完成',
      heroFailed: '失败',
      heroUpdated: '更新了 {names}',
      heroNoChanges: '这次没有写入技能',
      heroFailedDetail: '上次尝试失败',
      heroPending: '进行中',
      heroPendingDetail: '{iters}/{threshold}',
      kpiSkills: '技能',
      kpiReviews: '复盘',
      kpiChanges: '技能写入',
      kpiCurator: '下次整理',
      kpiSkillsSub: '{active} 活跃 · {stale} 闲置 · {archived} 已归档',
      kpiReviewsSub: '上次 {time}',
      kpiChangesSub: '最近：{name}',
      kpiCuratorSub: '每 {n} 天',
      kpiFailedSub: '{n} 次失败',
      never: '—',
      notRun: '尚未运行',
      dueNow: '即将运行',
      sectionSkills: '技能库',
      sectionLearning: '最近学习',
      sectionActivity: '最近 14 天',
      sectionConfig: '配置',
      cfgPlugin: '插件',
      cfgReview: '复盘',
      cfgCurator: '技能整理',
      cfgConsolidation: '合并',
      cfgPaths: '路径',
      cfgAutoReview: '自动复盘',
      cfgThreshold: '阈值',
      cfgReviewPreset: '复审 preset',
      cfgReviewTimeout: '复审超时',
      cfgTranscriptLimit: '转录上限',
      cfgFailed: '失败次数',
      cfgCuratorInterval: '整理间隔',
      cfgStaleArchive: '闲置 / 归档',
      cfgConsolidate: '合并 pass',
      cfgConsolidatePreset: '合并 preset',
      cfgConsolidateTimeout: '合并超时',
      cfgBackupKeep: '保留备份',
      cfgLastConsolidation: '上次合并',
      cfgLibrary: '技能库',
      cfgStateLog: '状态与日志',
      cfgSkillctl: 'skillctl',
      cfgChars: '{n} 字符',
      cfgIterations: '{n} 步',
      cfgTimeoutMinutes: '{n} 分钟',
      cfgOn: '开启',
      cfgOff: '关闭',
      cfgNever: '从未',
      sectionAdvanced: '技术细节',
      filterAll: '全部',
      filterActive: '活跃',
      filterIdle: '闲置',
      filterArchived: '归档',
      stateActive: '活跃',
      stateStale: '闲置',
      stateArchived: '归档',
      lastUsedPrefix: '{time} 前用过',
      neverUsed: '未使用',
      learnCompleted: '已完成',
      learnFailed: '失败',
      learnUpdated: '更新了 {names}',
      learnNoChanges: '没有写入技能',
      detailsLabel: '说明',
      emptySkills: '还没有技能。',
      emptyFilter: '没有匹配项。',
      emptyLearning: '还没有复盘。',
      skillPath: '路径',
      skillSha: 'SHA-256',
      skillFiles: '附属文件',
      skillClose: '关闭',
      skillError: '读取该技能失败。',
      skillFilesNone: '无',
      advLedger: '最近写入',
      opCreate: '新建',
      opPatch: '修改',
      opWriteFile: '文件',
      opArchive: '归档',
      opOther: '变更',
      ledgerEmpty: '还没有写入。',
    }

    const CSS = `
.sc-shell{height:100%;overflow-y:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);-webkit-font-smoothing:antialiased}
.sc-page{max-width:980px;margin:0 auto;padding:52px 32px 80px;display:flex;flex-direction:column;gap:30px;box-sizing:border-box;font-size:13px;line-height:1.55}
.sc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:24px}
.sc-title{font-size:22px;font-weight:600;margin:0;letter-spacing:-.01em}
.sc-sub{font-size:13px;color:var(--dsw-alias-label-secondary);margin-top:6px;max-width:640px}
.sc-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;padding-top:2px}
.sc-status{display:inline-flex;align-items:center;gap:7px;font-size:12px;padding:5px 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);white-space:nowrap}
.sc-dot{width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex-shrink:0;display:inline-block}
.sc-dot-on{background:var(--dsw-alias-state-success-primary)}
.sc-dot-warn{background:var(--dsw-alias-state-warn-primary)}
.sc-dot-error{background:var(--dsw-alias-state-error-primary)}
.sc-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:9px;padding:6px 13px;font-size:12px;cursor:pointer;line-height:1.4}
.sc-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.sc-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:center;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-left:3px solid var(--dsw-alias-border-l1);border-radius:16px;padding:20px 22px}
.sc-hero-ok{border-left-color:var(--dsw-alias-state-success-primary)}
.sc-hero-failed{border-color:var(--dsw-alias-state-error-primary);border-left-color:var(--dsw-alias-state-error-primary)}
.sc-kicker{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.sc-kicker-failed{color:var(--dsw-alias-state-error-primary)}
.sc-hero-title{font-size:18px;font-weight:600;margin-top:5px}
.sc-hero-detail{font-size:13px;margin-top:5px}
.sc-hero-detail-failed{color:var(--dsw-alias-state-error-primary)}
.sc-hero-hint{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:6px}
.sc-hero-chip{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 10px;margin-top:10px;width:fit-content}
.sc-hero-side{text-align:right;flex-shrink:0}
.sc-hero-number{font-size:32px;font-weight:600;line-height:1.05;letter-spacing:-.02em}
.sc-hero-number-label{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:2px}
.sc-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
@media(max-width:820px){.sc-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
.sc-kpi{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;padding:14px 16px;display:flex;flex-direction:column;gap:5px;min-width:0}
.sc-kpi-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.sc-kpi-value{font-size:24px;font-weight:600;line-height:1.15;letter-spacing:-.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sc-kpi-sub{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sc-stack{display:flex;height:5px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-bg-layer-2);margin-top:2px}
.sc-stack span{height:100%}
.sc-section{display:flex;flex-direction:column;gap:10px}
.sc-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.sc-section-title{font-size:14px;font-weight:600;margin:0}
.sc-section-hint{font-size:12px;color:var(--dsw-alias-label-secondary)}
.sc-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;overflow:hidden}
.sc-chips{display:flex;gap:6px;flex-wrap:wrap;padding:2px 18px 10px}
.sc-chip{font-size:11px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:2px 10px;cursor:pointer}
.sc-chip:hover{color:var(--dsw-alias-label-primary)}
.sc-chip-on{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.sc-skill{display:flex;align-items:center;gap:14px;padding:12px 18px;border-top:1px solid var(--dsw-alias-border-l1);cursor:pointer;min-width:0}
.sc-skill:first-of-type{border-top:none}
.sc-skill:hover{background:var(--dsw-alias-bg-layer-2)}
.sc-skill-main{flex:1;min-width:0}
.sc-skill-name{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;font-weight:600;display:flex;align-items:center;gap:7px;min-width:0}
.sc-skill-name span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-state-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;display:inline-block}
.sc-state-dot-active{background:var(--dsw-alias-state-success-primary)}
.sc-state-dot-stale{background:var(--dsw-alias-state-warn-primary)}
.sc-state-dot-archived{background:var(--dsw-alias-state-idle-primary)}
.sc-skill-desc{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-skill-side{display:flex;align-items:center;gap:14px;flex-shrink:0;font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.sc-chevron{font-size:16px;color:var(--dsw-alias-label-secondary);line-height:1}
.sc-pill{display:inline-flex;align-items:center;font-size:10.5px;line-height:1.6;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.sc-pill-active{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.sc-pill-stale{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.sc-pill-archived{color:var(--dsw-alias-state-idle-primary);border-color:var(--dsw-alias-border-l2)}
.sc-pill-brand{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.sc-pill-error{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.sc-empty{padding:24px 18px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12px}
.sc-learn{display:grid;grid-template-columns:104px minmax(0,1fr);gap:16px;padding:13px 18px;border-top:1px solid var(--dsw-alias-border-l1);align-items:start}
.sc-learn:first-of-type{border-top:none}
.sc-learn-time{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.sc-learn-title{font-size:12.5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sc-learn-meta{font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:3px}
.sc-details{margin-top:6px}
.sc-details summary{display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 10px;list-style:none;user-select:none;width:fit-content}
.sc-details summary::-webkit-details-marker{display:none}
.sc-details summary::before{content:'▸';font-size:10px;line-height:1;transition:transform .12s}
.sc-details[open] summary::before{transform:rotate(90deg)}
.sc-details[open] summary{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.sc-note{margin-top:8px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px 14px;font-size:12.5px;line-height:1.65;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.sc-note-p{margin:0 0 8px}
.sc-note-p:last-child{margin-bottom:0}
.sc-note-head{font-size:13px;font-weight:600;margin:2px 0 6px}
.sc-note-subhead{font-weight:600;margin:10px 0 4px}
.sc-note-list{margin:0 0 8px;padding-left:18px}
.sc-note-list:last-child{margin-bottom:0}
.sc-note-list li{margin:2px 0}
.sc-note-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:var(--dsw-alias-bg-layer-2);border-radius:4px;padding:1px 4px}
.sc-note-quote{margin:0 0 8px;padding-left:10px;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.sc-pre{margin:6px 0 0;white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px;font-size:12px;line-height:1.55;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--dsw-alias-label-primary);max-height:280px;overflow:auto}
.sc-chart{display:flex;align-items:flex-end;gap:4px;height:110px;padding:8px 18px 0}
.sc-chart-col{flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:2px;min-width:0;height:100%;position:relative}
.sc-chart-track{position:absolute;inset:0;border-radius:3px;background:var(--dsw-alias-bg-layer-2);opacity:.4;pointer-events:none}
.sc-chart-bars{display:flex;align-items:flex-end;gap:2px;height:100%;position:relative;z-index:1}
.sc-chart-bar{flex:1;border-radius:2px 2px 0 0;min-height:0;background:var(--dsw-alias-label-primary);opacity:.75}
.sc-chart-bar-alt{background:var(--dsw-alias-state-success-primary);opacity:1}
.sc-chart-labels{display:flex;gap:4px;padding:6px 18px 2px}
.sc-chart-label{flex:1;text-align:center;font-size:9.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;white-space:nowrap}
.sc-legend{display:flex;align-items:center;gap:14px;font-size:11px;color:var(--dsw-alias-label-secondary);padding:6px 18px 14px}
.sc-legend span{display:inline-flex;align-items:center;gap:5px}
.sc-legend i{width:8px;height:8px;border-radius:2px;display:inline-block}
.sc-error{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:12px;color:var(--dsw-alias-state-error-primary);font-size:12px}
.sc-config-card{padding:16px 18px}
.sc-config{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px 28px}
@media(max-width:760px){.sc-config{grid-template-columns:1fr}}
.sc-config-group-wide{grid-column:1/-1}
.sc-config-title{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);margin-bottom:6px}
.sc-config-list{display:grid;grid-template-columns:150px minmax(0,1fr);gap:5px 14px;margin:0;font-size:12px}
.sc-config-list dt{color:var(--dsw-alias-label-secondary)}
.sc-config-list dd{margin:0;overflow-wrap:anywhere}
.sc-advanced{border-top:1px solid var(--dsw-alias-border-l1);padding-top:14px}
.sc-advanced summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary);list-style:none}
.sc-advanced summary::-webkit-details-marker{display:none}
.sc-advanced summary::before{content:'▸ ';display:inline-block;transition:transform .12s}
.sc-advanced[open] summary::before{content:'▾ '}
.sc-adv-grid{display:grid;grid-template-columns:150px minmax(0,1fr);gap:6px 14px;font-size:12px;padding:14px 0 6px;margin:0}
.sc-adv-grid dt{color:var(--dsw-alias-label-secondary)}
.sc-adv-grid dd{margin:0;word-break:break-all}
.sc-adv-ledger{margin-top:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden}
.sc-adv-row{display:grid;grid-template-columns:64px minmax(0,1fr) auto;gap:12px;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12px;align-items:center}
.sc-adv-row:first-child{border-top:none}
.sc-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.sc-footer{font-size:11px;color:var(--dsw-alias-label-secondary);text-align:center;padding-top:6px}
.sc-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:48px;z-index:1200}
.sc-modal{width:min(920px,100%);max-height:82vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:16px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.45)}
.sc-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:18px 22px 12px}
.sc-modal-title{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:15px;font-weight:600;margin:0}
.sc-modal-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:4px}
.sc-modal-meta{display:grid;grid-template-columns:96px minmax(0,1fr);gap:3px 12px;font-size:11.5px;padding:0 22px 8px;margin:0}
.sc-modal-meta dt{color:var(--dsw-alias-label-secondary)}
.sc-modal-meta dd{margin:0;word-break:break-all}
.sc-modal-body{overflow:auto;padding:0 22px 22px}
.sc-skeleton{color:var(--dsw-alias-label-secondary);font-size:12px;padding:16px 0}
`

    function fmtTime(value) {
      const ms = typeof value === 'number' ? value : Date.parse(value)
      if (!Number.isFinite(ms) || ms <= 0) return null
      const d = new Date(ms)
      const pad = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    function relative(value) {
      const ms = typeof value === 'number' ? value : Date.parse(value)
      if (!Number.isFinite(ms) || ms <= 0) return null
      const diff = Date.now() - ms
      if (diff < 0) {
        const ahead = -diff
        if (ahead < 3600000) return `${Math.max(1, Math.round(ahead / 60000))}m`
        if (ahead < 86400000) return `${Math.round(ahead / 3600000)}h`
        return `${(ahead / 86400000).toFixed(1)}d`
      }
      if (diff < 60000) return '<1m'
      const minutes = Math.floor(diff / 60000)
      if (minutes < 60) return `${minutes}m`
      const hours = Math.floor(minutes / 60)
      if (hours < 48) return `${hours}h`
      return `${Math.floor(hours / 24)}d`
    }


    function fill(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (_match, key) => (values && key in values ? String(values[key]) : `{${key}}`))
    }

    // Minimal Markdown for the reviewer note: bold, inline code, bullets,
    // numbered items, headings and quotes. Renders React nodes (never raw HTML),
    // so model output stays text.
    function renderInline(text, keyPrefix) {
      const parts = String(text).split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
      return parts.map((part, index) => {
        if (!part) return null
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return h('strong', { key: `${keyPrefix}-b-${index}` }, part.slice(2, -2))
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return h('code', { className: 'sc-note-code', key: `${keyPrefix}-c-${index}` }, part.slice(1, -1))
        }
        return part
      })
    }

    function renderReviewerNote(text) {
      const lines = String(text || '').split(/\r?\n/)
      const blocks = []
      let paragraph = []
      let list = null
      const flushParagraph = () => {
        if (paragraph.length === 0) return
        const content = paragraph.join(' ')
        paragraph = []
        blocks.push(h('p', { className: 'sc-note-p', key: `p-${blocks.length}` }, renderInline(content, `p-${blocks.length}`)))
      }
      const flushList = () => {
        if (!list || list.length === 0) return
        const items = list
        list = null
        blocks.push(h('ul', { className: 'sc-note-list', key: `u-${blocks.length}` },
          items.map((item, index) => h('li', { key: `li-${blocks.length}-${index}` }, renderInline(item, `li-${blocks.length}-${index}`)))))
      }
      for (const raw of lines) {
        const line = raw.trim()
        if (!line) {
          flushParagraph()
          flushList()
          continue
        }
        const heading = /^(#{1,4})\s+(.*)$/.exec(line)
        if (heading) {
          flushParagraph()
          flushList()
          blocks.push(h('div', { className: 'sc-note-head', key: `h-${blocks.length}` }, renderInline(heading[2], `h-${blocks.length}`)))
          continue
        }
        const bullet = /^[-*]\s+(.*)$/.exec(line)
        if (bullet) {
          flushParagraph()
          if (!list) list = []
          list.push(bullet[1])
          continue
        }
        const numbered = /^\d+[.)]\s+(.*)$/.exec(line)
        if (numbered) {
          flushParagraph()
          if (!list) list = []
          list.push(numbered[1])
          continue
        }
        const quote = /^>\s?(.*)$/.exec(line)
        if (quote) {
          flushParagraph()
          flushList()
          blocks.push(h('div', { className: 'sc-note-quote', key: `q-${blocks.length}` }, renderInline(quote[1], `q-${blocks.length}`)))
          continue
        }
        const boldLine = /^\*\*(.+)\*\*$/.exec(line)
        if (boldLine) {
          flushParagraph()
          flushList()
          blocks.push(h('div', { className: 'sc-note-subhead', key: `s-${blocks.length}` }, renderInline(boldLine[1], `s-${blocks.length}`)))
          continue
        }
        if (list) {
          flushList()
        }
        paragraph.push(line)
      }
      flushParagraph()
      flushList()
      return blocks
    }

    function stateClass(state) {
      if (state === 'stale') return 'sc-pill sc-pill-stale'
      if (state === 'archived') return 'sc-pill sc-pill-archived'
      return 'sc-pill sc-pill-active'
    }

    function stateLabel(state, t) {
      if (state === 'stale') return t('stateStale')
      if (state === 'archived') return t('stateArchived')
      return t('stateActive')
    }

    const COLORS = {
      success: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      idle: 'var(--dsw-alias-state-idle-primary)',
    }

    function PanelIcon(props) {
      const size = (props && props.size) || 18
      const color = props && props.active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)'
      return h('svg', { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': true, style: { color, display: 'block' } },
        h('path', {
          d: 'M4.2 3.4h7.2a2 2 0 0 1 2 2v.7H6.4a1.7 1.7 0 0 0-1.7 1.7v7.8H4.2a1.6 1.6 0 0 1-1.6-1.6V5a1.6 1.6 0 0 1 1.6-1.6z',
          stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M6.4 6.9h9.1v7.5a1.6 1.6 0 0 1-1.6 1.6H6.4a1.6 1.6 0 0 1-1.6-1.6V8.5a1.6 1.6 0 0 1 1.6-1.6z',
          stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round',
        }),
        h('path', { d: 'M7.6 9.6h6.4M7.6 12h6.4M7.6 14.4h4.2', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round' }),
        h('path', { d: 'M15.6 2.2l.55 1.5 1.5.55-1.5.55-.55 1.5-.55-1.5-1.5-.55 1.5-.55z', fill: COLORS.warn }))
    }

    function Kpi(props) {
      return h('div', { className: 'sc-kpi' },
        h('div', { className: 'sc-kpi-label' }, props.label),
        h('div', { className: 'sc-kpi-value' }, props.value),
        props.children || null,
        props.sub ? h('div', { className: 'sc-kpi-sub' }, props.sub) : null)
    }

    function StateStack(props) {
      const total = Math.max(1, props.active + props.stale + props.archived)
      return h('div', { className: 'sc-stack' },
        props.active > 0 ? h('span', { style: { width: `${(props.active / total) * 100}%`, background: COLORS.success } }) : null,
        props.stale > 0 ? h('span', { style: { width: `${(props.stale / total) * 100}%`, background: COLORS.warn } }) : null,
        props.archived > 0 ? h('span', { style: { width: `${(props.archived / total) * 100}%`, background: COLORS.idle } }) : null)
    }

    function Section(props) {
      return h('section', { className: 'sc-section' },
        h('div', { className: 'sc-section-head' },
          h('h2', { className: 'sc-section-title' }, props.title),
          props.hint ? h('span', { className: 'sc-section-hint' }, props.hint) : null),
        props.children)
    }

    function SkillRow(props) {
      const { skill, t } = props
      const last = relative(skill.lastUsed)
      return h('div', {
        className: 'sc-skill',
        onClick: props.onOpen,
        role: 'button',
        tabIndex: 0,
        onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onOpen() } },
      },
        h('div', { className: 'sc-skill-main' },
          h('div', { className: 'sc-skill-name' },
            h('span', { className: `sc-state-dot ${skill.state === 'stale' ? 'sc-state-dot-stale' : skill.state === 'archived' ? 'sc-state-dot-archived' : 'sc-state-dot-active'}` }),
            h('span', null, skill.name),
            skill.pinned ? h('span', { className: 'sc-pill sc-pill-brand' }, 'pinned') : null),
          h('div', { className: 'sc-skill-desc' }, skill.description || '')),
        h('div', { className: 'sc-skill-side' },
          h('span', { className: stateClass(skill.state) }, stateLabel(skill.state, t)),
          h('span', null, last ? fill(t('lastUsedPrefix'), { time: last }) : t('neverUsed')),
          h('span', { className: 'sc-chevron', 'aria-hidden': true }, '›')))
    }

    function LearningRow(props) {
      const { item, t } = props
      const when = relative(item.ts)
      const failed = item.status === 'failed' || (item.status !== 'completed' && item.status !== 'unknown')
      const changed = Array.isArray(item.changes) ? item.changes : []
      return h('div', { className: 'sc-learn' },
        h('div', { className: 'sc-learn-time', title: fmtTime(item.ts) || '' },
          when ? `${when} ago` : t('never'),
          h('div', { style: { marginTop: 2 } }, fmtTime(item.ts) || '')),
        h('div', null,
          h('div', { className: 'sc-learn-title' },
            h('span', { className: `sc-pill ${failed ? 'sc-pill-error' : 'sc-pill-active'}` }, failed ? t('learnFailed') : t('learnCompleted')),
            h('span', null, changed.length > 0 ? fill(t('learnUpdated'), { names: changed.slice(0, 3).join(', ') + (changed.length > 3 ? ` +${changed.length - 3}` : '') }) : t('learnNoChanges'))),
          item.summary ? h('details', { className: 'sc-details' },
            h('summary', null, t('detailsLabel')),
            h('div', { className: 'sc-note' }, renderReviewerNote(item.summary))) : null))
    }

    function Cadence(props) {
      const { activity, t } = props
      const rows = activity || []
      if (rows.length === 0) return h('div', { className: 'sc-empty' }, t('emptyLearning'))
      let max = 1
      for (const row of rows) max = Math.max(max, row.reviews, row.changes)
      return h('div', null,
        h('div', { className: 'sc-chart' }, rows.map((row) => h('div', {
          className: 'sc-chart-col',
          key: row.date,
          title: `${row.date} · ${row.reviews} reviews · ${row.changes} updates`,
        },
          h('div', { className: 'sc-chart-track' }),
          h('div', { className: 'sc-chart-bars' },
            h('div', { className: 'sc-chart-bar', style: { height: `${Math.max(row.reviews > 0 ? 6 : 0, (row.reviews / max) * 100)}%` } }),
            h('div', { className: 'sc-chart-bar sc-chart-bar-alt', style: { height: `${Math.max(row.changes > 0 ? 6 : 0, (row.changes / max) * 100)}%` } }))))),
        h('div', { className: 'sc-chart-labels' }, rows.map((row, index) => h('div', { className: 'sc-chart-label', key: row.date },
          index % 3 === 0 ? row.date.slice(5) : ''))),
        h('div', { className: 'sc-legend' },
          h('span', null, h('i', { style: { background: 'var(--dsw-alias-label-primary)', opacity: 0.75 } }), t('kpiReviews')),
          h('span', null, h('i', { style: { background: COLORS.success } }), t('kpiChanges'))))
    }

    function Configuration(props) {
      const { data, t } = props
      const config = data.config || {}
      const runtime = data.runtime || {}
      const stats = data.stats || {}
      const onOff = (value) => (value ? t('cfgOn') : t('cfgOff'))
      const minutes = (ms) => fill(t('cfgTimeoutMinutes'), { n: Math.max(1, Math.round((Number(ms) || 0) / 60000)) })
      const group = (title, pairs, wide = false) =>
        h('div', { className: `sc-config-group${wide ? ' sc-config-group-wide' : ''}`, key: title },
          h('div', { className: 'sc-config-title' }, title),
          h('dl', { className: 'sc-config-list' },
            pairs.flatMap(([label, value, mono], index) => [
              h('dt', { key: `l-${index}` }, label),
              h('dd', { key: `v-${index}`, className: mono ? 'sc-mono' : undefined }, value),
            ])))
      const lastConsolidation = runtime.lastConsolidateAt
        ? `${relative(runtime.lastConsolidateAt)} ago${runtime.lastConsolidateSummary ? ` · ${runtime.lastConsolidateSummary}` : ''}`
        : t('cfgNever')
      return h('div', { className: 'sc-card sc-config-card' },
        h('div', { className: 'sc-config' },
          group(t('cfgReview'), [
            [t('cfgPlugin'), onOff(config.enabled !== false)],
            [t('cfgAutoReview'), onOff(config.reviewEnabled !== false)],
            [t('cfgThreshold'), fill(t('cfgIterations'), { n: config.threshold || 10 })],
            [t('cfgReviewPreset'), `${config.reviewPreset || 'skill-review'} (${config.reviewProvider || 'spawn'})`, true],
            [t('cfgReviewTimeout'), minutes(config.reviewTimeoutMs)],
            [t('cfgTranscriptLimit'), fill(t('cfgChars'), { n: Number(config.maxTranscriptChars) || 40000 })],
            [t('cfgFailed'), String(stats.reviewFailed || 0)],
          ]),
          group(t('cfgCurator'), [
            [t('cfgCurator'), onOff(config.curatorEnabled !== false)],
            [t('cfgCuratorInterval'), fill(t('kpiCuratorSub'), { n: config.curatorEveryDays || 7 })],
            [t('cfgStaleArchive'), `${config.staleDays || 14}d / ${config.archiveDays || 30}d`],
          ]),
          group(t('cfgConsolidation'), [
            [t('cfgConsolidate'), onOff(config.consolidateEnabled === true)],
            [t('cfgConsolidatePreset'), config.consolidatePreset || 'skill-consolidate', true],
            [t('cfgConsolidateTimeout'), minutes(config.consolidateTimeoutMs)],
            [t('cfgBackupKeep'), String(config.consolidateBackupKeep || 2)],
            [t('cfgLastConsolidation'), lastConsolidation],
          ]),
          group(t('cfgPaths'), [
            [t('cfgLibrary'), config.skillsRoot || '', true],
            [t('cfgStateLog'), `${config.stateDir || ''} · ${config.logPath || ''}`, true],
            [t('cfgSkillctl'), config.skillctl || '', true],
          ], true)))
    }

    function Advanced(props) {
      const { data, t } = props
      const ledger = data.ledger || []
      const opLabel = (op) => (op === 'create' ? t('opCreate') : op === 'patch' ? t('opPatch') : op === 'write_file' ? t('opWriteFile') : op === 'archive' ? t('opArchive') : t('opOther'))
      return h('details', { className: 'sc-advanced' },
        h('summary', null, t('sectionAdvanced')),
        h('div', { style: { marginTop: 14 } },
          h('div', { className: 'sc-section-hint', style: { marginBottom: 6 } }, t('advLedger')),
          ledger.length === 0
            ? h('div', { className: 'sc-empty', style: { padding: '12px 0' } }, t('ledgerEmpty'))
            : h('div', { className: 'sc-adv-ledger' }, ledger.slice(0, 10).map((row) => h('div', { className: 'sc-adv-row', key: row.id },
                h('span', { className: 'sc-pill sc-pill-archived' }, opLabel(row.op)),
                h('span', { className: 'sc-mono' }, row.name || '?'),
                h('span', { className: 'sc-section-hint' }, fmtTime(row.ts) || ''))))))
    }

    function SkillModal(props) {
      const { skill, detail, loading, error, onClose, t } = props
      const dialogRef = useRef(null)
      const restoreRef = useRef(null)

      useEffect(() => {
        restoreRef.current = typeof document !== 'undefined' ? document.activeElement : null
        const node = dialogRef.current
        if (node) {
          try {
            node.focus()
          } catch {
            /* not focusable */
          }
        }
        return () => {
          const previous = restoreRef.current
          if (previous && typeof previous.focus === 'function') {
            try {
              previous.focus()
            } catch {
              /* row unmounted */
            }
          }
        }
      }, [])

      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
            return
          }
          if (event.key !== 'Tab') return
          const node = dialogRef.current
          if (!node) return
          const focusable = [...node.querySelectorAll('button, [tabindex="0"]')].filter((element) => !element.disabled)
          if (focusable.length === 0) return
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          const active = document.activeElement
          if (event.shiftKey && (active === first || !node.contains(active))) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && (active === last || !node.contains(active))) {
            event.preventDefault()
            first.focus()
          }
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
      }, [onClose])

      const body = loading
        ? h('div', { className: 'sc-skeleton' }, t('loading'))
        : error
          ? h('div', { className: 'sc-error' }, h('span', null, `${t('skillError')} ${error}`))
          : detail
            ? h(React.Fragment, null,
                h('dl', { className: 'sc-modal-meta' },
                  h('dt', null, t('skillPath')), h('dd', { className: 'sc-mono' }, detail.path),
                  h('dt', null, t('skillSha')), h('dd', { className: 'sc-mono' }, detail.sha256),
                  h('dt', null, t('skillFiles')), h('dd', { className: 'sc-mono' },
                    detail.supportFiles && detail.supportFiles.length ? detail.supportFiles.join(', ') : t('skillFilesNone'))),
                h('pre', { className: 'sc-pre', tabIndex: 0 }, detail.content))
            : null
      return h('div', {
        className: 'sc-modal-backdrop',
        onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() },
      },
        h('div', {
          className: 'sc-modal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': skill.name,
          tabIndex: -1,
          ref: dialogRef,
        },
          h('div', { className: 'sc-modal-head' },
            h('div', null,
              h('h3', { className: 'sc-modal-title' }, skill.name),
              h('div', { className: 'sc-modal-sub' }, skill.description || '')),
            h('button', { className: 'sc-btn', onClick: onClose }, t('skillClose'))),
          h('div', { className: 'sc-modal-body' }, body)))
    }

    function useDashboard() {
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(true)
      const inFlight = useRef(null)
      const mounted = useRef(true)
      const latestGenerated = useRef(0)

      const load = useCallback(async () => {
        if (inFlight.current) return
        const controller = new AbortController()
        inFlight.current = controller
        const timer = setTimeout(() => {
          try {
            controller.abort()
          } catch {
            /* already aborted */
          }
        }, 15000)
        try {
          const response = await fetch(`${API}/state`, {
            headers: { accept: 'application/json' },
            signal: controller.signal,
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = await response.json()
          if (!mounted.current) return
          const generatedAt = Number(payload && payload.generatedAt) || 0
          if (generatedAt >= latestGenerated.current) {
            latestGenerated.current = generatedAt
            setData(payload)
            setError(null)
          }
        } catch (cause) {
          if (mounted.current && !(cause && cause.name === 'AbortError')) {
            setError(String((cause && cause.message) || cause))
          }
        } finally {
          clearTimeout(timer)
          if (inFlight.current === controller) inFlight.current = null
          if (mounted.current) setLoading(false)
        }
      }, [])

      useEffect(() => {
        mounted.current = true
        load()
        const timer = setInterval(() => {
          if (typeof document === 'undefined' || !document.hidden) load()
        }, POLL_MS)
        return () => {
          mounted.current = false
          clearInterval(timer)
          if (inFlight.current) {
            try {
              inFlight.current.abort()
            } catch {
              /* already aborted */
            }
            inFlight.current = null
          }
        }
      }, [load])
      return { data, error, loading, reload: load }
    }

    function CuratorPanel(props) {
      const { t } = props
      const { data, error, loading, reload } = useDashboard()
      const [filter, setFilter] = useState('all')
      const [selected, setSelected] = useState(null)
      const [detail, setDetail] = useState(null)
      const [detailError, setDetailError] = useState(null)
      const [detailLoading, setDetailLoading] = useState(false)

      useEffect(() => {
        if (!selected) {
          setDetail(null)
          setDetailError(null)
          return undefined
        }
        let alive = true
        setDetailLoading(true)
        setDetailError(null)
        fetch(`${API}/skill?name=${encodeURIComponent(selected)}`, { headers: { accept: 'application/json' } })
          .then(async (response) => {
            const payload = await response.json().catch(() => ({}))
            if (!alive) return
            if (response.ok) setDetail(payload)
            else {
              setDetail(null)
              setDetailError(payload.error || `HTTP ${response.status}`)
            }
          })
          .catch((cause) => { if (alive) setDetailError(String((cause && cause.message) || cause)) })
          .finally(() => { if (alive) setDetailLoading(false) })
        return () => { alive = false }
      }, [selected])

      const config = (data && data.config) || {}
      const runtime = (data && data.runtime) || {}
      const stats = (data && data.stats) || null
      const skills = (data && data.skills) || []
      const sessions = runtime.sessions || []
      const learning = (data && data.learning) || []
      const enabled = config.enabled !== false
      const threshold = config.threshold || 10
      const everyDays = config.curatorEveryDays || 7

      const counts = useMemo(() => {
        const byState = { active: 0, stale: 0, archived: 0 }
        for (const skill of skills) {
          if (skill.state === 'stale') byState.stale += 1
          else if (skill.state === 'archived') byState.archived += 1
          else byState.active += 1
        }
        return byState
      }, [skills])

      const filtered = useMemo(() => {
        if (filter === 'all') return skills
        return skills.filter((skill) => (filter === 'active' ? skill.state !== 'stale' && skill.state !== 'archived' : skill.state === filter))
      }, [skills, filter])

      if (loading && !data) {
        return h('div', { className: 'sc-shell' }, h('style', null, CSS),
          h('div', { className: 'sc-page' }, h('div', { className: 'sc-skeleton' }, t('loading'))))
      }

      const latest = learning.length > 0 ? learning[0] : null
      const latestFailed = Boolean(latest && latest.status !== 'completed' && latest.status !== 'unknown')
      const pending = sessions.filter((session) => (Number(session.iterations) || 0) > 0)
      const cleanupValue = runtime.lastCuratorAt
        ? (runtime.lastCuratorAt + everyDays * 86400000 <= Date.now() ? t('dueNow') : relative(runtime.lastCuratorAt + everyDays * 86400000))
        : t('notRun')

      const head = h('div', { className: 'sc-head' },
        h('div', null,
          h('h1', { className: 'sc-title' }, t('title'))),
        h('div', { className: 'sc-actions' },
          h('span', { className: 'sc-status' },
            h('span', { className: `sc-dot ${enabled ? 'sc-dot-on' : 'sc-dot-warn'}` }),
            enabled ? t('statusOn') : t('statusOff'),
            runtime.reviewing ? ` · ${t('reviewing')}` : null,
            runtime.curatorRunning ? ` · ${t('curatorRunning')}` : null),
          h('button', { className: 'sc-btn', onClick: reload }, t('refresh'))))

      const heroTitle = latest
        ? `${relative(latest.ts)} ago · ${latestFailed ? t('heroFailed') : t('heroCompleted')}`
        : t('heroNoneTitle')
      const nameList = (names) => {
        const list = Array.isArray(names) ? names : []
        const shown = list.slice(0, 3).join(', ')
        return list.length > 3 ? `${shown} +${list.length - 3}` : shown
      }
      const heroDetail = latest
        ? (latestFailed
            ? t('heroFailedDetail')
            : (Array.isArray(latest.changes) && latest.changes.length > 0
                ? fill(t('heroUpdated'), { names: nameList(latest.changes) })
                : t('heroNoChanges')))
        : t('heroNoneDetail')
      const heroChip = pending.length > 0
        ? h('span', { className: 'sc-hero-chip' },
            h('span', { className: 'sc-dot sc-dot-on' }),
            `${t('heroPending')} ${pending.map((session) => fill(t('heroPendingDetail'), {
              iters: Number(session.iterations) || 0,
              threshold,
            })).join(' · ')}`)
        : null

      const hero = h('div', { className: `sc-hero${latestFailed ? ' sc-hero-failed' : !latest ? '' : ' sc-hero-ok'}` },
        h('div', null,
          h('div', { className: `sc-kicker${latestFailed ? ' sc-kicker-failed' : ''}` }, latest ? t('heroKickerLast') : t('heroKickerNone')),
          h('div', { className: 'sc-hero-title' }, heroTitle),
          h('div', { className: `sc-hero-detail${latestFailed ? ' sc-hero-detail-failed' : ''}` }, heroDetail),
          heroChip),
        h('div', { className: 'sc-hero-side' },
          h('div', { className: 'sc-hero-number' }, String(skills.length)),
          h('div', { className: 'sc-hero-number-label' }, t('kpiSkills'))))

      const kpis = stats ? h('div', { className: 'sc-kpis' },
        h(Kpi, {
          label: t('kpiSkills'),
          value: String(stats.skills),
          sub: fill(t('kpiSkillsSub'), { active: counts.active, stale: counts.stale, archived: counts.archived }),
        }, h(StateStack, { active: counts.active, stale: counts.stale, archived: counts.archived })),
        h(Kpi, {
          label: t('kpiReviews'),
          value: String(stats.reviews),
          sub: [
            stats.lastReviewAt ? fill(t('kpiReviewsSub'), { time: relative(stats.lastReviewAt) }) : t('never'),
            stats.reviewFailed > 0 ? fill(t('kpiFailedSub'), { n: stats.reviewFailed }) : null,
          ].filter(Boolean).join(' · '),
        }),
        h(Kpi, {
          label: t('kpiChanges'),
          value: String(stats.ledgerTotal),
          sub: stats.lastChangeName ? fill(t('kpiChangesSub'), { name: stats.lastChangeName }) : t('never'),
        }),
        h(Kpi, { label: t('kpiCurator'), value: cleanupValue, sub: fill(t('kpiCuratorSub'), { n: everyDays }) })) : null

      const filterChips = [
        ['all', t('filterAll'), skills.length],
        ['active', t('filterActive'), counts.active],
        ['stale', t('filterIdle'), counts.stale],
        ['archived', t('filterArchived'), counts.archived],
      ]

      const skillsSection = h(Section, { title: t('sectionSkills') },
        h('div', { className: 'sc-card' },
          skills.length > 0 ? h('div', { className: 'sc-chips', style: { paddingTop: 12 } }, filterChips.map(([id, label, count]) =>
            h('button', {
              key: id,
              className: `sc-chip${filter === id ? ' sc-chip-on' : ''}`,
              onClick: () => setFilter(id),
            }, `${label} ${count}`))) : null,
          filtered.length === 0
            ? h('div', { className: 'sc-empty' }, skills.length === 0 ? t('emptySkills') : t('emptyFilter'))
            : filtered.map((skill) => h(SkillRow, { key: skill.name, skill, t, onOpen: () => setSelected(skill.name) }))))

      const learningSection = h(Section, { title: t('sectionLearning') },
        h('div', { className: 'sc-card' },
          learning.length === 0
            ? h('div', { className: 'sc-empty' }, t('emptyLearning'))
            : learning.map((item) => h(LearningRow, { key: `${item.ts}-${item.session || ''}-${item.status}`, item, t }))))

      const activitySection = h(Section, { title: t('sectionActivity') },
        h('div', { className: 'sc-card' }, h(Cadence, { activity: (data && data.activity) || [], t })))

      const configSection = data ? h(Section, { title: t('sectionConfig') }, h(Configuration, { data, t })) : null
      const advanced = data ? h(Advanced, { data, t }) : null

      return h(React.Fragment, null,
        h('style', { key: 'sc-style' }, CSS),
        h('div', { className: 'sc-shell' },
          h('div', { className: 'sc-page' },
            head,
            error ? h('div', { className: 'sc-error' },
              h('span', null, `${t('error')} ${error}`),
              h('button', { className: 'sc-btn', onClick: reload }, t('retry'))) : null,
            loading && !data ? h('div', { className: 'sc-skeleton' }, t('loading')) : null,
            data ? h(React.Fragment, null, hero, kpis, skillsSection, learningSection, activitySection, configSection, advanced) : null)),
        selected ? h(SkillModal, {
          skill: skills.find((skill) => skill.name === selected) || { name: selected, description: '' },
          detail,
          loading: detailLoading,
          error: detailError,
          onClose: () => setSelected(null),
          t,
        }) : null)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        try {
          ctx.effect(() => ctx.locale.register('skill-curator', 'en', EN))
          ctx.effect(() => ctx.locale.register('skill-curator', 'zh', ZH))
        } catch {
          /* dictionaries are optional; t falls back to the raw key */
        }
        let t
        try {
          t = ctx.locale.bind('skill-curator')
        } catch {
          t = (key) => EN[key] || key
        }
        const subscribe = (callback) => ctx.locale.subscribe(callback)
        const getSnapshot = () => {
          try {
            const snapshot = ctx.locale.getSnapshot()
            if (snapshot && typeof snapshot.revision === 'number') return snapshot.revision
          } catch {
            /* fall through */
          }
          return t('title')
        }
        function localize(Component) {
          return function Localized(props) {
            useSyncExternalStore(subscribe, getSnapshot)
            return h(Component, { ...props, t })
          }
        }
        const LocalizedCurator = localize(CuratorPanel)
        const LocalizedIcon = localize(PanelIcon)
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'skill-curator',
          order: 30,
          label: () => t('panelLabel'),
        }, LocalizedIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'skill-curator',
        }, LocalizedCurator))
      },
    }
  },
})
