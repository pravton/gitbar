# Brief: GitBar v1 — Core MVP

**Status:** `pending-spawn`  
**Task slug:** `gitbar-v1`  
**Created:** 2026-05-17  
**Repo:** `pravton/gitbar` (private)  

---

## Objective

Build a **sticky floating desktop panel** for macOS that displays open PRs and issues across all `pravton/*` repos with a dark Cipher-style UI, time-since-opened tracking, a "rain severity" indicator (how many PRs/issues are piling up on you), and clickable direct links to GitHub. Ship as a Tauri v2 app (TypeScript + Rust).

## Why This Exists

Clinton ships fast across many repos. The friction is:

1. **Discovering** what's open and waiting on you requires opening GitHub
2. **Prioritizing** — which PRs are oldest? Which reviews are blocking others?
3. **Context-switching** — switching between repos to check status is slow

Existing tools (menu bar counters) hide information behind a click. GitBar shows it at a glance — always visible, always current.

---

## Core Features (MVP v1)

### 1. Floating Panel Window
- **Always on top** (sticky), sits above other windows
- **Frameless** with rounded corners and subtle shadow
- **Draggable** via any empty area (custom drag region)
- **Resizable** with a minimum size (e.g., 320×400)
- **Closable** to system tray (not quit — hide/show from tray icon)
- **Toggle visibility** via tray menu or global shortcut
- **Opens on login** (optional, configurable)

### 2. PR List View
- Display open PRs across all `pravton/*` repos
- Sortable/filterable by:
  - Age (how long ago opened — "2h ago", "3d ago", "1w ago")
  - Repo
  - Status (draft, review requested, CI failing, mergeable)
- Each PR card shows:
  - Repo name + PR number
  - Title (linked to GitHub PR page)
  - Author avatar
  - State badge (🟢 open, 🟡 draft, 🔴 conflicts)
  - Time since opened
  - CI status indicator (if available)
  - Review request indicator (👀)
- Click card → opens browser to PR

### 3. Issue List View
- Display assigned issues across `pravton/*` repos
- Each issue card shows:
  - Repo name + issue number
  - Title (linked to GitHub issue page)
  - Labels (color chips)
  - Time since opened

### 4. Rain Severity Indicator
- Visual "weather" indicator in the header:
  - ☀️ **Clear** — 0-3 open items
  - 🌤️ **Light** — 4-7 open items
  - 🌧️ **Raining** — 8-15 open items
  - ⛈️ **Storm** — 16+ open items
- Shows total count: "12 PRs · 5 issues — 🌧️ It's raining"
- This is the "at a glance" metric — the first thing Clinton sees

### 5. Auto-Refresh
- Poll GitHub API every 60 seconds
- Show last refresh timestamp: "Updated 12s ago"
- Manual refresh button
- Respect rate limits (conditional requests with ETag/If-None-Match)

