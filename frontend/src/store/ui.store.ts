import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { format } from 'date-fns'

export type Theme =
  | 'theme-light'
  | 'theme-dark'
  | 'theme-dim'
  | 'theme-nord'
  | 'theme-solarized'
  | 'theme-sepia'
  | 'theme-dracula'
  | 'theme-high-contrast'

export interface ThemeDef {
  value: Theme
  label: string
  icon: string
  description: string
  group: 'core' | 'bonus'
}

export const THEMES: ThemeDef[] = [
  // ── Core ───────────────────────────────────────────────────────────────────
  { value: 'theme-light',         label: 'Light',         icon: '☀️',  description: 'Clean white — daytime readability',  group: 'core'  },
  { value: 'theme-dark',          label: 'Dark',          icon: '🌑',  description: 'True dark — reduces eye strain',     group: 'core'  },
  { value: 'theme-dim',           label: 'Dim',           icon: '🌙',  description: 'Soft slate — sweet spot for evening', group: 'core'  },
  // ── Bonus ──────────────────────────────────────────────────────────────────
  { value: 'theme-nord',          label: 'Nord',          icon: '❄️',  description: 'Arctic blues — focused & calm',      group: 'bonus' },
  { value: 'theme-solarized',     label: 'Solarized',     icon: '🌅',  description: 'Warm tones, amber & cyan',          group: 'bonus' },
  { value: 'theme-sepia',         label: 'Sepia',         icon: '📜',  description: 'Paper tone — long reading sessions', group: 'bonus' },
  { value: 'theme-dracula',       label: 'Dracula',       icon: '🧛',  description: 'Vivid purple & pink — dev favourite',group: 'bonus' },
  { value: 'theme-high-contrast', label: 'High Contrast', icon: '⬛',  description: 'WCAG AAA — OLED & accessibility',   group: 'bonus' },
]

export const CORE_THEMES  = THEMES.filter((t) => t.group === 'core')
export const BONUS_THEMES = THEMES.filter((t) => t.group === 'bonus')

interface UIState {
  selectedDate: string
  selectedMonth: string
  theme: Theme
  setSelectedDate: (date: string) => void
  setSelectedMonth: (month: string) => void
  setTheme: (theme: Theme) => void
}

const today = new Date()

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      selectedDate: format(today, 'yyyy-MM-dd'),
      selectedMonth: format(today, 'yyyy-MM'),
      theme: 'theme-dark',
      setSelectedDate: (selectedDate) => set({ selectedDate }),
      setSelectedMonth: (selectedMonth) => set({ selectedMonth }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'da-ui',
      partialize: (state: UIState) => ({ theme: state.theme }),
    },
  ),
)
