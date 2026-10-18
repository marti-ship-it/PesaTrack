# PesaTrack

A personal finance, budgeting and savings tracker for Android, built for students and young
adults in Kenya who receive money from several sources and want to manage it carefully.

PesaTrack is **local-first**: all records live in a SQLite database **on your phone**. There is no
account, no server, and no internet connection required to record or review your money.

---

## Technology

| Piece | What it does |
| --- | --- |
| **Expo SDK 57** (React Native 0.86) | Runs the same code on Android and iOS |
| **TypeScript** | Type checking, so mistakes are caught before the app runs |
| **Expo Router** | File-based navigation (folders in `src/app/` become screens) |
| **expo-sqlite** | The on-device database that stores transactions |
| **@react-native-vector-icons/ionicons** | Tab bar icons |

---

## Before you start

You need, once:

1. **Node.js** (v20.19.4 or newer) — already installed on this machine.
2. **Expo Go** on your Android phone — free from <https://expo.dev/go> or the Play Store.
3. Your phone and your computer on the **same Wi-Fi network**.

---

## Run the app on your Android phone

Open a terminal in this project folder and run:

```powershell
npm start
```

A QR code appears in the terminal. On your phone:

1. Open **Expo Go**.
2. Tap **Scan QR code** and point it at the QR code on your screen.

The app loads on your phone. When you change a file and save it, the phone updates automatically
(this is called Fast Refresh).

If the QR code does not connect, press `a` in the terminal to see other connection options, or check
that both devices are on the same Wi-Fi network.

