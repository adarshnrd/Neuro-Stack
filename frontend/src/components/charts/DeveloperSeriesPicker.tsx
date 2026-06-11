'use client'

import { useState } from 'react'
import { Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface DeveloperOption {
  id: string
  name: string
  monthlyCommits: number
}

interface DeveloperSeriesPickerProps {
  developers: DeveloperOption[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  topCount?: number
}

function DeveloperSeriesPicker({
  developers,
  selectedIds,
  onChange,
  topCount = 12,
}: DeveloperSeriesPickerProps) {
  const [search, setSearch] = useState('')

  const q = search.trim().toLowerCase()
  const filtered = q
    ? developers.filter((d) => d.name.toLowerCase().includes(q))
    : developers

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }

  const resetTop = () => {
    onChange(developers.slice(0, topCount).map((d) => d.id))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground tabular-nums">
        {selectedIds.length} of {developers.length} developer
        {developers.length !== 1 ? 's' : ''}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <Users size={13} />
            Select developers
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72" align="start">
          <div className="p-2" onKeyDown={(e) => e.stopPropagation()}>
            <Input
              placeholder="Search developers…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-xs"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
          <DropdownMenuSeparator />
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">No matches</p>
            ) : (
              filtered.map((dev) => (
                <DropdownMenuCheckboxItem
                  key={dev.id}
                  checked={selectedIds.includes(dev.id)}
                  onCheckedChange={() => toggle(dev.id)}
                  onSelect={(e) => e.preventDefault()}
                  className="text-xs"
                >
                  <span className="truncate">{dev.name}</span>
                  <span className="ml-auto pl-2 tabular-nums text-muted-foreground">
                    {dev.monthlyCommits}
                  </span>
                </DropdownMenuCheckboxItem>
              ))
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={resetTop}>
        Reset to top {topCount}
      </Button>
      {selectedIds.length > 15 && (
        <span className={cn('text-xs text-amber-600 dark:text-amber-400')}>
          Many lines selected — chart may be hard to read
        </span>
      )}
    </div>
  )
}

export { DeveloperSeriesPicker }
export default DeveloperSeriesPicker
