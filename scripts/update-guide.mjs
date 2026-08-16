#!/usr/bin/env node
/**
 * SourceMate 项目指南自动更新脚本
 *
 * 读取本地 git 仓库的 log / tags / status / remote，重新生成
 * SourceMate_guide/data/gitlog.js（默认目标为仓库同级目录下的 SourceMate_guide，
 * 可通过第一个参数覆盖目标目录）。
 *
 * 由 .git/hooks/post-commit 与 .git/hooks/post-push 调用：
 * - 每次 commit 后：时间线新增提交、工作区进度清零；
 * - 每次 push 后：未推送数量归零。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore']
}).trim();

const target = process.argv[2]
  ? resolve(process.argv[2])
  : join(repoRoot, '..', 'SourceMate_guide');
const dataDir = join(target, 'data');
const dataFile = join(dataDir, 'gitlog.js');

function git(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return '';
  }
}

function inferType(message) {
  if (/^发布修复/i.test(message)) return '发布修复';
  if (/^发布/i.test(message)) return '发布';
  if (/^v?\d+\.\d+/.test(message)) return '发布';
  if (/^feat/i.test(message)) return '优化';
  if (/^fix/i.test(message)) return '修复';
  if (/^解决/i.test(message)) return '修复';
  if (/^优化/i.test(message)) return '优化';
  if (/^CI:/i.test(message)) return 'CI';
  if (/^chore/i.test(message)) return '工程';
  if (/^docs|^添加|^补充/i.test(message)) return '文档';
  return '优化';
}

function areaOf(filePath) {
  if (filePath.startsWith('src/main') || filePath.startsWith('src/preload')) return '主进程';
  if (filePath.startsWith('src/renderer')) return '界面';
  if (filePath.startsWith('src/shared')) return '共享层';
  if (filePath.startsWith('drizzle')) return '数据层';
  return '其他';
}

// ---- 提交记录（含标签） ----
const log = tryGit(['log', '--pretty=format:%h|%ad|%d|%s', '--date=format:%Y-%m-%d %H:%M', '-n', '80']);
const entries = log
  ? log
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const parts = line.split('|');
        const hash = parts[0];
        const date = parts[1];
        const refs = parts[2] || '';
        const message = parts.slice(3).join('|');
        const tagMatch = refs.match(/tag: ([^,)]+)/);
        const entry = { hash, date, message, type: inferType(message) };
        if (tagMatch) entry.tag = tagMatch[1].trim();
        return entry;
      })
  : [];

// ---- 版本与推送状态 ----
const head = git(['rev-parse', '--short=7', 'HEAD']);
const branch = tryGit(['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
const tags = tryGit(['tag', '--sort=-version:refname'])
  .split('\n')
  .filter(Boolean);
const latestTag = tags[0] || null;
let headTag = null;
if (latestTag && tryGit(['rev-parse', '--short=7', latestTag]) === head) headTag = latestTag;

let commitsAfterTag = 0;
if (latestTag) {
  const n = Number(tryGit(['rev-list', '--count', `${latestTag}..HEAD`]));
  commitsAfterTag = Number.isFinite(n) ? n : 0;
}

let unpushedCommits = 0;
let pushedToOrigin = true;
const originHead = tryGit(['rev-parse', '--verify', 'origin/main']);
if (originHead) {
  const n = Number(tryGit(['rev-list', '--count', 'origin/main..HEAD']));
  unpushedCommits = Number.isFinite(n) ? n : 0;
  pushedToOrigin = unpushedCommits === 0;
}

// ---- 工作区状态 ----
const status = tryGit(['status', '--porcelain'])
  .split('\n')
  .filter(Boolean);
const modified = [];
const untracked = [];
for (const line of status) {
  const code = line.slice(0, 2).trim();
  const filePath = line.slice(3).replace(/^"|"$/g, '');
  if (code === '??') untracked.push({ path: filePath, area: areaOf(filePath) });
  else modified.push({ path: filePath, area: areaOf(filePath) });
}

let diffStat = '0 个已跟踪文件改动';
const statOut = tryGit(['diff', '--stat']);
if (statOut) {
  const lines = statOut.split('\n').filter(Boolean);
  const last = lines[lines.length - 1];
  if (last && !last.includes('file changed')) diffStat = last.trim();
}

// ---- 进度说明 ----
const wipTotal = modified.length + untracked.length;
let note;
if (commitsAfterTag === 0 && wipTotal === 0) {
  note = 'v0.1.1 之后暂无新提交，工作区干净。';
} else {
  const commitPart =
    commitsAfterTag > 0
      ? `v0.1.1 之后已有 ${commitsAfterTag} 个提交${
          unpushedCommits > 0 ? `（未推送 ${unpushedCommits} 个）` : '（已全部推送）'
        }，最新提交 ${head}。`
      : 'v0.1.1 之后暂无新提交。';
  note = `${commitPart}工作区${
    wipTotal > 0 ? `剩余 ${wipTotal} 项未提交改动（见下表）。` : '干净。'
  }`;
}

const remoteUrl = tryGit(['remote', 'get-url', 'origin']);
const repoHome = remoteUrl
  ? remoteUrl.replace(/\.git$/, '').replace(/^git@([^:]+):/, 'https://$1/')
  : 'https://github.com/xxhh2eol/SourceMate';

const data = {
  repoUrl: remoteUrl || 'https://github.com/xxhh2eol/SourceMate.git',
  repoHome,
  branch,
  head,
  headTag,
  pushedToOrigin,
  ci: {
    file: '.github/workflows/release.yml',
    desc: '推送 v* 标签（如 v0.1.1）时触发：Windows / macOS / Linux 三平台并行 electron-vite 构建，electron-builder --publish always 创建或更新 GitHub Release 并上传安装包；同时支持 Actions 手动触发。'
  },
  entries,
  wip: {
    checkedAt: new Date().toISOString().slice(0, 10),
    commitsAfterTag,
    unpushedCommits,
    modifiedCount: modified.length,
    untrackedCount: untracked.length,
    diffStat,
    note,
    modified,
    untracked
  }
};

mkdirSync(dataDir, { recursive: true });
const content =
  '/* 此文件由 scripts/update-guide.mjs 自动生成，请勿手动编辑 */\n' +
  'window.GUIDE = window.GUIDE || {};\n' +
  `GUIDE.gitlog = ${JSON.stringify(data, null, 2)};\n`;
writeFileSync(dataFile, content, 'utf8');

console.log(
  `[update-guide] 已更新 ${dataFile}（${entries.length} 条提交，v0.1.1 后新提交 ${commitsAfterTag} 个）`
);
