'use client'

import { useEffect } from 'react'
import { useUIStore, THEMES } from '@/store/ui.store'

const ALL_THEME_CLASSES = THEMES.map((t) => t.value)

export function ThemeProvider() {
  const theme = useUIStore((s) => s.theme)

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove(...ALL_THEME_CLASSES)
    root.classList.add(theme)
  }, [theme])

  return null
}
