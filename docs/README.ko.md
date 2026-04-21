# Hydra

**AI 코딩 에이전트 군단을 지휘하세요 — 각자 자기 브랜치, 자기 터미널에서, VS Code 하나로.**

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/kargnas.vscode-tmux-worktree?label=VS%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=kargnas.vscode-tmux-worktree)

🌏 **다른 언어로 읽기:** [English](../README.md) | **한국어**

**[VS Marketplace에서 설치](https://marketplace.visualstudio.com/items?itemName=kargnas.vscode-tmux-worktree)**

## Hydra란?

Hydra는 VS Code를 병렬 AI 개발 컨트롤 패널로 바꿔줍니다. 에이전트를 하나만 돌리는 대신, 여러 에이전트를 동시에 — 각각 별도의 git 브랜치에서, 자기만의 터미널 세션으로 돌리세요.

```
프로젝트
├── main            → Copilot (Claude) — 워크스페이스에서 페어 프로그래밍
├── feat/auth       → Worker (Claude) — OAuth를 처음부터 구현 중
├── feat/dashboard  → Worker (Codex) — 어드민 대시보드 생성 중
└── fix/perf        → Worker (Gemini) — 프로파일링 및 병목 해결 중
```

모든 세션은 tmux(또는 Zellij)에서 유지됩니다. VS Code를 닫아도, 폰에서 SSH로 접속해도, 내일 다시 와도 — 에이전트는 계속 돌아가고 있습니다.

## 핵심 개념

### Copilot

현재 워크스페이스에서 작동하는 하나의 상주 AI 에이전트 세션입니다. 페어 프로그래밍 파트너처럼 여러분이 보는 코드를 같이 보면서, 현재 브랜치에서 함께 작업합니다.

- 워크스페이스당 하나
- 현재 디렉토리에서 실행 (worktree 불필요)
- VS Code를 재시작해도 유지

### Worker

자기만의 git 브랜치, worktree, 터미널 세션을 갖는 일회용 AI 에이전트입니다. 태스크를 던져놓고, 여러분은 다른 일에 집중하세요.

- 태스크/브랜치당 하나
- 격리된 git worktree (작업 충돌 없음)
- 브랜치 + worktree + 세션 생성 + 에이전트 실행을 한 번에
- Worker는 `<repo>/.hydra/worktrees/` 아래에 생성되어 저장소 루트를 깔끔하게 유지

## 지원 에이전트

| 에이전트 | 명령어 | 설명 |
|----------|--------|------|
| Claude | `claude` | Anthropic의 Claude Code CLI |
| Codex | `codex` | OpenAI의 Codex CLI |
| Gemini | `gemini` | Google의 Gemini CLI |
| Aider | `aider` | 오픈소스 AI 페어 프로그래밍 |
| Custom | 설정 가능 | 원하는 CLI 에이전트 |

기본 에이전트와 명령어를 설정에서 변경할 수 있습니다:

```json
{
  "hydra.defaultAgent": "claude",
  "hydra.agentCommands": {
    "claude": "claude",
    "codex": "codex",
    "gemini": "gemini",
    "aider": "aider"
  }
}
```

## 시작하기

1. VS Marketplace에서 확장 프로그램 설치
2. `tmux`와 `git`이 PATH에 있는지 확인
3. 액티비티 바에서 **Hydra** 패널 열기

**Copilot 실행:** Copilot 버튼(로봇 아이콘) 클릭 → 에이전트 선택 → 워크스페이스에서 시작됩니다.

**Worker 생성:** Worker 버튼(서버 아이콘) 클릭 → `feat/auth` 같은 브랜치 이름 입력 → 에이전트 선택 → 브랜치, worktree, 세션 생성 후 에이전트가 자동으로 실행됩니다.

## 기능

### 사이드바 트리 뷰

Hydra 패널에서 실행 중인 모든 것을 한눈에 볼 수 있습니다:

- **Copilot 그룹** — 워크스페이스 AI 세션
- **Worker 그룹** — 브랜치별 워커들
- **상태 표시** — 녹색 원(활성), 테두리(중지), 경고(git 없음)
- **세션 상세** — 패널 수, 최근 활동 시간, CPU 사용량
- **Git 상태** — 미푸시 커밋 수, 수정/미추적/삭제된 파일 수

### 스마트 연결

- **터미널에서 연결** — VS Code 통합 터미널에서 세션 열기
- **에디터에서 연결** — 세션을 에디터 탭으로 띄우기
- **자동 연결** — worktree 폴더를 열면 자동으로 세션에 연결
- **크기 안정화 연결** — attach 전에 PTY 크기를 동기화해 80x24 초기 렌더링 문제 방지
- **프롬프트 안정화 연결** — VS Code shell integration 환경 변수를 제거해 tmux/Zellij 내부 렌더링 깨짐 방지

### 스마트 붙여넣기 (이미지 인식)

터미널에서 `Cmd+V`(macOS) / `Ctrl+Shift+V`(Linux)를 누르면 알아서 처리합니다:
- 클립보드에 텍스트 → 일반 붙여넣기
- 클립보드에 이미지 → 임시 `.png` 파일로 저장 후 경로 입력

Remote-SSH에서도 동작합니다 — 로컬 클립보드 이미지가 원격으로 전달됩니다.

### 듀얼 백엔드: tmux + Zellij

패널 헤더에서 tmux와 Zellij 사이를 전환할 수 있습니다. 두 백엔드 모두 동일한 기능을 지원합니다: 세션 생성, 메타데이터 저장, 패널 관리, 에이전트 라이프사이클.

### 세션 관리

- 컨텍스트 메뉴에서 패널 분할과 새 윈도우 생성
- worktree 경로를 클립보드에 복사
- worktree를 새 VS Code 창으로 열기
- 이름으로 세션 필터링
- 기존 브랜치에서 worktree 생성

### 고아 세션 정리

worktree가 없는 세션을 감지하고 제거합니다. 클릭 한 번으로 환경을 깔끔하게 유지하세요.

### CLI 도구 (`hydra-worker`)

VS Code 없이 터미널에서 직접 Worker를 만들 수 있습니다:

```bash
hydra-worker --repo ~/myapp --branch feat/auth --agent claude --task "OAuth2 로그인 구현"
```

| 플래그 | 필수 | 설명 |
|--------|------|------|
| `--repo` | 예 | git 저장소 경로 |
| `--branch` | 예 | 생성할 브랜치 이름 |
| `--agent` | 아니오 | 에이전트 타입: `claude`, `codex`, `gemini`, `aider` (기본값: `claude`) |
| `--base` | 아니오 | 기준 브랜치 지정 (기본값: 자동 감지) |
| `--task` | 아니오 | 에이전트에게 줄 초기 프롬프트 |

이 스크립트는 `Hydra: Create Worker`의 전체 플로우를 그대로 재현합니다 — 브랜치 검증, 슬러그 충돌 해소, `.hydra/` 아래 worktree 생성, tmux 세션 설정, 에이전트 실행.

## 명령어

| 명령어 | 설명 |
|--------|------|
| `Hydra: Create Copilot` | 현재 워크스페이스에서 AI 코파일럿 실행 |
| `Hydra: Create Worker` | 새 브랜치 + worktree + 에이전트 세션 생성 |
| `Hydra: Attach/Create Session` | 현재 worktree의 세션에 연결하거나 새로 생성 |
| `Hydra: Remove Task` | worktree와 세션 삭제 |
| `Hydra: Cleanup Orphans` | 고아 세션 정리 |
| `Hydra: Smart Paste (Image Support)` | 스마트 붙여넣기: 텍스트 또는 이미지 |
| `Hydra: Paste Image from Clipboard` | 이미지 강제 붙여넣기 |

## 실제 활용 사례

### 병렬 AI 개발

```
myapp/
├── main              → Copilot: Claude가 PR 리뷰 도와줌
├── feat/oauth        → Worker: Claude가 OAuth 플로우 구현 중
├── feat/dashboard    → Worker: Codex가 UI 컴포넌트 생성 중
└── fix/memory-leak   → Worker: Gemini가 프로파일링 및 패치 중
```

독립적인 태스크에 Worker를 띄워놓고, VS Code에서 결과를 확인하세요. 세션은 백그라운드에서 계속 돌아갑니다.

### 원격 서버 + 모바일 접속

SSH로 개발 서버에 접속해서 Hydra로 Worker를 관리하고, 연결을 끊어도 세션은 유지됩니다. 집, 카페, 폰에서 다시 연결하세요:

```bash
ssh dev-server
tmux attach -t myapp-a1b2c3d4_feat-oauth
```

Termux로 통근길에 AI가 작성한 코드를 리뷰할 수 있습니다.

## 설정

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `hydra.defaultAgent` | `claude` | 새 copilot/worker의 기본 에이전트 |
| `hydra.agentCommands` | `{...}` | 에이전트 타입 → 실행 명령어 매핑 |
| `hydra.baseBranch` | 자동 감지 | Worker 생성 시 기준 브랜치 지정 |
| `tmuxWorktree.multiplexer` | `tmux` | 백엔드: `tmux` 또는 `zellij` |
| `tmuxWorktree.baseBranch` | 자동 감지 | 기준 브랜치 지정 (레거시) |

## 요구사항

- **tmux** (또는 **Zellij**) — 설치되어 있고 PATH에 있어야 합니다
- **git** — 설치되어 있고 PATH에 있어야 합니다
- **VS Code** 1.85.0 이상

## 작동 원리

```
저장소
├── main                → 세션: "project-a1b2c3d4_main"
├── feat/auth           → 세션: "project-a1b2c3d4_feat-auth"    [Worker: Claude]
└── fix/bug-123         → 세션: "project-a1b2c3d4_fix-bug-123"  [Worker: Codex]
                        → 세션: "hydra-copilot"                  [Copilot: Claude]
```

**Worker**는 각각 전용 git worktree + 터미널 세션을 갖습니다. 세션 이름은 `repo-name + path-hash` 네임스페이스로 같은 이름의 저장소 간 충돌을 방지합니다. Worktree는 기본적으로 `<repo>/.hydra/worktrees/` 아래에 생성됩니다.

**Copilot**은 워크스페이스 디렉토리에 연결된 하나의 글로벌 세션(`hydra-copilot`)입니다 — worktree가 필요 없습니다.

Copilot과 Worker 모두 역할과 에이전트 타입을 세션 메타데이터로 저장해서, Hydra가 트리 뷰에 올바른 상태를 표시할 수 있습니다.

## 라이선스

[MIT](../LICENSE.md)