---

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm start` | Start the development server (QR code for your phone) |
| `npm run android` | Launch on a connected Android device/emulator |
| `npm test` | Run the automated tests (money, dates, rules, database schema) |
| `npm run typecheck` | Type-check the whole project (no output = no errors) |
| `npm run lint` | Check code style and common mistakes |
| `npx expo-doctor` | Diagnose dependency/configuration problems |
| `npx expo install <package>` | Install a library **at a version compatible with this SDK** |

> Always use `npx expo install` instead of `npm install <package>` for Expo/React Native
> libraries. It picks versions that are known to work together.

---

## Opening the project in VS Code

```powershell
code .
```

(from this folder). Recommended VS Code extensions: **Expo Tools** and **ESLint**.

---

## Project structure

```
src/
├── app/                  Screens. Every file here is a route.
│   ├── _layout.tsx       Root layout: theme + navigation stack
│   └── (tabs)/           The five main sections
│       ├── _layout.tsx   Bottom tab bar definition
│       ├── index.tsx     Home (dashboard)
│       ├── transactions.tsx
│       ├── budgets.tsx
│       ├── reports.tsx
│       └── settings.tsx
├── components/           Reusable UI pieces (Card, EmptyState, …)
├── constants/            Design system: colors, spacing, radii
├── hooks/                Shared React hooks (theme)
├── db/                   Everything that touches SQLite
│   ├── schema.ts         Tables, indexes, constraints, starter categories
│   ├── migrations.ts     Versioned, transactional schema updates
│   ├── errors.ts         Turns database errors into messages a screen can use
│   └── repositories/     One module per table: the only code that writes SQL
├── services/             Business rules: validation, budgets, reports, savings, backup
└── utils/                Money maths, dates, id generation
```

**Rule of thumb:** screens never write SQL and services never render. A screen collects input,
a service validates it and stores it.

---

## How your money is stored

**Amounts are never decimals.** `KSh 1,250.50` is stored as the integer `125050`, because
floating point cannot represent most decimals exactly and the error compounds over hundreds of
entries. Formatting to "KSh 1,250.50" happens only when text is shown.

**Every amount is stored positive.** Direction comes from the transaction type, never from a
minus sign:

| Type | Meaning |
| --- | --- |
| `income` | money in |
| `expense` | money spent — including refunds, which point back at the expense they reverse |
| `saving` | money moved into (`in`) or out of (`out`) savings — not spending |

A refund is a second `expense` row linked to the original, so the pair nets to zero in every
spending total without ever being counted as income.

The tables:

| Table | Holds |
| --- | --- |
| `transactions` | Every income, expense and saving entry |
| `categories` | Income / expense / saving categories, retired rather than deleted |
| `payment_methods` | Labels such as M-Pesa, Cash, Bank — descriptive only |
| `monthly_budgets` | One budget per expense category per financial month |
| `monthly_budget_totals` | Optional overall spending limit for a month |
| `savings_goals` | Named goals such as "Emergency Fund" |
| `obligations` | Upcoming bills. The table and its constraints exist, but no screen reads it yet |
| `settings` | Single row: currency, financial month start day, warning threshold |

The database enforces these rules itself — positive amounts, a Need/Want on expenses only, a
refund can only undo an expense, and a category that history references cannot be deleted — so a
mistake in a screen cannot corrupt your records.


---

## Build status

PesaTrack is built in milestones. Current state — `[x]` finished, `[~]` partly finished, `[ ]` not started:

- [x] **M1 — Foundation**: project setup, five-tab navigation, design system (light + dark)
- [x] **M2 — Database**: SQLite schema with enforced constraints, migration runner, repositories,
  seeded Kenyan categories and payment methods, transaction validation rules, Jest tests
- [x] **M3 — Transaction forms**: income / expense / saving, dependent category dropdowns,
  add / edit / delete, refunds, Need-or-Want on expenses
- [x] **M4 — Dashboard**: real totals and available balance, financial-month switch, recent activity
- [x] **M5 — Budgets**: monthly category budgets, budget vs actual, month stepper
- [x] **M6 — Savings**: goals, contributions through ordinary saving transactions, progress and
  archiving
- [x] **M7 — Reports & insights**: money in/out, month-over-month comparison, category breakdown
  with a donut chart, six-month trend chart and budget performance
- [x] **Settings & categories**: appearance (system / light / dark), financial month start day,
  budget warning threshold, and adding / renaming / retiring categories
- [x] **M8 — Export & backup**: transactions CSV, full JSON backup, and a restore that replaces
  everything on the device
- [x] **M9 — Hardening**: every control names itself for a screen reader, every screen has an
  honest empty state, and the awkward cases (zero totals, refunds heavier than spending, goals
  past their target) are pinned down by tests
- [ ] **M10 — Test run**: the named test scenarios on your phone
- [~] **M11 — Build**: `eas.json` added, `android.versionCode` set to 1; ready for
  `npx eas-cli@latest login`, EAS-managed keystore and building (APK/AAB) when you are logged in

Until a milestone is finished, the screens show honest empty states — never fake data.

Tests run on the computer with `npm test`: money arithmetic, dates, the transaction, budget, report
and settings rules, and the database schema itself. They need no phone and no emulator.

---

## Your data

- Records are stored **only on this device**.
- No financial credentials (M-Pesa PIN, bank passwords) are ever requested.
- Nothing is transmitted anywhere by the app.
- You can export your transactions as CSV, and back up or restore everything, from Settings.

### Seeing the database for yourself

The database is an ordinary SQLite file on your phone, and the dev server can open it in a browser
so you can look inside.

1. In the terminal running `npm start`, press **`Shift` + `M`** to open the **more tools** menu.
2. Choose **Open expo-sqlite** and pick `pesatrack.db`. It opens in your browser.
3. The dashboard lets you browse the tables and run a query, for example:

```sql
SELECT name, type FROM categories ORDER BY type, sort_order;
```

#### Two different menus, easy to confuse

| Key | Opens | Contains |
| --- | --- | --- |
| `m` | The **developer menu on your phone** | Reload, Go Home, performance monitor, element inspector, **Open DevTools** (the JavaScript debugger) |
| `Shift` + `M` | The **more tools** menu in the terminal | The list that includes **Open expo-sqlite** |
| `J` | React Native DevTools (the JavaScript debugger) | Console, Sources, Network, Memory, Components, Profiler |

The **SQLite inspector is not the JavaScript debugger**, and you never need the debugger to look at
your database. If you do open the JavaScript debugger and it reports *"No compatible apps
connected"*, it simply found no app attached to a dev server — almost always because `npm start`
is not running, or Expo Go is not currently on the PesaTrack screen.

**If nothing happens when you press `Shift` + `M`**, the dev server isn't running: the app on your
phone is still showing a copy it loaded earlier. Run `npm start` and reload.

---

## Note about OneDrive

This project currently lives inside a OneDrive-synced folder. `node_modules/` contains tens of
thousands of files, and OneDrive constantly syncing them can slow down installs and file watching.
If you notice slow performance, right-click the `PesaTrack` folder in File Explorer →
**"Always keep on this device"**, or move the project outside OneDrive (for example
`C:\dev\PesaTrack`).