### 6. GitHub Authentication
- GitHub OAuth device flow or PAT token
- Store token securely (Tauri's keychain plugin or env)
- First-run onboarding screen to set up auth

---

## Technical Architecture

```
GitBar
├── src/                          # React frontend
│   ├── App.tsx                   # Root — window layout, routing
│   ├── components/
│   │   ├── Header.tsx            # Rain indicator, refresh, settings
│   │   ├── PRCard.tsx            # Single PR card
│   │   ├── IssueCard.tsx         # Single issue card
│   │   ├── ListView.tsx          # Scrollable list with tabs
│   │   ├── Onboarding.tsx        # First-run auth setup
│   │   └── Settings.tsx          # Config panel
│   ├── hooks/
│   │   ├── usePRs.ts             # Fetch + cache PRs
│   │   ├── useIssues.ts          # Fetch + cache issues
│   │   └── useGitHubAuth.ts      # Auth state management
│   ├── lib/
│   │   └── utils.ts              # cn(), time formatting
│   └── styles/
│       └── index.css             # Tailwind + custom Cipher theme
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── main.rs               # Entry point, window setup
│   │   ├── lib.rs                # Tauri commands
│   │   ├── github/
│   │   │   ├── mod.rs            # Module exports
│   │   │   ├── client.rs         # HTTP client (reqwest)
│   │   │   ├── queries.rs        # GraphQL queries
│   │   │   └── models.rs         # PR, Issue data models (serde)
│   │   └── cache.rs              # In-memory cache with TTL
│   ├── tauri.conf.json           # Window config, permissions
│   └── Cargo.toml
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── vite.config.ts
```

### Key Technical Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Window framework | Tauri v2 | Native, tiny binary, built-in always-on-top |
| Frontend | React + TS | Fast dev, Tailwind for styling |
| API queries | **GraphQL** (GitHub API v4) | Single query for PRs+issues across repos, less data transfer |
| HTTP client | `reqwest` (Rust) | Async, TLS-native, battle-tested |
| Auth storage | Tauri keychain plugin | Secure, macOS Keychain integration |
| Cache | In-memory `HashMap` with 60s TTL | Simple, no persistence needed |
| Window positioning | Save to `localStorage` / `tauri-plugin-store` | Remember where user placed it |

### API Design

Frontend calls Tauri commands (IPC), not GitHub directly:

```
// Frontend → Rust backend
invoke("get_prs")      → Vec<PullRequest>
invoke("get_issues")   → Vec<Issue>
invoke("get_stats")    → { total_prs, total_issues, rain_level }
invoke("set_token", token) → ()
invoke("get_auth_status")  → { authenticated: bool, user: String }
```

Rust backend handles:
- Token management
- HTTP requests to GitHub
- Response parsing
- Caching
- Error handling (rate limits, network errors)

### GraphQL Query (Single Query for PRs)

```graphql
query {
  search(query: "is:pr is:open org:pravton", type: ISSUE, first: 50) {
    issueCount
    edges {
      node {
        ... on PullRequest {
          number
          title
          url
          state
          createdAt
          repository { nameWithOwner }
          author { login, avatarUrl }
          reviews(states: [CHANGES_REQUESTED, APPROVED], first: 5) { ... }
          commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
        }
      }
    }
  }
}
```

---

## UI/UX Design — Cipher Dark Theme

### Color Palette (Match Cipher v2 Aesthetic)
```
--bg-primary:    #0d1117     (GitHub dark base)
--bg-secondary:  #161b22     (Card background)
--bg-tertiary:   #21262d     (Hover state)
--border:        #30363d     (Card border)
--text-primary:  #e6edf3     (Body text)
--text-secondary:#8b949e     (Muted text)
--accent:        #58a6ff     (Links, active)
--success:       #3fb950     (CI passing, merged)
--warning:       #d29922     (Draft, pending)
--danger:        #f85149     (CI failure, conflicts)
```

### Window Design
- Width: 380px (min) → 600px (max)
- Height: 320px (min) → full screen (max)
- Corner radius: 12px
- Inner padding: 16px
- Scrollable card list with subtle scrollbar
- Card hover: background lightens slightly

### Card Design
```
┌──────────────────────────────────────┐
│ 🔴 helm                    👀  3d ago │
│ Fix timeline drag-to-reorder bug     │
│ #32 opened by @pravton               │
│ ───────────────────────────────────── │
│ ✅ CI passing    💬 2 reviews        │
└──────────────────────────────────────┘
```

### Rain Header
```
┌──────────────────────────────────────┐
│ 🌧️ It's raining    12 PRs · 5 issues │
│ Updated 12s ago    [🔄] [⚙️] [−] [×] │
└──────────────────────────────────────┘
```

---

## Acceptance Criteria

### Must Have (Ship Blocker)
- [ ] Floating window renders on macOS with always-on-top behavior
- [ ] Window is frameless, draggable, resizable
- [ ] GitHub OAuth or PAT auth flow works end-to-end
- [ ] PR list displays with repo, title, age, author, status
- [ ] Issue list displays with repo, title, labels, age
- [ ] Rain indicator updates based on total open items
- [ ] Clicking a PR/issue card opens browser to GitHub
- [ ] Auto-refresh every 60s with manual refresh button
- [ ] System tray icon with show/hide toggle
- [ ] Dark theme (Cipher-style) applied throughout
- [ ] App remembers window position between launches
- [ ] Builds as a .dmg with `npm run tauri build`

### Should Have (Nice to Have)
- [ ] CI status badge on PR cards
- [ ] Review request indicator on PR cards
- [ ] Filter by repo toggle buttons
- [ ] Sort by age / repo / status
- [ ] Notification dot on tray icon when new items appear
- [ ] Keyboard shortcut to toggle visibility (e.g., Cmd+Shift+G)
- [ ] Auto-start on login toggle

### Won't Do (v2+)
- ❌ PR review/approval from within the app
- ❌ Issue creation or editing
- ❌ Multi-account support
- ❌ Windows/Linux support
- ❌ Notification center integration
- ❌ Merge button

---

## Timeline

| Phase | What | Estimate |
|-------|------|---------|
| Scaffold | Tauri init, React setup, Tailwind, window config | 30 min |
| Rust backend | GitHub client, GraphQL queries, cache, commands | 2-3 hrs |
| Auth flow | OAuth/PAT setup, keychain storage, onboarding UI | 1-2 hrs |
| UI components | Cards, header, list view, dark theme | 3-4 hrs |
| Window behavior | Tray, positioning, resize, drag | 1 hr |
| Polish + build | Responsive edge cases, .dmg packaging | 1-2 hrs |

**Total estimate:** 8-12 hours (one focused Saturday or two evenings)

---

## References
- [Tauri v2 Window Config](https://v2.tauri.app/reference/config/#windowconfig)
- [GitHub GraphQL API](https://docs.github.com/en/graphql)
- `~/Projects/innomactic_web` — existing Cipher dark theme for reference
- [Tauri OAuth Plugin](https://github.com/FabianLars/tauri-plugin-oauth)
